// A PAIRED PHONE NEVER REWRITES A WALLET'S CONSENT OR A HOUSE'S POSTING CREDENTIALS (re-audit
// 2026-10-29, NEW-M1). The local-only tier already held the substrate and the licence; the wallet
// allowlist, the autonomous-spend threshold and the social credential/app/account/connect writes
// were reachable from the tailnet. A real Express app guarded exactly as server.js guards it — the
// access middleware over a real remote store on a tmp file, the real local-only tier
// (mountRemoteRoutes), then the REAL wallet and social routers — asked over raw HTTP by a phone
// paired through the real claim (device cookie, then a real session token in the paired wallet's
// name). No mocks (RULE 0).
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRemoteStore } from '../../backend/services/remote/remote-store.js';
import { createAccessGuard } from '../../backend/services/remote/access-guard.js';
import { createEnrollRouter, createRemoteRouter } from '../../backend/routes/remote-routes.js';
import { mountRemoteRoutes } from '../../backend/services/remote/wire.js';
import { createPairing, _clearPairings } from '../../backend/services/remote/pairing.js';
import { createSessionToken } from '../../backend/services/auth.js';
import neumaWalletRouter from '../../backend/routes/neuma-wallet-routes.js';
import socialConnectRouter from '../../backend/routes/social-connect-routes.js';
import socialAccountRouter from '../../backend/routes/social-account-routes.js';
import socialChannelRouter from '../../backend/routes/social-channel-routes.js';

const ENROLLED = 'phone.test.ts.net';
const WALLET = '0x67f39a66108068b66c1c409f71c81f5697e990cf';
const PHONE = Object.freeze({ host: ENROLLED, 'x-forwarded-for': '100.64.0.5' });

const WRITES = Object.freeze([
  ['POST', '/api/v1/neuma/probe-being/wallet/allowlist', { address: '0x000000000000000000000000000000000000dEaD' }],
  ['PUT', '/api/v1/neuma/probe-being/wallet/threshold', { thresholdEth: 5 }],
  ['PUT', '/api/v1/social-channels/x/credentials', { apiKey: 'k' }],
  ['DELETE', '/api/v1/social-channels/x/credentials', {}],
  ['POST', '/api/v1/social-channels/accounts', { channelId: 'x' }],
  ['POST', '/api/v1/social-channels/accounts/unlock', {}],
  ['POST', '/api/v1/social-channels/accounts/start-fresh', {}],
  ['PUT', '/api/v1/social-channels/accounts/x-1/credentials', { apiKey: 'k' }],
  ['DELETE', '/api/v1/social-channels/accounts/x-1', {}],
  ['PUT', '/api/v1/social-channels/apps/youtube', { clientId: 'attacker-app' }],
  ['POST', '/api/v1/social-channels/youtube/connect', {}],
]);

let dir; let server; let port; let cookie; let phoneToken;
const call = (method, urlPath, headers = {}, body = null) => new Promise((resolve, reject) => {
  const payload = body ? JSON.stringify(body) : null;
  const req = http.request({
    host: '127.0.0.1', port, method, path: urlPath,
    headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) },
  }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { text += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
  });
  req.on('error', reject);
  req.end(payload || undefined);
});

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-remote-tier-'));
  const store = createRemoteStore({ path: path.join(dir, 'remote.json') });
  await store.save({ enabled: true, origin: ENROLLED, devices: [] });
  const guard = createAccessGuard({ store });
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  app.use(guard.middleware);
  app.use('/r', createEnrollRouter({ store }));
  app.use('/api/v1/remote', createRemoteRouter({ store }));
  mountRemoteRoutes(app); // the local-only tier, as server.js mounts it before the routers
  app.use('/api/v1/social-channels', socialConnectRouter);
  app.use('/api/v1/social-channels', socialAccountRouter);
  app.use('/api/v1/social-channels', socialChannelRouter);
  app.use('/api/v1/neuma', neumaWalletRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  const { code } = createPairing(WALLET);
  const claimed = await call('GET', `/r/${code}`, { ...PHONE, 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1' });
  cookie = String(claimed.headers['set-cookie']?.[0]).split(';')[0];
  phoneToken = JSON.parse((await call('POST', '/api/v1/remote/session', { ...PHONE, cookie })).body).token;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
  _clearPairings();
});

describe('the paired phone, signed in as its wallet', () => {
  it('holds a real session in the paired wallet\'s name', () => {
    expect(typeof phoneToken).toBe('string');
    expect(phoneToken.length).toBeGreaterThan(20);
  });

  it.each(WRITES)('%s %s is refused as local only', async (method, urlPath, body) => {
    const r = await call(method, urlPath, { ...PHONE, cookie, origin: `https://${ENROLLED}`, authorization: `Bearer ${phoneToken}` }, body);
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body).error).toBe('local only');
  });
});

describe('the desk', () => {
  it.each(WRITES)('%s %s passes the tier to its router', async (method, urlPath, body) => {
    const r = await call(method, urlPath, { host: 'localhost', authorization: `Bearer ${createSessionToken(WALLET)}` }, body);
    expect(r.body.includes('local only')).toBe(false);
  });
});
