/**
 * Serving policy (pure). The law from docs/operations/substrate/serving.md — LM Studio
 * never serves when llama-server is the machine's substrate — proven with real
 * resolved-route shapes: the exact translation that ended the 2026-07-08
 * host-RAM incident (#155), and every guard that keeps translation from ever
 * changing WHAT model a being runs on.
 */
import { describe, test, expect } from 'vitest';
import { applyServingPolicy } from '../../backend/services/serving-policy.js';

const natalGemma = Object.freeze({
  provider: 'lm-studio',
  model: 'gemma-4-31b',
  endpoint: 'http://localhost:1234',
  kind: 'local',
  source: 'natal',
  fellBack: false,
  reason: null,
});

const LAW = { machineProvider: 'llama-server', servedModelKey: 'gemma-4-31b' };

describe('applyServingPolicy — translation (the incident case)', () => {
  test('a natal lm-studio route on the served model is carried by llama-server', () => {
    const out = applyServingPolicy(natalGemma, LAW);
    expect(out.provider).toBe('llama-server');
    expect(out.translated).toEqual({ from: 'lm-studio', law: 'lm-studio-never-serves' });
    // identity is untouched: same model, same resolution provenance
    expect(out.model).toBe('gemma-4-31b');
    expect(out.source).toBe('natal');
    expect(out.kind).toBe('local');
  });

  test(':1234 does not survive translation — the endpoint is nulled for downstream credential resolution', () => {
    const out = applyServingPolicy(natalGemma, LAW);
    expect(out.endpoint).toBeNull();
  });

  test('pure: the input route is not mutated and the output is frozen', () => {
    const out = applyServingPolicy(natalGemma, LAW);
    expect(natalGemma.provider).toBe('lm-studio');
    expect(natalGemma.endpoint).toBe('http://localhost:1234');
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.translated)).toBe(true);
  });

  test('an operator OVERRIDE to lm-studio on the served model is translated the same way', () => {
    const out = applyServingPolicy({ ...natalGemma, source: 'override' }, LAW);
    expect(out.provider).toBe('llama-server');
    expect(out.source).toBe('override');
  });
});

describe('applyServingPolicy — pass-through guards (same reference, no copy)', () => {
  test('a different natal model is never translated — a being cannot be served weights it did not choose', () => {
    const cael = Object.freeze({ ...natalGemma, model: 'qwen3.5-122b-a10b' });
    expect(applyServingPolicy(cael, LAW)).toBe(cael);
  });

  test('a machine whose operator globally serves via lm-studio keeps its routes verbatim', () => {
    expect(applyServingPolicy(natalGemma, { machineProvider: 'lm-studio', servedModelKey: 'gemma-4-31b' })).toBe(natalGemma);
  });

  test('no served model key configured — no translation target, no translation', () => {
    expect(applyServingPolicy(natalGemma, { machineProvider: 'llama-server', servedModelKey: null })).toBe(natalGemma);
    expect(applyServingPolicy(natalGemma, { machineProvider: 'llama-server', servedModelKey: '' })).toBe(natalGemma);
  });

  test('non-lm-studio providers are outside the law', () => {
    const custom = Object.freeze({ ...natalGemma, provider: 'custom' });
    const cloud = Object.freeze({ ...natalGemma, provider: 'anthropic', kind: 'cloud' });
    expect(applyServingPolicy(custom, LAW)).toBe(custom);
    expect(applyServingPolicy(cloud, LAW)).toBe(cloud);
  });

  test('null route and absent policy input pass through untouched', () => {
    expect(applyServingPolicy(null, LAW)).toBeNull();
    expect(applyServingPolicy(natalGemma)).toBe(natalGemma);
    expect(applyServingPolicy(natalGemma, {})).toBe(natalGemma);
  });
});

describe('translation target invariant', () => {
  // The policy nulls the endpoint and relies on downstream credential
  // resolution to supply llama-server's. That is only sound because the
  // catalog constant is the resolution FLOOR: resolveEndpoint rejects empty
  // store strings and falls back to the catalog entry. Pin it so a catalog or
  // precedence change cannot silently strand a translated route on null.
  test('llama-server always resolves a non-empty endpoint — catalog floor holds', async () => {
    const { getProvider } = await import('../../backend/services/provider-registry.js');
    const { resolveEndpoint } = await import('../../backend/services/provider-credentials.js');
    const entry = getProvider('llama-server');
    expect(entry.endpoint).toBe('http://localhost:8089');
    expect(resolveEndpoint(undefined, entry)).toBe('http://localhost:8089');
    expect(resolveEndpoint({}, entry)).toBe('http://localhost:8089');
    expect(resolveEndpoint({ endpoint: '' }, entry)).toBe('http://localhost:8089');
    expect(resolveEndpoint({ endpoint: 'http://127.0.0.1:9099' }, entry)).toBe('http://127.0.0.1:9099');
  });
});
