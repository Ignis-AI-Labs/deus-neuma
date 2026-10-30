/**
 * A stored provider key goes only to the endpoint it was stored for.
 *
 * Audit 3 E1 (2026-10-19): the routing routes paired a caller-named endpoint
 * with the stored (or .env) key — POST /test and /connect read the endpoint
 * from the body and the key from the store, and PUT /key with only an
 * endpoint kept the key, so the next GET /models sent it there. Any signed-in
 * wallet could hand the operator's API key to a host of its choosing.
 *
 * Real routing router behind the real requireAuth (session from a real
 * signed SIWE challenge), a temp credential + connection store sealed with
 * the real envelope, and real loopback HTTP sinks on ephemeral ports that
 * record every header they receive. FAKE keys only. No mocks (RULE 0).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { generateChallenge, verifySignature, createSessionToken } from '../../backend/services/auth.js';
import { loadCredentials, saveCredentials, setCredential } from '../../backend/services/provider-credentials.js';
import { listConnections } from '../../backend/services/provider-connections.js';
import routingRouter from '../../backend/routes/routing-routes.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

// Fake keys are built at runtime: no key-shaped text sits in a test file (AGENTS.md Rule 8).
const fakeKey = (words) => ['sk', 'FAKE', words].join('-');
const STORED_KEY = fakeKey('stored-key-for-the-catalog-endpoint');
const ENV_KEY = fakeKey('env-key-for-the-catalog-endpoint');
const CUSTOM_KEY = fakeKey('custom-key-stored-with-its-endpoint');
const BODY_KEY = fakeKey('key-the-request-brought');

/** A loopback model server that records every header value it is sent. */
const startSink = async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(...Object.values(req.headers).map(String));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'sink-model' }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    received: (key) => seen.some((value) => value.includes(key)),
    hits: () => seen.length,
    reset: () => { seen.length = 0; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

let app, token, sink, saved;

beforeAll(async () => {
  saved = {
    creds: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH,
    conns: process.env.NEUMA_CONNECTIONS_PATH,
    env: process.env.ANTHROPIC_API_KEY,
  };
  const dir = await createTempDir('routing-key-pairing');
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(dir, 'provider-credentials.json');
  process.env.NEUMA_CONNECTIONS_PATH = path.join(dir, 'provider-connections.json');

  const wallet = ethers.Wallet.createRandom();
  const challenge = generateChallenge(wallet.address);
  token = createSessionToken(verifySignature(wallet.address, challenge, await wallet.signMessage(challenge)));
  // A fresh install's first owner is seated by the owner claim, never by a first request (owner-claim.js): seated here.
  await makeInstallOwner(wallet.address);

  sink = await startSink();
  app = express();
  app.use(express.json());
  app.use('/api/v1/routing', routingRouter);
});

afterAll(async () => {
  for (const [name, value] of [
    ['NEUMA_PROVIDER_CREDENTIALS_PATH', saved.creds],
    ['NEUMA_CONNECTIONS_PATH', saved.conns],
    ['ANTHROPIC_API_KEY', saved.env],
  ]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await sink.close();
});

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await saveCredentials({});
  sink.reset();
});

const authed = (req) => req.set('Authorization', `Bearer ${token}`);

describe('POST /providers/:id/test — a named endpoint never gets the stored key', () => {
  it('probes the named endpoint without the key stored for the catalog endpoint', async () => {
    await setCredential('anthropic', { apiKey: STORED_KEY });
    const res = await authed(request(app).post('/api/v1/routing/providers/anthropic/test')).send({ endpoint: sink.url });
    expect(res.status).toBe(200);
    expect(sink.hits()).toBeGreaterThan(0);
    expect(sink.received(STORED_KEY)).toBe(false);
  });

  it('a key the request brings goes with the endpoint it names', async () => {
    await setCredential('anthropic', { apiKey: STORED_KEY });
    await authed(request(app).post('/api/v1/routing/providers/anthropic/test')).send({ endpoint: sink.url, apiKey: BODY_KEY });
    expect(sink.received(BODY_KEY)).toBe(true);
    expect(sink.received(STORED_KEY)).toBe(false);
  });

  it('a key stored WITH its endpoint still reaches that endpoint', async () => {
    await setCredential('custom', { apiKey: CUSTOM_KEY, endpoint: sink.url });
    const res = await authed(request(app).post('/api/v1/routing/providers/custom/test')).send({});
    expect(res.body.success).toBe(true);
    expect(sink.received(CUSTOM_KEY)).toBe(true);
  });
});

describe('PUT /providers/:id/key — moving only the endpoint leaves the key behind', () => {
  it('an endpoint-only save drops the stored key, so /models sends none', async () => {
    await setCredential('anthropic', { apiKey: STORED_KEY });
    const put = await authed(request(app).put('/api/v1/routing/providers/anthropic/key')).send({ endpoint: sink.url });
    expect(put.status).toBe(200);
    expect(put.body.provider.hasKey).toBe(false);
    expect((await loadCredentials()).anthropic).toEqual({ endpoint: sink.url });

    await authed(request(app).get('/api/v1/routing/providers/anthropic/models'));
    expect(sink.hits()).toBeGreaterThan(0);
    expect(sink.received(STORED_KEY)).toBe(false);
  });

  it('the .env key never follows a stored endpoint either', async () => {
    process.env.ANTHROPIC_API_KEY = ENV_KEY;
    await authed(request(app).put('/api/v1/routing/providers/anthropic/key')).send({ endpoint: sink.url });
    await authed(request(app).get('/api/v1/routing/providers/anthropic/models'));
    expect(sink.hits()).toBeGreaterThan(0);
    expect(sink.received(ENV_KEY)).toBe(false);
  });

  it('re-saving the SAME endpoint keeps the key', async () => {
    await setCredential('custom', { apiKey: CUSTOM_KEY, endpoint: sink.url });
    await authed(request(app).put('/api/v1/routing/providers/custom/key')).send({ endpoint: sink.url });
    expect((await loadCredentials()).custom).toEqual({ apiKey: CUSTOM_KEY, endpoint: sink.url });
  });
});

describe('POST /providers/:id/connect — no lock carries the stored key elsewhere', () => {
  it('refuses to probe or lock a named endpoint the stored key does not belong to', async () => {
    await setCredential('anthropic', { apiKey: STORED_KEY });
    const res = await authed(request(app).post('/api/v1/routing/providers/anthropic/connect'))
      .send({ endpoint: sink.url, model: 'sink-model' });
    expect(res.status).toBe(400);
    expect(sink.received(STORED_KEY)).toBe(false);
    expect(await listConnections()).toEqual([]);
  });
});
