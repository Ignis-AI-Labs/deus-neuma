/**
 * CLI routing lib against the REAL routing + neuma-route routers (real Express,
 * real encrypted credential store + real override store + real workspace DNA on
 * temp paths, real fetch over a real socket). Auth is a real witness session
 * (RULE 0, #390 tranche 4) that genuinely owns the fenna lane.
 * Proves the CLI's HTTP wrappers actually drive the REST surface end to end.
 */
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { PROVIDER_CATALOG } from '../../backend/services/provider-registry.js';
import * as routing from '../../cli/lib/routing.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const ENV_KEYS = [...new Set(PROVIDER_CATALOG.map((e) => e.keyEnv).filter(Boolean))];
let server;
let base;
let saved;
let witness, TOKEN;

beforeEach(async () => {
  vi.resetModules();
  saved = { creds: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH, routes: process.env.NEUMA_ROUTES_PATH };
  const dir = await createTempDir(`cli-routing-${Math.random().toString(36).slice(2)}`);
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(dir, 'creds.json');
  process.env.NEUMA_ROUTES_PATH = path.join(dir, 'routes.json');

  const wsRoot = await createTempDir(`cli-routing-ws-${Math.random().toString(36).slice(2)}`);
  const core = await import('../../core/index.js');
  core.setWorkspacesRoot(wsRoot);
  const workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
  await workspace.create('fenna');
  await workspace.writeDNA('fenna', { version: '1.0.0', sovereignty: { generation: 1 }, substrate: { llm: { provider: 'lm-studio', model: 'qwen3.5-122b-a10b' } } });

  // Imported AFTER resetModules so the witness mints its token from the
  // same auth.js instance the router will verify against.
  const { witnessFor } = await import('../helpers/witness.js');
  witness = await witnessFor(wsRoot, 'fenna'); // claims owner.json AND mints a paired token
  await makeInstallOwner(witness.address);
  TOKEN = witness.token;

  const routingRouter = (await import('../../backend/routes/routing-routes.js')).default;
  const neumaRouteRouter = (await import('../../backend/routes/neuma-route-routes.js')).default;

  // Clear provider key env vars after the imports. Importing core no longer
  // loads .env (core's recall stopped importing natural's package root, whose
  // storage adapters called dotenv, on 2026-10-19); clearing last still wins
  // if an import ever sets one again. The route handlers read process.env at
  // request time, so clearing here is what they see.
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  const app = express();
  app.use(express.json());
  app.use('/api/v1/routing', routingRouter);
  app.use('/api/v1/neuma', neumaRouteRouter);
  server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => new Promise((r) => {
  const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('NEUMA_PROVIDER_CREDENTIALS_PATH', saved.creds);
  restore('NEUMA_ROUTES_PATH', saved.routes);
  for (const k of ENV_KEYS) restore(k, saved[k]);
  vi.restoreAllMocks();
  server ? server.close(() => { server = null; r(); }) : r();
}));

test('listProviders returns the catalog and formats it', async () => {
  const { providers } = await routing.listProviders(base, TOKEN);
  expect(providers.find((p) => p.id === 'anthropic')).toMatchObject({ hasKey: false });
  expect(routing.formatProviders(providers)).toMatch(/lm-studio/);
});

test('setProviderKey configures a provider; listProviders reflects it', async () => {
  await routing.setProviderKey(base, TOKEN, 'anthropic', { apiKey: 'sk-ant' });
  const { providers } = await routing.listProviders(base, TOKEN);
  expect(providers.find((p) => p.id === 'anthropic').hasKey).toBe(true);
});

test('set → get → clear a neuma route (sovereign override then back to the machine default)', async () => {
  const set = await routing.setNeumaRoute(base, TOKEN, 'fenna', { provider: 'llama-server', model: 'gemma-4-31b' });
  expect(set.effective).toMatchObject({ model: 'gemma-4-31b', source: 'override' });

  const got = await routing.getNeumaRoute(base, TOKEN, 'fenna');
  expect(got.override).toEqual({ provider: 'llama-server', model: 'gemma-4-31b' });
  expect(routing.formatRouteView('Fenna', got)).toMatch(/gemma-4-31b \[override\]/);

  const cleared = await routing.clearNeumaRoute(base, TOKEN, 'fenna');
  expect(cleared.effective.source).toBe('machine-default');
});

test('a third-party route is refused with the boundary words, surfaced to the CLI (the sovereignty boundary)', async () => {
  await routing.setProviderKey(base, TOKEN, 'openai', { apiKey: 'sk-live' });
  const err = await routing.setNeumaRoute(base, TOKEN, 'fenna', { provider: 'openai', model: 'gpt-4o' })
    .catch((e) => e);
  expect(err).toBeInstanceOf(Error);
  expect(err.status).toBe(400);
  expect(err.message).toMatch(/not sovereign/);
  // Nothing stored — the being still rides the machine default.
  const got = await routing.getNeumaRoute(base, TOKEN, 'fenna');
  expect(got.override).toBeNull();
  expect(got.effective).toMatchObject({ provider: 'lm-studio', source: 'machine-default' });
});

test('listModels falls back to curated ids for anthropic', async () => {
  const { models } = await routing.listModels(base, TOKEN, 'anthropic');
  expect(models.map((m) => m.id)).toContain('claude-haiku-4-5-20251001');
});
