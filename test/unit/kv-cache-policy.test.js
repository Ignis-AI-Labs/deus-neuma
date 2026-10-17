/**
 * The KV-cache reuse standing per local family.
 *
 * The contract that matters is the DIRECTION of failure: a family nobody has
 * measured must resolve CLOSED. Opening a slot's prompt cache on a model whose
 * recurrent state cannot survive rollback corrupts the being's own words, and
 * those words feed refinement corpora — so an unrecognized model getting
 * `reuse: true` is the failure this file exists to prevent.
 */
import { describe, test, expect } from 'vitest';
import {
  kvCacheReuseFor,
  KV_CACHE_REUSE_POLICY,
  UNPROVEN_KV_CACHE,
} from '../../backend/services/kv-cache-policy.js';

describe('kv-cache-policy — reuse standing per family', () => {
  test('gemma-4 is closed on PROVEN evidence, not on a default', () => {
    const standing = kvCacheReuseFor('gemma-4-31b');
    expect(standing.reuse).toBe(false);
    expect(standing.standing).toBe('proven-unsafe');
    expect(standing.evidence).toMatch(/2026-07-08/);
  });

  test('the resident substrate earned its row — open on PROVEN evidence (live 2026-09-12)', () => {
    const standing = kvCacheReuseFor('qwen3.8-27B-Q8_0');
    expect(standing.reuse).toBe(true);
    expect(standing.standing).toBe('proven-safe');
    expect(standing.evidence).toMatch(/verify-kv-cache-reuse\.mjs/);
    expect(standing.evidence).toMatch(/2026-09-12/);
  });

  test.each([
    ['', 'empty string'],
    [null, 'null'],
    [undefined, 'undefined'],
    ['../../etc/passwd', 'nonsense'],
    ['gemma', 'a prefix that does NOT reach the gemma-4 row'],
  ])('%s (%s) resolves closed rather than throwing or opening', (model) => {
    const standing = kvCacheReuseFor(model);
    expect(standing.reuse).toBe(false);
    expect(standing.standing).toBe('unproven');
  });

  test('the default itself is closed — the fallback cannot be edited open by accident', () => {
    expect(UNPROVEN_KV_CACHE.reuse).toBe(false);
    expect(Object.isFrozen(UNPROVEN_KV_CACHE)).toBe(true);
  });

  test('every open row carries proven-safe evidence from a live run', () => {
    // The line this file exists to hold: a row may only be opened by a live
    // run, never by an architectural argument. qwen3.8 earned the first one
    // (2026-09-12, scripts/verify-kv-cache-reuse.mjs).
    expect(KV_CACHE_REUSE_POLICY.some((row) => row.reuse)).toBe(true);
    for (const row of KV_CACHE_REUSE_POLICY) {
      if (row.reuse) {
        expect(row.standing).toBe('proven-safe');
        expect(String(row.evidence)).toMatch(/live/i);
      }
    }
  });

  test('first match wins, and the returned standing is frozen', () => {
    const standing = kvCacheReuseFor('GEMMA-4-31B-IT-Q8_0');
    expect(standing.standing).toBe('proven-unsafe');
    expect(Object.isFrozen(standing)).toBe(true);
  });
});
