/**
 * Serving policy through the REAL resolver (integration). Real temp workspace
 * with real encrypted DNA (writeDNA), real override store + credentials store
 * on real disk, real provider catalog — the exact composition a portal turn
 * runs (resolveNeumaRoute), no mocks.
 *
 * Under the fluid-routing law (natal = birth history only) the 2026-07-08
 * incident class (#155) mostly dissolves: with no override, a being rides the
 * machine's own serving config verbatim — a stale natal lm-studio route can
 * never drag the wire to a dead :1234. The serving law still binds OVERRIDE
 * routes: an lm-studio override on a llama-server machine is carried by
 * llama-server when it serves that exact model.
 */
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { PROVIDER_CATALOG } from '../../backend/services/provider-registry.js';

const ENV_KEYS = [...new Set(PROVIDER_CATALOG.map((e) => e.keyEnv).filter(Boolean))];

const dnaOn = (model) => ({
  version: '1.0.0',
  sovereignty: { generation: 1 },
  substrate: { llm: { provider: 'lm-studio', model } },
});

let resolveNeumaRoute;
let setConfig;
let workspace;
let saved;

beforeEach(async () => {
  vi.resetModules();

  saved = {
    creds: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH,
    routes: process.env.NEUMA_ROUTES_PATH,
    substrate: process.env.SUBSTRATE_MODEL,
    claims: process.env.NEUMA_SUBSTRATE_CLAIM_DIR,
  };
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  const dir = await createTempDir(`serving-policy-${Math.random().toString(36).slice(2)}`);
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(dir, 'creds.json');
  process.env.NEUMA_ROUTES_PATH = path.join(dir, 'routes.json');
  process.env.SUBSTRATE_MODEL = 'gemma-4-31b';
  // The served-truth chain reads the spawn's persisted claim — isolate it or
  // the test machine's OWN live llama-server claim steers every resolution.
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(dir, 'claims');

  const wsRoot = await createTempDir(`serving-policy-ws-${Math.random().toString(36).slice(2)}`);
  const core = await import('../../core/index.js');
  core.setWorkspacesRoot(wsRoot);
  workspace = (await import('../../core/workspace/neuma-workspace.js')).default;

  ({ resolveNeumaRoute } = await import('../../backend/services/neuma-route-resolver.js'));
  ({ setConfig } = await import('../../backend/services/llm-provider.js'));
});

afterEach(() => {
  const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('NEUMA_PROVIDER_CREDENTIALS_PATH', saved.creds);
  restore('NEUMA_ROUTES_PATH', saved.routes);
  restore('SUBSTRATE_MODEL', saved.substrate);
  restore('NEUMA_SUBSTRATE_CLAIM_DIR', saved.claims);
  for (const k of ENV_KEYS) restore(k, saved[k]);
  vi.restoreAllMocks();
});

describe('resolveNeumaRoute under the serving law', () => {
  test('the incident path cannot recur: a stale natal lm-studio route never steers the wire — the machine serving wins', async () => {
    setConfig({ provider: 'llama-server', model: 'gemma-4-31b', endpoint: 'http://localhost:8089' });
    await workspace.create('rehearsal-gemma');
    await workspace.writeDNA('rehearsal-gemma', dnaOn('gemma-4-31b'));
    const dna = await workspace.readDNA('rehearsal-gemma');

    const route = await resolveNeumaRoute('rehearsal-gemma', dna);
    expect(route.provider).toBe('llama-server');
    expect(route.endpoint).toBe('http://localhost:8089');
    expect(route.endpoint).not.toContain('1234');
    expect(route.model).toBe('gemma-4-31b');
    expect(route.source).toBe('machine-default');
    expect(route.chatPath).toBe('/v1/chat/completions');
  });

  test('Cael-class: a natal on a model the machine does not serve rides the machine serving anyway (natal = history)', async () => {
    setConfig({ provider: 'llama-server', model: 'gemma-4-31b', endpoint: 'http://localhost:8089' });
    await workspace.create('rehearsal-qwen');
    await workspace.writeDNA('rehearsal-qwen', dnaOn('qwen3.5-122b-a10b'));
    const dna = await workspace.readDNA('rehearsal-qwen');

    const route = await resolveNeumaRoute('rehearsal-qwen', dna);
    expect(route.provider).toBe('llama-server');
    expect(route.endpoint).toBe('http://localhost:8089');
    expect(route.source).toBe('machine-default');
    expect(route.translated).toBeUndefined();
  });

  test('the serving law still binds OVERRIDES: an lm-studio override on a llama-server machine is carried by llama-server', async () => {
    setConfig({ provider: 'llama-server', model: 'local-model', endpoint: 'http://localhost:8089' });
    const { setRoute } = await import('../../backend/services/neuma-routes-store.js');
    await workspace.create('rehearsal-override');
    await workspace.writeDNA('rehearsal-override', dnaOn('gemma-4-31b'));
    await setRoute('rehearsal-override', { provider: 'lm-studio', model: 'gemma-4-31b' });
    const dna = await workspace.readDNA('rehearsal-override');

    const route = await resolveNeumaRoute('rehearsal-override', dna);
    expect(route.provider).toBe('llama-server');
    expect(route.endpoint).toBe('http://localhost:8089');
    expect(route.model).toBe('gemma-4-31b');
    expect(route.translated).toEqual({ from: 'lm-studio', law: 'lm-studio-never-serves' });
  });

  test('an operator who globally serves via lm-studio keeps the lm-studio wire — the law binds llama-server machines only', async () => {
    setConfig({ provider: 'lm-studio', model: 'local-model', endpoint: 'http://localhost:1234' });
    await workspace.create('rehearsal-lms');
    await workspace.writeDNA('rehearsal-lms', dnaOn('gemma-4-31b'));
    const dna = await workspace.readDNA('rehearsal-lms');

    const route = await resolveNeumaRoute('rehearsal-lms', dna);
    expect(route.provider).toBe('lm-studio');
    expect(route.endpoint).toBe('http://localhost:1234');
    expect(route.translated).toBeUndefined();
  });
});
