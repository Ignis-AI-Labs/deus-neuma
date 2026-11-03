// Real signed HTTP for the vision switch, plus effective capability resolution
/* global process, fetch */
// against a real spawned capability endpoint. No mock in the claimed path.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { ownerClaimHeaders } from '../e2e/helpers/owner-claim.js';
import { createAuthRouter } from '../../backend/services/auth.js';
import visionRouter from '../../backend/routes/vision-routes.js';
import { getRouteCapabilities } from '../../backend/services/llm-provider.js';
import { ensureOwnerClaim } from '../../backend/services/owner-claim.js';

describe('vision route and effective capability', () => {
  let dataRoot;
  let server;
  let base;
  let token;
  let previousPath;
  let previousDataRoot;

  beforeAll(async () => {
    previousPath = process.env.NEUMA_VISION_PATH;
    previousDataRoot = process.env.NEUMA_DATA_ROOT;
    dataRoot = await createTempDir('vision-route');
    process.env.NEUMA_DATA_ROOT = dataRoot;
    process.env.NEUMA_VISION_PATH = `${dataRoot}/vision.json`;

    const app = express();
    app.use((req, _res, next) => { req.accessScope = 'local'; next(); });
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter(express));
    app.use('/api/v1/vision', visionRouter);
    app.use('/props', (_req, res) => res.json({ modalities: {} }));
    await new Promise((resolve) => { server = http.createServer(app).listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
    await ensureOwnerClaim();

    const wallet = ethers.Wallet.createRandom();
    const { challenge } = await (await fetch(`${base}/api/v1/auth/challenge?address=${wallet.address}`)).json();
    const signature = await wallet.signMessage(challenge);
    const verified = await fetch(`${base}/api/v1/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ownerClaimHeaders(dataRoot) },
      body: JSON.stringify({ address: wallet.address, signature, challenge }),
    });
    token = (await verified.json()).token;
    expect(token).toBeTruthy();
  });

  afterAll(async () => {
    if (previousPath === undefined) delete process.env.NEUMA_VISION_PATH;
    else process.env.NEUMA_VISION_PATH = previousPath;
    if (previousDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = previousDataRoot;
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  });

  test('unauthenticated reads are refused', async () => {
    expect((await fetch(`${base}/api/v1/vision`)).status).toBe(401);
  });

  test('default on, off and on persist through real install-owner writes', async () => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    expect((await (await fetch(`${base}/api/v1/vision`, { headers })).json()).enabled).toBe(true);

    const off = await fetch(`${base}/api/v1/vision`, { method: 'PUT', headers, body: JSON.stringify({ enabled: false }) });
    expect(off.status).toBe(200);
    expect((await off.json()).enabled).toBe(false);
    expect((await (await fetch(`${base}/api/v1/vision`, { headers })).json()).enabled).toBe(false);

    const on = await fetch(`${base}/api/v1/vision`, { method: 'PUT', headers, body: JSON.stringify({ enabled: true }) });
    expect(on.status).toBe(200);
    expect((await on.json()).enabled).toBe(true);
    expect((await (await fetch(`${base}/api/v1/vision`, { headers })).json()).enabled).toBe(true);
  });

  test('inconclusive capabilities default on and switch flips invalidate the cached answer', async () => {
    const route = { provider: 'llama-server', endpoint: base, model: 'inconclusive-vl', apiKey: '' };
    const first = await getRouteCapabilities(route);
    expect(first.vision).toBe(true);

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    await fetch(`${base}/api/v1/vision`, { method: 'PUT', headers, body: JSON.stringify({ enabled: false }) });
    expect((await getRouteCapabilities(route)).vision).toBe(false);
    await fetch(`${base}/api/v1/vision`, { method: 'PUT', headers, body: JSON.stringify({ enabled: true }) });
    expect((await getRouteCapabilities(route)).vision).toBe(true);
  });
});
