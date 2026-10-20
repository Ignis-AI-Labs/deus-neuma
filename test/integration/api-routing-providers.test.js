/**
 * Provider-admin routing routes (integration). Real Express + real encrypted
 * credentials store (temp path) + a real fake-provider HTTP server for the
 * live model list. Auth is a real witness session (RULE 0, #390 tranche 4);
 * the credential store, SSRF guard, and registry all run for real.
 */
import express from 'express';
import request from 'supertest';
import http from 'http';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { PROVIDER_CATALOG } from '../../backend/services/provider-registry.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const ENV_KEYS = [...new Set(PROVIDER_CATALOG.map((e) => e.keyEnv).filter(Boolean))];
let app;
let server;
let saved;
let witness;

const startFakeProvider = () => new Promise((resolve) => {
  server = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }));
    } else {
      res.writeHead(404); res.end();
    }
  });
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

beforeEach(async () => {
  vi.resetModules();
  saved = { creds: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH };
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  const dir = await createTempDir(`routing-api-${Math.random().toString(36).slice(2)}`);
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(dir, 'creds.json');

  // Imported AFTER resetModules so the witness mints its token from the
  // same auth.js instance the router will verify against.
  const { strangerWitness } = await import('../helpers/witness.js');
  // This router carries no neuma lane (global provider admin) — a real
  // session that claims no workspace is exactly the right shape.
  witness = strangerWitness();
  await makeInstallOwner(witness.address);

  const { default: router } = await import('../../backend/routes/routing-routes.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1/routing', router);
});

afterEach(() => new Promise((r) => {
  if (saved.creds === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
  else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = saved.creds;
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.restoreAllMocks();
  server ? server.close(() => { server = null; r(); }) : r();
}));

describe('GET /providers', () => {
  test('lists the whole catalog with masked state and no raw keys', async () => {
    const res = await request(app).get('/api/v1/routing/providers').set(witness.header);
    expect(res.status).toBe(200);
    const ids = res.body.providers.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['lm-studio', 'anthropic', 'z-ai', 'custom']));
    const anthropic = res.body.providers.find((p) => p.id === 'anthropic');
    expect(anthropic).toMatchObject({ hasKey: false, keyMasked: '', requiresKey: true });
    expect(JSON.stringify(res.body)).not.toContain('apiKey');
  });
});

describe('PUT/DELETE /providers/:id/key', () => {
  test('stores a key (masked in the response) and reflects hasKey on the list', async () => {
    const put = await request(app).put('/api/v1/routing/providers/anthropic/key').set(witness.header).send({ apiKey: 'sk-ant-SECRET' });
    expect(put.status).toBe(200);
    expect(put.body.provider).toMatchObject({ hasKey: true, keyMasked: '***' });
    expect(JSON.stringify(put.body)).not.toContain('sk-ant-SECRET');

    const list = await request(app).get('/api/v1/routing/providers').set(witness.header);
    expect(list.body.providers.find((p) => p.id === 'anthropic').hasKey).toBe(true);

    const del = await request(app).delete('/api/v1/routing/providers/anthropic/key').set(witness.header);
    expect(del.body.removed).toBe(true);
    expect(del.body.provider.hasKey).toBe(false);
  });

  test('refuses a custom endpoint that targets a private/metadata address (SSRF)', async () => {
    const res = await request(app).put('/api/v1/routing/providers/custom/key').set(witness.header)
      .send({ apiKey: 'k', endpoint: 'http://169.254.169.254/latest/meta-data' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/refused/i);
  });

  test('accepts a localhost custom endpoint (local model server)', async () => {
    const res = await request(app).put('/api/v1/routing/providers/custom/key').set(witness.header)
      .send({ endpoint: 'http://127.0.0.1:1234/v1' });
    expect(res.status).toBe(200);
  });

  test('unknown provider is 404', async () => {
    const res = await request(app).put('/api/v1/routing/providers/nope/key').set(witness.header).send({ apiKey: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('GET /providers/:id/models (live + curated fallback)', () => {
  test('returns the provider live list when reachable', async () => {
    const port = await startFakeProvider();
    await request(app).put('/api/v1/routing/providers/custom/key').set(witness.header)
      .send({ apiKey: 'k', endpoint: `http://127.0.0.1:${port}/v1` });
    const res = await request(app).get('/api/v1/routing/providers/custom/models').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.models.map((m) => m.id)).toEqual(['model-a', 'model-b']);
  });

  test('falls back to curated ids when the provider is unreachable', async () => {
    // anthropic with no reachable list → curated fallback (documented defaults)
    const res = await request(app).get('/api/v1/routing/providers/anthropic/models').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.models.map((m) => m.id)).toContain('claude-haiku-4-5-20251001');
  });

  test('keeps the full curated Z.AI list when live discovery is partial or unavailable', async () => {
    const res = await request(app).get('/api/v1/routing/providers/z-ai/models').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.models.map((m) => m.id)).toEqual(expect.arrayContaining([
      'glm-5.2', 'glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.6', 'glm-4.5-air',
    ]));
    expect(res.body.models.length).toBeGreaterThan(10);
  });
});

describe('keyed services (Tavily) — own routes, never a provider', () => {
  test('GET /providers never lists a service; GET /services lists it masked', async () => {
    const providers = await request(app).get('/api/v1/routing/providers').set(witness.header);
    expect(providers.body.providers.some((p) => p.id === 'tavily' || p.kind === 'service')).toBe(false);

    const services = await request(app).get('/api/v1/routing/services').set(witness.header);
    expect(services.status).toBe(200);
    expect(services.body.services).toEqual([expect.objectContaining({
      id: 'tavily', kind: 'service', service: 'web-search', endpoint: 'https://api.tavily.com',
      requiresKey: true, hasKey: false, keyMasked: '',
    })]);
  });

  test('PUT stores the key masked, the broker resolves it, DELETE clears it', async () => {
    const put = await request(app).put('/api/v1/routing/services/tavily/key').set(witness.header)
      .send({ apiKey: '  tvly-SECRET  ' });
    expect(put.status).toBe(200);
    expect(put.body.service).toMatchObject({ id: 'tavily', hasKey: true, keyMasked: '***' });
    expect(JSON.stringify(put.body)).not.toContain('tvly-SECRET');

    // Same module graph as the router (imported after resetModules), so this is
    // the exact broker call the benchmarks relay makes.
    const { resolveUsableCredential } = await import('../../backend/services/oauth-token-broker.js');
    expect(await resolveUsableCredential('tavily')).toEqual({ apiKey: 'tvly-SECRET', endpoint: 'https://api.tavily.com' });

    const del = await request(app).delete('/api/v1/routing/services/tavily/key').set(witness.header);
    expect(del.body).toMatchObject({ success: true, removed: true, service: { hasKey: false } });
    expect((await resolveUsableCredential('tavily')).apiKey).toBe('');
  });

  test('an empty key is refused; a provider id is not a service', async () => {
    const empty = await request(app).put('/api/v1/routing/services/tavily/key').set(witness.header).send({ apiKey: '  ' });
    expect(empty.status).toBe(400);
    const provider = await request(app).put('/api/v1/routing/services/anthropic/key').set(witness.header).send({ apiKey: 'x' });
    expect(provider.status).toBe(404);
  });

  test('every chat-only provider route refuses a service id', async () => {
    const calls = [
      request(app).get('/api/v1/routing/providers/tavily/models'),
      request(app).put('/api/v1/routing/providers/tavily/key').send({ apiKey: 'x' }),
      request(app).post('/api/v1/routing/providers/tavily/test').send({}),
      request(app).post('/api/v1/routing/providers/tavily/connect').send({ model: 'm' }),
      request(app).post('/api/v1/routing/providers/tavily/oauth/start').send({}),
    ];
    for (const res of await Promise.all(calls.map((c) => c.set(witness.header)))) {
      expect(res.status).toBe(404);
    }
  });

  test('service routes need a real session', async () => {
    const res = await request(app).put('/api/v1/routing/services/tavily/key').send({ apiKey: 'x' });
    expect(res.status).toBe(401);
  });
});
