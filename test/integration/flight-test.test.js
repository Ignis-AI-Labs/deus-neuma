/**
 * The flight tests — every channel probed against a REAL loopback
 * platform-shaped server, through the REAL signed/guarded request paths
 * (RULE 0, no mocks): the X probe signs for real (the OAuth header is
 * asserted on the wire), the credential store is the REAL encrypted store
 * on REAL tmp disk, and the route answers through the REAL express app.
 *
 * The env doors are the platform's own: NEUMA_<PLATFORM>_API_ROOT aims each
 * real probe at the loopback; the house's sealed store sits in a tmp realm.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'http';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { setChannelCredential } from '../../backend/services/social/channel-credentials.js';
import { runFlightTests } from '../../backend/services/social/flight-test.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const ENV_KEYS = [
  'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_X_API_ROOT',
  'NEUMA_TELEGRAM_API_ROOT', 'NEUMA_DISCORD_API_ROOT', 'NEUMA_MASTODON_API_ROOT',
  'NEUMA_BLUESKY_API_ROOT', 'NEUMA_FACEBOOK_API_ROOT', 'NEUMA_LINKEDIN_API_ROOT',
];

const CREDS = {
  x: { apiKey: 'k', apiSecret: 's', accessToken: 't', accessSecret: 'a' },
  telegram: { botToken: 'tg-token', chatId: '@house' },
  discord: { botToken: 'dc-token', channelId: '42' },
  mastodon: { instanceUrl: 'mastodon.example', accessToken: 'md-token' },
  bluesky: { service: 'https://bsky.example', identifier: 'house.bsky.example', appPassword: 'bs-pass' },
  facebook: { pageId: 'page-7', accessToken: 'fb-token' },
  linkedin: { personUrn: 'urn:li:person:8675309', accessToken: 'li-token', tokenExpiresAt: '2099-01-01T00:00:00.000Z' },
};

describe('the flight tests (real loopback platforms + real sealed store, gnosis)', () => {
  let house, server, base, app, witness, wallet, priorRealm;
  const hits = [];
  const savedEnv = {};

  beforeAll(async () => {
    house = await createTempDir('flight-test-house');
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; }
    process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = `${house}/social-channel-credentials.json`;
    // Each house proves its OWN connections: keys live in its realm dir.
    priorRealm = getRealmRoot();
    setRealmRoot(`${house}/realm`);
    const auth = await fullAuth();
    wallet = auth.address;
    witness = { header: { Authorization: `Bearer ${auth.token}` } };

    // The loopback platform — one server, every endpoint shape. The wire
    // asserts ride with each hit (auth headers, token-in-path).
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://loopback');
      const json = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const readBody = async () => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        return Buffer.concat(chunks).toString('utf8');
      };
      if (url.pathname === '/2/users/me') {
        hits.push({ platform: 'x', auth: req.headers.authorization || null });
        return json(200, { data: { id: '1000', username: 'neuma_house' } });
      }
      if (url.pathname.startsWith('/bot') && url.pathname.endsWith('/getMe')) {
        const token = url.pathname.slice(4, -'/getMe'.length);
        hits.push({ platform: 'telegram', token });
        if (token !== 'tg-token') return json(401, { ok: false, description: 'Unauthorized' });
        return json(200, { ok: true, result: { id: 555, username: 'house_bot' } });
      }
      if (url.pathname === '/api/v10/users/@me') {
        hits.push({ platform: 'discord', auth: req.headers.authorization || null });
        return json(200, { id: '777', username: 'house#0001' });
      }
      if (url.pathname === '/api/v1/accounts/verify_credentials') {
        hits.push({ platform: 'mastodon', auth: req.headers.authorization || null });
        return json(200, { id: 'md-1', acct: 'house@mastodon.example' });
      }
      if (url.pathname === '/xrpc/com.atproto.server.createSession') {
        const body = JSON.parse(await readBody() || '{}');
        hits.push({ platform: 'bluesky', identifier: body.identifier });
        return json(200, { did: 'did:plc:house', handle: 'house.bsky.example', accessJwt: 'jwt' });
      }
      if (url.pathname === '/v21.0/page-7') {
        hits.push({ platform: 'facebook', token: url.searchParams.get('access_token') });
        return json(200, { id: 'page-7', name: 'The House Page' });
      }
      if (url.pathname === '/v2/userinfo') {
        hits.push({ platform: 'linkedin', auth: req.headers.authorization || null });
        if (req.headers.authorization !== 'Bearer li-token') {
          return json(401, { message: 'Invalid access token' });
        }
        return json(200, { sub: '8675309', name: 'Founder Doe' });
      }
      return json(404, { detail: 'not found' });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    process.env.NEUMA_X_API_ROOT = `${base}/2`;
    process.env.NEUMA_TELEGRAM_API_ROOT = base;
    process.env.NEUMA_DISCORD_API_ROOT = base;
    process.env.NEUMA_MASTODON_API_ROOT = base;
    process.env.NEUMA_BLUESKY_API_ROOT = base;
    process.env.NEUMA_FACEBOOK_API_ROOT = base;
    process.env.NEUMA_LINKEDIN_API_ROOT = base;

    // The REAL sealed store — every channel's keys land encrypted on tmp disk.
    for (const [id, fields] of Object.entries(CREDS)) {
      await setChannelCredential(wallet, id, fields);
    }

    // The session above is a real wallet that claims no workspace — this
    // route carries no neuma lane (RULE 0, #390 tranche 4). No
    // vi.resetModules() runs in this file, so the static import shares the
    // same auth.js instance the router below verifies against.
    const { default: router } = await import('../../backend/routes/social-channel-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/social-channels', router);
  }, 60000);

  afterAll(async () => {
    setRealmRoot(priorRealm);
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(house, { recursive: true, force: true });
  });

  test('every configured channel PROVES — credentials accepted, endpoint answering, the account named', async () => {
    const tests = await runFlightTests({ fresh: true, wallet });
    expect(tests.x).toMatchObject({ ok: true, account: { id: '1000', name: 'neuma_house' } });
    expect(tests.telegram).toMatchObject({ ok: true, account: { id: '555', name: 'house_bot' } });
    expect(tests.discord).toMatchObject({ ok: true, account: { id: '777', name: 'house#0001' } });
    expect(tests.mastodon).toMatchObject({ ok: true, account: { id: 'md-1', name: 'house@mastodon.example' } });
    expect(tests.bluesky).toMatchObject({ ok: true, account: { id: 'did:plc:house', name: 'house.bsky.example' } });
    expect(tests.facebook).toMatchObject({ ok: true, account: { id: 'page-7', name: 'The House Page' } });
    expect(tests.linkedin).toMatchObject({ ok: true, account: { id: '8675309', name: 'Founder Doe' } });
    for (const t of Object.values(tests)) expect(t.checkedAt).toBeTruthy();

    // The wire carried the real auth on every leg.
    const byPlatform = Object.fromEntries(hits.map((h) => [h.platform, h]));
    expect(byPlatform.x.auth).toMatch(/^OAuth /);
    expect(byPlatform.telegram.token).toBe('tg-token');
    expect(byPlatform.discord.auth).toBe('Bot dc-token');
    expect(byPlatform.mastodon.auth).toBe('Bearer md-token');
    expect(byPlatform.bluesky.identifier).toBe('house.bsky.example');
    expect(byPlatform.facebook.token).toBe('fb-token');
    expect(byPlatform.linkedin.auth).toBe('Bearer li-token');
  }, 30000);

  test('a wrong key is an honest FAILURE, not a crash — the platform said so', async () => {
    await setChannelCredential(wallet, 'telegram', { botToken: 'wrong-token' });
    const tests = await runFlightTests({ fresh: true, wallet, channels: ['telegram'] });
    expect(tests.telegram.ok).toBe(false);
    expect(tests.telegram.status).toBe(401);
    expect(tests.telegram.detail).toBe('Unauthorized');
    await setChannelCredential(wallet, 'telegram', { botToken: 'tg-token' });
  }, 30000);

  test('a mortal LinkedIn token carries its expiry warning BESIDE the proof, never instead of it', async () => {
    await setChannelCredential(wallet, 'linkedin', {
      ...CREDS.linkedin,
      tokenExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const tests = await runFlightTests({ fresh: true, wallet, channels: ['linkedin'] });
    expect(tests.linkedin.ok).toBe(true);
    expect(tests.linkedin.account).toEqual({ id: '8675309', name: 'Founder Doe' });
    expect(tests.linkedin.detail).toMatch(/the token expires in [1-3] days/);
    await setChannelCredential(wallet, 'linkedin', CREDS.linkedin);
  }, 30000);

  test('the cache spares the lane: a cached answer never touches the wire; fresh forces it', async () => {
    hits.length = 0;
    await runFlightTests({ fresh: true, wallet, channels: ['discord'] });
    expect(hits.filter((h) => h.platform === 'discord')).toHaveLength(1);
    // Cached — no second probe.
    await runFlightTests({ wallet, channels: ['discord'] });
    expect(hits.filter((h) => h.platform === 'discord')).toHaveLength(1);
    // Fresh — the RE-TEST act really probes again.
    await runFlightTests({ fresh: true, wallet, channels: ['discord'] });
    expect(hits.filter((h) => h.platform === 'discord')).toHaveLength(2);
  }, 30000);

  test('an unconfigured channel answers ok:null — nothing to prove, never an error', async () => {
    const { removeChannelCredential } = await import('../../backend/services/social/channel-credentials.js');
    await removeChannelCredential(wallet, 'mastodon');
    const tests = await runFlightTests({ fresh: true, wallet, channels: ['mastodon'] });
    expect(tests.mastodon.ok).toBeNull();
    expect(tests.mastodon.detail).toMatch(/not configured/);
    await setChannelCredential(wallet, 'mastodon', CREDS.mastodon);
  }, 30000);

  test('the route answers through the REAL app, and ?fresh=1 forces the probe', async () => {
    hits.length = 0;
    const res = await request(app).get('/api/v1/social-channels/flight-test').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.tests.x.ok).toBe(true);
    const hitsAfterFirst = hits.length;
    const fresh = await request(app).get('/api/v1/social-channels/flight-test?fresh=1').set(witness.header);
    expect(fresh.status).toBe(200);
    expect(hits.length).toBeGreaterThan(hitsAfterFirst);
  }, 30000);
});
