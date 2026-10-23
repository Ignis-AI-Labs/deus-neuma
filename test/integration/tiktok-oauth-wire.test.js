/**
 * TikTok CONNECT on the real wire (integration, RULE 0 — no mocks).
 *
 * WHAT THE LOCAL SERVER STANDS IN FOR (test/helpers/tiktok-stand-in.js): one
 * real HTTP server on 127.0.0.1 plays TikTok's Open API host
 * `open.tiktokapis.com` — the OAuth token endpoint (code exchange and
 * refresh) and `/v2/user/info/` — answering in the shapes TikTok documents.
 * It is NOT TikTok: whether TikTok accepts the company's app, its
 * `http://127.0.0.1:*\/callback/` redirect, the hex PKCE challenge and the
 * three scopes is proven only by Founder's own CONNECT and
 * `scripts/tiktok-post-verify.mjs`.
 *
 * Everything else is the real thing: the platform's loopback receiver binds
 * a real ephemeral port, this test plays the browser by making the real
 * redirect request TikTok would send it, the real exchange goes over HTTP,
 * and the tokens land in the house's real AES-256-GCM credential store on
 * temp disk (realm isolated, no real keys anywhere). The routes are driven
 * through a real signed-wallet session.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { startTikTokStandIn } from '../helpers/tiktok-stand-in.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { tiktokPkceChallenge } from '../../backend/services/social/tiktok-oauth.js';
import {
  setChannelCredential, resolveChannelCredential, removeChannelCredential, channelCredentialsPath,
} from '../../backend/services/social/channel-credentials.js';
import { startTikTokConnect, pollTikTokConnect } from '../../backend/services/social/tiktok-connect.js';
import { tiktokAccessFor } from '../../backend/services/social/tiktok-token.js';
import { runFlightTests } from '../../backend/services/social/flight-test.js';
import connectRouter from '../../backend/routes/social-connect-routes.js';

const HOUSE = `0x${'7b'.repeat(20)}`;
const CLIENT = Object.freeze({ clientKey: 'awstandinkey', clientSecret: 'stand-in-secret' });
const ENV = ['NEUMA_TIKTOK_API_ROOT', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN', 'TIKTOK_ACCESS_TOKEN', 'TIKTOK_ACCESS_EXPIRES_AT'];

let tiktok;
let saved;
let priorRealm;

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  tiktok = await startTikTokStandIn();
  process.env.NEUMA_TIKTOK_API_ROOT = tiktok.root;
  priorRealm = getRealmRoot();
  setRealmRoot(path.join(await createTempDir('tiktok-oauth'), 'realm'));
});

afterAll(async () => {
  setRealmRoot(priorRealm);
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await tiktok.close();
});

beforeEach(async () => {
  tiktok.reset();
  await removeChannelCredential(HOUSE, 'tiktok');
  await setChannelCredential(HOUSE, 'tiktok', CLIENT);
});

// The browser's half: TikTok sends it back to the registered redirect with these params.
const browserReturns = (authUrl, params) => {
  const redirect = new URL(authUrl).searchParams.get('redirect_uri');
  return fetch(`${redirect}?${new URLSearchParams(params)}`);
};
const stateOf = (authUrl) => new URL(authUrl).searchParams.get('state');

const settled = async (wallet) => {
  for (let i = 0; i < 100; i += 1) {
    const r = pollTikTokConnect(wallet);
    if (r.status !== 'pending') return r;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the connect never settled');
};

describe('Login Kit for Desktop: loopback consent → token exchange → sealed token pair', () => {
  test('a full CONNECT: 127.0.0.1 ephemeral port on /callback/, hex PKCE, the exchange shape, the account named, both tokens sealed', async () => {
    const started = await startTikTokConnect(HOUSE);
    expect(started.ok).toBe(true);
    const auth = new URL(started.authUrl);
    expect(`${auth.origin}${auth.pathname}`).toBe('https://www.tiktok.com/v2/auth/authorize/');
    const redirect = auth.searchParams.get('redirect_uri');
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback\/$/);
    expect(auth.searchParams.get('scope')).toBe('user.info.basic,video.publish,video.upload');
    expect(auth.searchParams.get('client_key')).toBe(CLIENT.clientKey);
    expect(auth.searchParams.get('code_challenge')).toMatch(/^[0-9a-f]{64}$/);
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');

    const page = await browserReturns(started.authUrl, { code: 'AUTH-CODE*v!2', state: stateOf(started.authUrl), scopes: 'user.info.basic,video.publish,video.upload' });
    expect(page.status).toBe(200);
    expect(await page.text()).toMatch(/Signed in/);
    const before = Date.now();
    expect(await settled(HOUSE)).toEqual({ status: 'complete', channel: { id: 'open-1', title: 'Deus Neuma' } });

    // The exchange carried exactly what TikTok's token endpoint requires, secret included.
    const [exchange] = tiktok.state.hits.filter((h) => h.leg === 'token');
    expect(exchange.contentType).toMatch(/^application\/x-www-form-urlencoded/);
    expect(Object.keys(exchange.form).sort()).toEqual(['client_key', 'client_secret', 'code', 'code_verifier', 'grant_type', 'redirect_uri']);
    expect(exchange.form).toMatchObject({
      grant_type: 'authorization_code', code: 'AUTH-CODE*v!2', redirect_uri: redirect, client_key: CLIENT.clientKey, client_secret: CLIENT.clientSecret,
    });
    // The verifier the exchange sent is the one the consent committed to, in TikTok's hex form.
    expect(tiktokPkceChallenge(exchange.form.code_verifier)).toBe(auth.searchParams.get('code_challenge'));
    expect(tiktok.state.hits.find((h) => h.leg === 'user')).toMatchObject({ auth: 'Bearer access-1', fields: 'open_id,display_name' });

    // Sealed: resolvable through the one door, the expiry 24h out, absent from the bytes on disk.
    const stored = await resolveChannelCredential(HOUSE, 'tiktok');
    expect(stored).toMatchObject({ ...CLIENT, refreshToken: 'refresh-1', accessToken: 'access-1' });
    expect(Date.parse(stored.accessExpiresAt) - before).toBeGreaterThan(86_000_000);
    const raw = await fs.readFile(channelCredentialsPath(HOUSE), 'utf8');
    for (const secret of ['refresh-1', 'access-1', CLIENT.clientSecret]) expect(raw).not.toContain(secret);

    // The listener closed on the first real answer.
    await expect(fetch(`${redirect}?code=again&state=x`)).rejects.toThrow();
  });

  test('a callback naming another state is refused and seals nothing', async () => {
    const started = await startTikTokConnect(HOUSE);
    expect((await browserReturns(started.authUrl, { code: 'c', state: 'forged' })).status).toBe(400);
    expect((await settled(HOUSE)).error).toMatch(/state mismatch/);
    expect(tiktok.state.hits.filter((h) => h.leg === 'token')).toHaveLength(0);
    expect(await resolveChannelCredential(HOUSE, 'tiktok')).toBeNull();
  });

  test('declining on TikTok\'s page, or a grant without video.publish: refused in plain words, nothing sealed', async () => {
    let started = await startTikTokConnect(HOUSE);
    await browserReturns(started.authUrl, { error: 'access_denied', state: stateOf(started.authUrl) });
    expect((await settled(HOUSE)).error).toMatch(/you declined access on TikTok's page/);

    tiktok.state.tokenMode = 'no-publish-scope';
    started = await startTikTokConnect(HOUSE);
    await browserReturns(started.authUrl, { code: 'c', state: stateOf(started.authUrl) });
    expect((await settled(HOUSE)).error).toMatch(/without video\.publish; check the app has Login Kit and Content Posting/);
    expect(await resolveChannelCredential(HOUSE, 'tiktok')).toBeNull();
  });

  test('no client saved: CONNECT refuses before any listener stands', async () => {
    await removeChannelCredential(HOUSE, 'tiktok');
    expect(await startTikTokConnect(HOUSE)).toEqual({ ok: false, error: expect.stringMatching(/client key and client secret first/) });
  });
});

describe('the token is refreshed BEFORE it expires, and the rotated pair is kept', () => {
  test('fresh: used as is; near expiry: one refresh (secret included), the NEW refresh token sealed; concurrent callers share it', async () => {
    const soon = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await setChannelCredential(HOUSE, 'tiktok', { refreshToken: 'refresh-1', accessToken: 'access-1', accessExpiresAt: new Date(Date.now() + 86_000_000).toISOString() });
    expect(await tiktokAccessFor(HOUSE)).toMatchObject({ ok: true, accessToken: 'access-1' });
    expect(tiktok.state.hits).toEqual([]);

    await setChannelCredential(HOUSE, 'tiktok', { accessExpiresAt: soon });
    const [a, b] = await Promise.all([tiktokAccessFor(HOUSE), tiktokAccessFor(HOUSE)]);
    expect(a.accessToken).toBe('access-r1');
    expect(b.accessToken).toBe('access-r1');
    const refreshes = tiktok.state.hits.filter((h) => h.leg === 'token');
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0].form).toEqual({ client_key: CLIENT.clientKey, client_secret: CLIENT.clientSecret, grant_type: 'refresh_token', refresh_token: 'refresh-1' });
    expect(await resolveChannelCredential(HOUSE, 'tiktok')).toMatchObject({ refreshToken: 'refresh-r1', accessToken: 'access-r1' });
  });

  test('the flight test names the account; a revoked refresh token says reconnect', async () => {
    await setChannelCredential(HOUSE, 'tiktok', { refreshToken: 'refresh-1', accessToken: 'old', accessExpiresAt: new Date(Date.now() - 1000).toISOString() });
    const live = await runFlightTests({ fresh: true, wallet: HOUSE, channels: ['tiktok'] });
    expect(live.tiktok).toMatchObject({ ok: true, account: { id: 'open-1', name: 'Deus Neuma', title: 'Deus Neuma' } });
    expect(tiktok.state.hits.find((h) => h.leg === 'user').auth).toBe('Bearer access-r1');

    await setChannelCredential(HOUSE, 'tiktok', { accessExpiresAt: new Date(Date.now() - 1000).toISOString() });
    tiktok.state.tokenMode = 'revoked';
    const dead = await runFlightTests({ fresh: true, wallet: HOUSE, channels: ['tiktok'] });
    expect(dead.tiktok.ok).toBe(false);
    expect(dead.tiktok.detail).toMatch(/expired or was removed; reconnect TikTok/);
  });
});

describe('the CONNECT routes, behind a real signed-wallet session', () => {
  test('POST opens the consent for the caller\'s own house; GET reads it; DELETE cancels it; no token is ever echoed', async () => {
    const auth = await fullAuth();
    const header = { Authorization: `Bearer ${auth.token}` };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/social-channels', connectRouter);

    expect((await request(app).post('/api/v1/social-channels/tiktok/connect')).status).toBe(401);
    expect((await request(app).post('/api/v1/social-channels/myspace/connect').set(header)).status).toBe(404);
    const refused = await request(app).post('/api/v1/social-channels/tiktok/connect').set(header);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/client key and client secret first/);

    await setChannelCredential(auth.address, 'tiktok', CLIENT);
    const opened = await request(app).post('/api/v1/social-channels/tiktok/connect').set(header);
    expect(opened.status).toBe(200);
    expect(opened.headers['cache-control']).toBe('private, no-store');
    expect(new URL(opened.body.authUrl).searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback\/$/);
    expect((await request(app).get('/api/v1/social-channels/tiktok/connect').set(header)).body).toEqual({ status: 'pending' });
    // The YouTube connect of the same house is its own flow.
    expect((await request(app).get('/api/v1/social-channels/youtube/connect').set(header)).body).toEqual({ status: 'idle' });
    expect(pollTikTokConnect(HOUSE).status).not.toBe('pending');

    expect((await request(app).delete('/api/v1/social-channels/tiktok/connect').set(header)).body).toEqual({ cancelled: true });
    const after = await settled(auth.address);
    expect(after).toEqual({ status: 'error', error: 'the connect was cancelled' });
    expect(JSON.stringify(after)).not.toMatch(/refresh|access-/);
  });
});
