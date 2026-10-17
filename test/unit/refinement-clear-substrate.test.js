/**
 * The forge's substrate-clear decision — pure. A unified-memory box cannot
 * hold a 61GB conduit and a 61GB trainer at once (the GB10's first forge
 * died silently in model load, 2026-07-20); training clears only a substrate
 * NEUMA owns and that is not mid-generation.
 */
import { describe, test, expect } from 'vitest';
import { shouldClearSubstrateForTraining } from '../../backend/services/refinement-training.js';

describe('shouldClearSubstrateForTraining', () => {
  const base = { provider: 'llama-server', serving: true, owned: true, busy: false };

  test('clears an owned, quiet, serving llama-server', () => {
    expect(shouldClearSubstrateForTraining(base)).toBe(true);
  });

  test('never yanks a mid-generation turn', () => {
    expect(shouldClearSubstrateForTraining({ ...base, busy: true })).toBe(false);
  });

  test('never kills a server NEUMA does not own', () => {
    expect(shouldClearSubstrateForTraining({ ...base, owned: false })).toBe(false);
  });

  test('a down substrate needs no clearing; other providers are untouched', () => {
    expect(shouldClearSubstrateForTraining({ ...base, serving: false })).toBe(false);
    expect(shouldClearSubstrateForTraining({ ...base, provider: 'lm-studio' })).toBe(false);
  });
});
