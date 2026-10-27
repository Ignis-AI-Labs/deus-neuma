/**
 * YouTube CONNECT on the real wire (integration, RULE 0 — no mocks).
 *
 * WHAT THE LOCAL SERVER STANDS IN FOR: one real HTTP server on 127.0.0.1
 * plays two Google hosts — `oauth2.googleapis.com/token` (the OAuth token
 * endpoint: authorization-code exchange and refresh) and
 * `www.googleapis.com/youtube/v3/channels` (the Data API's […]). It answers in the shapes Google documents. It is NOT Google: whether
 * Google itself accepts this client, these scopes and this redirect is proven
 * only by `scripts/youtube-post-verify.mjs` with the operator's own client.
 *
 * Everything else is the real thing: the platform's loopback receiver binds
 * a real ephemeral port, this test plays the browser by making the real
 * redirect request Google would send it, the real exchange goes over HTTP,
 * and the refresh token lands in the house's real AES-256-GCM credential
 * store on temp disk (realm isolated, no real keys anywhere). The routes are
 * driven through a real signed-wallet session.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { pkceChallenge } from '../../backend/services/social/youtube-oauth.js';
import {
  setChannelCredential, resolveChannelCredential, removeChannelCredential, channelCredentialsPath,
} from '../../backend/services/social/channel-credentials.js';
import { startYouTubeConnect, pollYouTubeConnect } from '../../backend/services/social/youtube-connect.js';
import { runFlightTests } from '../../backend/services/social/flight-test.js';
import youtubeRouter from '../../backend/routes/social-connect-routes.js';

const HOUSE = `0x${'7a'.repeat(20)}`;
const CLIENT = Object.freeze({ clientId: 'cid-123.apps.googleusercontent.com', clientSecret: 'stand-in-secret' });
const UPLOAD = 'https://www.googleapis.com/auth/youtube.upload';
const READONLY = 'https://www.googleapis.com/auth/youtube.readonly';
const ENV = ['NEUMA_GOOGLE_TOKEN_URL', 'NEUMA_YOUTUBE_API_ROOT', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'];

let server;
let saved;
let priorRealm;
let tokenHits;
let apiHits;
let tokenMode; // 'ok' | 'no-refresh' | 'no-upload-scope' | 'revoked'

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://stand-in');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/token' && req.method === 'POST') {
      const form = Object.fromEntries(new URLSearchParams(raw));
      tokenHits.push({ contentType: req.headers['content-type'], form });
      if (form.grant_type === 'refresh_token') {
        if (tokenMode === 'revoked') return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        return json(200, { access_token: 'access-refreshed', expires_in: 3599, token_type: 'Bearer' });
      }
      return json(200, {
        access_token: 'access-1',
        expires_in: 3599,
        token_type: 'Bearer',
        scope: tokenMode === 'no-upload-scope' ? READONLY : `${UPLOAD} ${READONLY}`,
        ...(tokenMode === 'no-refresh' ? {} : { refresh_token: 'refresh-1' }),
      });
    }
    if (url.pathname === '/youtube/v3/channels') {
      apiHits.push({ auth: req.headers.authorization, query: Object.fromEntries(url.searchParams) });
      return json(200, { items: [{ id: 'UC-house', snippet: { title: 'Deus Neuma', customUrl: '@deusneuma' } }] });
    }
    return json(404, { error: { message: 'not found' } });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  process.env.NEUMA_GOOGLE_TOKEN_URL = `${root}/token`;
  process.env.NEUMA_YOUTUBE_API_ROOT = root;
  priorRealm = getRealmRoot();
  setRealmRoot(path.join(await createTempDir('youtube-oauth'), 'realm'));
});

afterAll(async () => {
  setRealmRoot(priorRealm);
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  tokenHits = [];
  apiHits = [];
  tokenMode = 'ok';
  await removeChannelCredential(HOUSE, 'youtube');
  await setChannelCredential(HOUSE, 'youtube', CLIENT);
});

// The browser's half: Google sends it back to the redirect URI with these params.
const browserReturns = (authUrl, params) => {
  const redirect = new URL(authUrl).searchParams.get('redirect_uri');
  return fetch(`${redirect}/?${new URLSearchParams(params)}`);
};

const settled = async (wallet) => {
  for (let i = 0; i < 100; i += 1) {
    const r = pollYouTubeConnect(wallet);
    if (r.status !== 'pending') return r;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the connect never settled');
};

describe('the loopback consent → token exchange → sealed refresh token', () => {
  test('a full CONNECT: ephemeral 127.0.0.1 port, PKCE S256, the exchange shape, the channel named, the token sealed', async () => {
    const started = await startYouTubeConnect(HOUSE);
    expect(started.ok).toBe(true);
    const auth = new URL(started.authUrl);
    const redirect = auth.searchParams.get('redirect_uri');
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(auth.searchParams.get('scope')).toBe(`${UPLOAD} ${READONLY}`);
    expect(auth.searchParams.get('client_id')).toBe(CLIENT.clientId);
    expect(pollYouTubeConnect(HOUSE).status).toBe('pending');

    const page = await browserReturns(started.authUrl, { code: 'AUTH-CODE', state: auth.searchParams.get('state'), scope: `${UPLOAD} ${READONLY}` });
    expect(page.status).toBe(200);
    expect(await page.text()).toMatch(/Signed in/);

    const outcome = await settled(HOUSE);
    expect(outcome).toEqual({ status: 'complete', channel: { id: 'UC-house', title: 'Deus Neuma', handle: 'deusneuma' } });

    // The exchange carried exactly what Google's desktop flow requires.
    expect(tokenHits).toHaveLength(1);
    const [{ contentType, form }] = tokenHits;
    expect(contentType).toMatch(/^application\/x-www-form-urlencoded/);
    expect(Object.keys(form).sort()).toEqual(['client_id', 'client_secret', 'code', 'code_verifier', 'grant_type', 'redirect_uri']);
    expect(form).toMatchObject({
      grant_type: 'authorization_code', code: 'AUTH-CODE', redirect_uri: redirect,
      client_id: CLIENT.clientId, client_secret: CLIENT.clientSecret,
    });
    // The verifier the exchange sent is the one the consent URL committed to.
    expect(pkceChallenge(form.code_verifier)).toBe(auth.searchParams.get('code_challenge'));
    expect(apiHits[0]).toMatchObject({ auth: 'Bearer access-1', query: { part: 'snippet', mine: 'true' } });

    // Sealed: resolvable through the one door, absent from the bytes on disk.
    expect(await resolveChannelCredential(HOUSE, 'youtube')).toEqual({ ...CLIENT, refreshToken: 'refresh-1' });
    const raw = await fs.readFile(channelCredentialsPath(HOUSE), 'utf8');
    expect(raw).not.toContain('refresh-1');
    expect(raw).not.toContain(CLIENT.clientSecret);

    // The listener closed on the first real answer.
    await expect(fetch(`${redirect}/?code=again&state=x`)).rejects.toThrow();
  });

  test('a callback that names another state is refused and seals nothing', async () => {
    const started = await startYouTubeConnect(HOUSE);
    const page = await browserReturns(started.authUrl, { code: 'AUTH-CODE', state: 'forged' });
    expect(page.status).toBe(400);
    const outcome = await settled(HOUSE);
    expect(outcome.status).toBe('error');
    expect(outcome.error).toMatch(/state mismatch/);
    expect(tokenHits).toHaveLength(0);
    expect(await resolveChannelCredential(HOUSE, 'youtube')).toBeNull();
  });

  test('declining on Google\'s page, no refresh token, or an unticked upload box: each refused in plain words', async () => {
    let started = await startYouTubeConnect(HOUSE);
    await browserReturns(started.authUrl, { error: 'access_denied', state: new URL(started.authUrl).searchParams.get('state') });
    expect((await settled(HOUSE)).error).toMatch(/you declined access/);

    tokenMode = 'no-refresh';
    started = await startYouTubeConnect(HOUSE);
    await browserReturns(started.authUrl, { code: 'c', state: new URL(started.authUrl).searchParams.get('state') });
    expect((await settled(HOUSE)).error).toMatch(/no refresh token.*myaccount\.google\.com\/permissions/);

    tokenMode = 'no-upload-scope';
    started = await startYouTubeConnect(HOUSE);
    await browserReturns(started.authUrl, { code: 'c', state: new URL(started.authUrl).searchParams.get('state') });
    expect((await settled(HOUSE)).error).toMatch(/without youtube\.upload/);
    expect(await resolveChannelCredential(HOUSE, 'youtube')).toBeNull();
  });

  test('no client saved: CONNECT refuses before any listener stands', async () => {
    await removeChannelCredential(HOUSE, 'youtube');
    const started = await startYouTubeConnect(HOUSE);
    expect(started).toEqual({ ok: false, error: expect.stringMatching(/save the OAuth client id and client secret first/) });
  });
});

describe('the stored connection proves itself (flight test, refresh grant)', () => {
  test('a refresh-token grant names the channel; a revoked token says reconnect', async () => {
    await setChannelCredential(HOUSE, 'youtube', { refreshToken: 'refresh-1' });
    const live = await runFlightTests({ fresh: true, wallet: HOUSE, channels: ['youtube'] });
    expect(live.youtube).toMatchObject({ ok: true, account: { id: 'UC-house', name: 'deusneuma', title: 'Deus Neuma' } });
    expect(tokenHits.at(-1).form).toEqual({
      client_id: CLIENT.clientId, client_secret: CLIENT.clientSecret, refresh_token: 'refresh-1', grant_type: 'refresh_token',
    });
    expect(apiHits.at(-1).auth).toBe('Bearer access-refreshed');

    tokenMode = 'revoked';
    const dead = await runFlightTests({ fresh: true, wallet: HOUSE, channels: ['youtube'] });
    expect(dead.youtube.ok).toBe(false);
    expect(dead.youtube.detail).toMatch(/revoked or has expired; reconnect YouTube/);
  });
});

describe('the CONNECT routes, behind a real signed-wallet session', () => {
  test('POST opens the consent for the caller\'s own house; GET reads it; DELETE cancels it; no token is ever echoed', async () => {
    const auth = await fullAuth();
    const header = { Authorization: `Bearer ${auth.token}` };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/social-channels', youtubeRouter);

    expect((await request(app).post('/api/v1/social-channels/youtube/connect')).status).toBe(401);
    const refused = await request(app).post('/api/v1/social-channels/youtube/connect').set(header);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/client id and client secret first/);

    await setChannelCredential(auth.address, 'youtube', CLIENT);
    const opened = await request(app).post('/api/v1/social-channels/youtube/connect').set(header);
    expect(opened.status).toBe(200);
    expect(opened.headers['cache-control']).toBe('private, no-store');
    expect(new URL(opened.body.authUrl).searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await request(app).get('/api/v1/social-channels/youtube/connect').set(header)).body).toEqual({ status: 'pending' });
    // Another house sees nothing of this one's connect.
    expect(pollYouTubeConnect(HOUSE).status).not.toBe('pending');

    expect((await request(app).delete('/api/v1/social-channels/youtube/connect').set(header)).body).toEqual({ cancelled: true });
    const after = await settled(auth.address);
    expect(after).toEqual({ status: 'error', error: 'the connect was cancelled' });
    expect(JSON.stringify(after)).not.toMatch(/refresh|access-/);
  });
});
