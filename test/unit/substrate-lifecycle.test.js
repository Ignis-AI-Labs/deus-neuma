import { describe, test, expect } from 'vitest';
import { preflightDecision, toIgnitionStatus } from '../../backend/services/substrate-lifecycle.js';

// The ignite/status/spawn path is proven by integration against a real smoke
// llama-server (RULE 0 — see the lifecycle proof); these cover pure decisions.

describe('preflightDecision', () => {
  test('only llama-server is auto-booted; other providers are skipped', () => {
    expect(preflightDecision({ provider: 'openai', serving: false, ready: true }).action).toBe('skip');
    expect(preflightDecision({ provider: 'lm-studio', serving: false, ready: true }).action).toBe('skip');
  });
  test('already serving → serving (no boot)', () => {
    expect(preflightDecision({ provider: 'llama-server', serving: true, ready: true }).action).toBe('serving');
  });
  test('down but prerequisites missing → not-ready (cannot boot)', () => {
    expect(preflightDecision({ provider: 'llama-server', serving: false, ready: false }).action).toBe('not-ready');
  });
  test('down and ready → boot', () => {
    expect(preflightDecision({ provider: 'llama-server', serving: false, ready: true }).action).toBe('boot');
  });
});

describe('toIgnitionStatus (maps supervisor state → the desk ignition contract)', () => {
  const base = { launch: { ready: true }, lastError: null, startedAt: '2026-07-08T00:00:00Z' };
  test('serving → targetLoaded true, not igniting, loaded lists the model', () => {
    const st = toIgnitionStatus({ ...base, serving: true, owned: true }, 'gemma-4-31b');
    expect(st.targetLoaded).toBe(true);
    expect(st.igniting).toBeNull();
    expect(st.loaded).toEqual([{ modelKey: 'gemma-4-31b', status: 'loaded' }]);
  });
  test('owned but not yet healthy → igniting set, targetLoaded false', () => {
    const st = toIgnitionStatus({ ...base, serving: false, owned: true }, 'gemma-4-31b');
    expect(st.targetLoaded).toBe(false);
    expect(st.igniting).toEqual({ startedAt: base.startedAt });
    expect(st.loaded).toEqual([]);
  });
  test('down and unowned → not igniting, not loaded', () => {
    const st = toIgnitionStatus({ ...base, serving: false, owned: false }, 'gemma-4-31b');
    expect(st.igniting).toBeNull();
    expect(st.targetLoaded).toBe(false);
  });
});
