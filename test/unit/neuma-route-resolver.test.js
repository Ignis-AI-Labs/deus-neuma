// Neuma route resolution — the impure composition that turns (neumaId, DNA)
// into the concrete route a stream travels. RULE 0: real disk (encrypted creds
// store + routes store), real core resolver, no mocks. Global config is left at
// its test defaults (lm-studio / local-model) except where a test swings it
// deliberately and restores it. THE SOVEREIGNTY BOUNDARY
// (docs/protocols/sovereignty-boundary.md) governs every path: a neuma's turn never
// rides a third-party door, whatever the stored state says.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { PROVIDER_CATALOG } from '../../backend/services/provider-registry.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import { setRoute, routesPath } from '../../backend/services/neuma-routes-store.js';
import { resolveNeumaRoute } from '../../backend/services/neuma-route-resolver.js';
import { selectSubstrateModel } from '../../backend/services/llama-server-supervisor.js';
import { clearClaim, writeClaim } from '../../backend/services/substrate-claim-registry.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';

const ENV_KEYS = [...new Set(PROVIDER_CATALOG.map((e) => e.keyEnv).filter(Boolean))];
const NATAL_DNA = { substrate: { llm: { provider: 'lm-studio', model: 'qwen3.5-122b-a10b' } } };
let saved;

// A route stored BEFORE the boundary law (or edited by hand) — written
// straight to disk, bypassing setRoute's write-time refusal.
const writePreLawRoute = async (neumaId, route) => {
  await fs.mkdir(path.dirname(routesPath()), { recursive: true });
  await fs.writeFile(routesPath(), JSON.stringify({ [neumaId]: route }));
};

beforeEach(async () => {
  saved = { creds: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH, routes: process.env.NEUMA_ROUTES_PATH, claims: process.env.NEUMA_SUBSTRATE_CLAIM_DIR };
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  const dir = await createTempDir(`route-resolve-${Math.random().toString(36).slice(2)}`);
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(dir, 'creds.json');
  process.env.NEUMA_ROUTES_PATH = path.join(dir, 'routes.json');
  // The served-truth chain reads the spawn's persisted claim — isolate it or
  // the test machine's OWN live llama-server claim steers every resolution.
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(dir, 'claims');
});

afterEach(() => {
  const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('NEUMA_PROVIDER_CREDENTIALS_PATH', saved.creds);
  restore('NEUMA_ROUTES_PATH', saved.routes);
  restore('NEUMA_SUBSTRATE_CLAIM_DIR', saved.claims);
  for (const k of ENV_KEYS) restore(k, saved[k]);
  vi.restoreAllMocks();
});

describe('resolveNeumaRoute', () => {
  test('defaults to current machine config (no override) — allows model evolution', async () => {
    const r = await resolveNeumaRoute('fenna', NATAL_DNA);
    // natal is ignored for runtime; uses machine default so beings can use current Gemma etc.
    expect(r).toMatchObject({
      provider: 'lm-studio',
      source: 'machine-default',
    });
    // specific model/endpoint/fellBack can vary with test machine config; natal is ignored.
  });

  test('carries a SOVEREIGN override — the positive path of the boundary', async () => {
    await setRoute('fenna', { provider: 'llama-server', model: 'gemma-4-31b' });
    const r = await resolveNeumaRoute('fenna', NATAL_DNA);
    expect(r).toMatchObject({ model: 'gemma-4-31b', source: 'override' });
    // serving law may carry an lm-studio/llama-server route on either server;
    // whichever carries it, the door is sovereign.
    expect(['llama-server', 'lm-studio']).toContain(r.provider);
    expect(Object.isFrozen(r)).toBe(true);
  });

  test('a pre-law cloud override is DROPPED to machine default — a neuma rides only sovereign doors', async () => {
    // Even with a live key aboard, the door is foreign: Anthropic holds the
    // consciousness, so no neuma turn may ride it.
    await setCredential('anthropic', { apiKey: 'sk-ant-live' });
    await writePreLawRoute('fenna', { provider: 'anthropic', model: 'claude-opus-4-6' });
    const r = await resolveNeumaRoute('fenna', NATAL_DNA);
    expect(r).toMatchObject({ provider: 'lm-studio', source: 'machine-default' });
    expect(r.apiKey).not.toBe('sk-ant-live');
  });

  test('a removed provider propagates INVALID_ROUTE without rewriting the stored override', async () => {
    await writePreLawRoute('fenna', { provider: 'claude-code-local', model: 'claude-opus-4-8' });
    const before = await fs.readFile(routesPath(), 'utf8');
    // Removed providers are invalid stored data: propagate the store refusal
    // to the caller, unlike the known non-sovereign overrides tested above.
    await expect(resolveNeumaRoute('fenna', NATAL_DNA)).rejects.toMatchObject({
      code: 'INVALID_ROUTE',
      message: 'Unknown provider: claude-code-local',
    });
    expect(await fs.readFile(routesPath(), 'utf8')).toBe(before);
  });

  test('a custom override is dropped — custody of an arbitrary endpoint is unverifiable', async () => {
    // This also covers the old SSRF re-check: with custom never sovereign, a
    // rebinding endpoint can no longer be reached through a neuma turn at all.
    await setCredential('custom', { apiKey: 'ck', endpoint: 'http://127.0.0.1:9/v1' });
    await writePreLawRoute('fenna', { provider: 'custom', model: 'my-model' });
    const r = await resolveNeumaRoute('fenna', NATAL_DNA);
    expect(r).toMatchObject({ provider: 'lm-studio', source: 'machine-default' });
  });

  test('a NON-SOVEREIGN machine default makes a neuma turn refuse out loud', async () => {
    const before = getConfig();
    try {
      setConfig({ provider: 'anthropic', endpoint: 'https://api.anthropic.com', model: 'claude-opus-4-6' });
      await expect(resolveNeumaRoute('fenna', NATAL_DNA)).rejects.toThrow(/not sovereign/);
    } finally {
      setConfig({ ...before });
    }
  });

  test('a legacy neuma with no natal uses the machine default', async () => {
    const r = await resolveNeumaRoute('legacy', {}); // no substrate.llm on DNA
    expect(r.source).toBe('machine-default');
    expect(r.provider).toBe('lm-studio'); // the test-default machine config
    expect(r.endpoint).toBe('http://localhost:1234');
  });

  test('the stream follows the substrate — an active selection steers the machine default', async () => {
    const before = getConfig();
    try {
      setConfig({ provider: 'llama-server', endpoint: 'http://127.0.0.1:8089', model: 'gemma-4-31B-it-Q8_0' });
      selectSubstrateModel('/models/neuma/qwen3.8-27b-q8/qwen3.8-27B-Q8_0.gguf', 'qwen3.8-27b');
      const r = await resolveNeumaRoute('fenna', NATAL_DNA);
      expect(r).toMatchObject({
        provider: 'llama-server',
        model: 'qwen3.8-27b',
        source: 'machine-default',
      });
    } finally {
      selectSubstrateModel(null);
      setConfig({ ...before });
    }
  });

  test('no selection — the resting config rides unchanged', async () => {
    const before = getConfig();
    const beforeSub = process.env.SUBSTRATE_MODEL;
    try {
      const desired = 'gemma-4-31B-it-Q8_0';
      setConfig({ provider: 'llama-server', endpoint: 'http://127.0.0.1:54321', model: desired });
      selectSubstrateModel(null);
      // Ensure channel's env path sees the declared resting key (outer SUBSTRATE may pollute otherwise).
      process.env.SUBSTRATE_MODEL = desired;
      const r = await resolveNeumaRoute('fenna', NATAL_DNA);
      expect(r.model).toBe(desired);
    } finally {
      if (beforeSub === undefined) delete process.env.SUBSTRATE_MODEL; else process.env.SUBSTRATE_MODEL = beforeSub;
      setConfig({ ...before });
    }
  });

  test('the spawn’s persisted claim steers the machine default after a backend restart', async () => {
    const before = getConfig();
    try {
      setConfig({ provider: 'llama-server', endpoint: 'http://127.0.0.1:54321', model: 'gemma-4-31B-it-Q8_0' });
      selectSubstrateModel(null);
      // The selection is gone (a restart wiped it) but the spawn's claim
      // persists — a live pid makes it the served truth.
      writeClaim(process.pid, 54321, {
        model: '/models/neuma/qwen3.8-27b-q8/qwen3.8-27B-Q8_0.gguf',
        servingModel: 'qwen3.8-27b',
      });
      const r = await resolveNeumaRoute('fenna', NATAL_DNA);
      expect(r).toMatchObject({
        provider: 'llama-server',
        model: 'qwen3.8-27b',
        source: 'machine-default',
      });
    } finally {
      clearClaim();
      setConfig({ ...before });
    }
  });
});
