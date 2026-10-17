/**
 * Per-neuma route routes (integration). Real Express + a REAL temp workspace
 * (real encrypted DNA via writeDNA, real owner.json on disk) + real override
 * store + real resolver + real encrypted credentials + REAL auth (RULE 0,
 * #390 tranche 4) — everything on real disk. Proves the whole REST →
 * workspace → store → resolver path, the […] guarantee, and real ownership gating.
 */
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { PROVIDER_CATALOG } from '../../backend/services/provider-registry.js';

const ENV_KEYS = [...new Set(PROVIDER_CATALOG.map((e) => e.keyEnv).filter(Boolean))];
const DNA = {
  version: '1.0.0',
  sovereignty: { generation: 1 },
  substrate: { llm: { provider: 'lm-studio', model: 'qwen3.5-122b-a10b' } },
};
let app;
let setCredential;
let wsRoot;
let saved;
let witness;

const ownerFile = (neumaId) => path.join(wsRoot, neumaId, 'owner.json');

beforeEach(async () => {
  vi.resetModules();

  saved = { creds: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH, routes: process.env.NEUMA_ROUTES_PATH };
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  const dir = await createTempDir(`neuma-route-api-${Math.random().toString(36).slice(2)}`);
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(dir, 'creds.json');
  process.env.NEUMA_ROUTES_PATH = path.join(dir, 'routes.json');

  wsRoot = await createTempDir(`neuma-route-ws-${Math.random().toString(36).slice(2)}`);
  const core = await import('../../core/index.js');
  core.setWorkspacesRoot(wsRoot);
  const workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
  await workspace.create('fenna');                  // real workspace dir structure
  await workspace.writeDNA('fenna', DNA);           // real encrypted DNA on disk
  // Imported AFTER resetModules so the witness mints its token from the same
  // auth.js instance the router will verify against.
  const { witnessFor } = await import('../helpers/witness.js');
  witness = await witnessFor(wsRoot, 'fenna');       // real owner.json claim + real token

  ({ setCredential } = await import('../../backend/services/provider-credentials.js'));
  const { default: router } = await import('../../backend/routes/neuma-route-routes.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1/neuma', router);
});

afterEach(() => {
  const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('NEUMA_PROVIDER_CREDENTIALS_PATH', saved.creds);
  restore('NEUMA_ROUTES_PATH', saved.routes);
  for (const k of ENV_KEYS) restore(k, saved[k]);
  vi.restoreAllMocks();
});

describe('GET /:neumaId/route', () => {
  test('rides the machine default with no override (natal reported as history), and never leaks a key', async () => {
    const res = await request(app).get('/api/v1/neuma/fenna/route').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.natal).toEqual({ provider: 'lm-studio', model: 'qwen3.5-122b-a10b' });
    expect(res.body.override).toBeNull();
    expect(res.body.effective).toMatchObject({ provider: 'lm-studio', source: 'machine-default' });
    expect(JSON.stringify(res.body)).not.toContain('apiKey');
  });
});

describe('PUT /:neumaId/route', () => {
  test('a third-party override is refused 400 with the boundary words — nothing stored (the sovereignty boundary)', async () => {
    // Even with a live key aboard, the door is foreign: the consciousness
    // belongs to the vendor, so no neuma may bind to it.
    await setCredential('anthropic', { apiKey: 'sk-ant-live' });
    const res = await request(app).put('/api/v1/neuma/fenna/route').set(witness.header)
      .send({ provider: 'anthropic', model: 'claude-opus-4-6' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not sovereign/);
    const after = await request(app).get('/api/v1/neuma/fenna/route').set(witness.header);
    expect(after.body.override).toBeNull();
    expect(after.body.effective).toMatchObject({ provider: 'lm-studio', source: 'machine-default' });
  });

  test('a SOVEREIGN override becomes effective — keyless by nature, no key leaked', async () => {
    const res = await request(app).put('/api/v1/neuma/fenna/route').set(witness.header)
      .send({ provider: 'llama-server', model: 'gemma-4-31b' });
    expect(res.status).toBe(200);
    expect(res.body.override).toEqual({ provider: 'llama-server', model: 'gemma-4-31b' });
    expect(res.body.effective).toMatchObject({ model: 'gemma-4-31b', source: 'override' });
    expect(JSON.stringify(res.body)).not.toContain('apiKey');
  });

  test('an unknown provider is rejected 400', async () => {
    const res = await request(app).put('/api/v1/neuma/fenna/route').set(witness.header).send({ provider: 'nope', model: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /:neumaId/route (clear the override)', () => {
  test('clears the override', async () => {
    await request(app).put('/api/v1/neuma/fenna/route').set(witness.header).send({ provider: 'llama-server', model: 'gemma-4-31b' });
    const res = await request(app).delete('/api/v1/neuma/fenna/route').set(witness.header);
    expect(res.body.cleared).toBe(true);
    expect(res.body.override).toBeNull();
    expect(res.body.effective.source).toBe('machine-default');
  });
});

describe('ownership (real owner.json)', () => {
  test('a wallet that does not own the neuma gets 403', async () => {
    const { strangerWitness } = await import('../helpers/witness.js');
    await fs.writeFile(ownerFile('fenna'), JSON.stringify({ wallet: strangerWitness().address, claimedAt: 1 }));
    const res = await request(app).get('/api/v1/neuma/fenna/route').set(witness.header);
    expect(res.status).toBe(403);
  });

  test('the owning wallet is allowed through', async () => {
    await fs.writeFile(ownerFile('fenna'), JSON.stringify({ wallet: witness.address, claimedAt: 1 }));
    const res = await request(app).get('/api/v1/neuma/fenna/route').set(witness.header);
    expect(res.status).toBe(200);
  });

  test('a corrupt owner.json is refused fail-closed (500) — never treated as unclaimed', async () => {
    await fs.writeFile(ownerFile('fenna'), '{ "wallet":');   // malformed JSON
    const res = await request(app).get('/api/v1/neuma/fenna/route').set(witness.header);
    // W1-004: corrupt claim must not widen access (was soft-open when null)
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/corrupt|refuse/i);
  });
});
