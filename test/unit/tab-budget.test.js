/**
 * TAB BUDGET (session tabs, slice 1) — how many parallel sittings a machine may
 * hold, and why not more.
 *
 * Pure functions, real inputs. The measured cases run against the ACTUAL
 * capacity-scan records on this machine's disk rather than hand-written
 * fixtures: the whole point of this module is that the local ceiling is
 * measured and not invented, so a test that invents its own scan would be
 * proving the invention.
 *
 * The two budgets exist because a local tab and a witness tab cost completely
 * different things — a GPU slot versus a socket. Counting them together would
 * either strangle a witness-only operator on capable hardware, or let a small
 * rig open eight local sittings and fall over.
 */
import { describe, expect, test, beforeAll } from 'vitest';
import {
  localBudget, substrateFamily, sameSubstrate, scanForModel, LOCAL_BASIS, LOCAL_UNMEASURED_FLOOR,
} from '../../core/runtime/tab-budget.js';

// The real scan on this machine, if one has ever run. Absent on a fresh
// checkout — the tests that need it say so rather than inventing one.
let real = null;
beforeAll(async () => {
  const { readLatestCapacity } = await import('../../backend/services/capacity-store.js');
  real = await readLatestCapacity().catch(() => null);
});

describe('localBudget — measured, never guessed', () => {
  test('THE REAL SCAN on this machine yields its own measured ceiling', () => {
    if (!real || real.incomplete) {
      expect(real === null || real.incomplete === true).toBe(true); // nothing to measure against
      return;
    }
    const b = localBudget(real, real.substrate?.model ?? null);
    expect(b.basis).toBe(LOCAL_BASIS.measured);
    expect(b.limit).toBe(Math.floor(real.ceiling));
    // The refusal must be able to teach: the number, and what bounded it.
    expect(b.reason).toContain(String(b.limit));
    if (real.limitedBy) expect(b.reason).toContain(real.limitedBy);
    if (real.substrate?.model) expect(b.reason).toContain(real.substrate.model);
  });

  test('NEVER SCANNED does not guess a ceiling — it holds the floor and says why', () => {
    const b = localBudget(null);
    expect(b.limit).toBe(LOCAL_UNMEASURED_FLOOR);
    expect(b.basis).toBe(LOCAL_BASIS.unmeasured);
    expect(b.reason).toMatch(/never been measured/i);
    expect(b.reason).toMatch(/capacity scan/i);
  });

  test('a scan with no usable ceiling reads as unmeasured, not as zero', () => {
    for (const junk of [{}, { ceiling: null }, { ceiling: 'eight' }, { ceiling: NaN }, { ceiling: Infinity }]) {
      const b = localBudget(junk);
      expect(b.basis).toBe(LOCAL_BASIS.unmeasured);
      expect(b.limit).toBe(LOCAL_UNMEASURED_FLOOR);
    }
  });

  test('INCOMPLETE is not a ceiling — a scan that stopped early is least trustworthy', () => {
    const b = localBudget({ ceiling: 12, incomplete: true, limitedBy: 'vram', substrate: { model: 'm' } });
    expect(b.limit).toBe(LOCAL_UNMEASURED_FLOOR);
    expect(b.basis).toBe(LOCAL_BASIS.incomplete);
    expect(b.reason).toMatch(/did not finish/i);
  });

  test('a STALE ceiling is not carried onto a different model', () => {
    const scan = { ceiling: 8, limitedBy: 'latency', incomplete: false, substrate: { model: 'gemma-4-31b' } };
    const b = localBudget(scan, 'qwen-3-72b');
    expect(b.basis).toBe(LOCAL_BASIS.stale);
    expect(b.limit).toBeLessThanOrEqual(LOCAL_UNMEASURED_FLOOR);
    expect(b.reason).toContain('gemma-4-31b'); // what it was measured on
    expect(b.reason).toContain('qwen-3-72b');  // what is actually serving
  });

  test('the SAME model is not stale — the measurement still stands', () => {
    const scan = { ceiling: 8, limitedBy: 'latency', incomplete: false, substrate: { model: 'gemma-4-31b' } };
    expect(localBudget(scan, 'gemma-4-31b').basis).toBe(LOCAL_BASIS.measured);
    // And an unknown active substrate does not invalidate a good scan.
    expect(localBudget(scan, null).basis).toBe(LOCAL_BASIS.measured);
  });

  test('a ceiling of 0 is honoured — a machine that measured none gets none', () => {
    const b = localBudget({ ceiling: 0, incomplete: false, substrate: { model: 'm' } });
    expect(b.limit).toBe(0);
    expect(b.basis).toBe(LOCAL_BASIS.measured);
  });
});

describe('SAME MODEL, DIFFERENT NAME — the staleness guard on real strings', () => {
  // Every one of these was recorded by THIS repo's own capacity scanner on one
  // machine serving one model, across the months the serving engine changed
  // what it advertises. Read off the live rig on 2026-07-30.
  const SEEN = ['gemma-4-31b', 'google/gemma-4-31b-qat', 'gemma-4-31B-it-Q8_0.gguf'];

  test('the recorded history of ONE model all reduces to one family', () => {
    expect(SEEN.map(substrateFamily)).toEqual(['gemma-4-31b', 'gemma-4-31b', 'gemma-4-31b']);
  });

  test('every pair of those names reads as the SAME substrate', () => {
    SEEN.forEach((a) => SEEN.forEach((b) => {
      expect(sameSubstrate(a, b), `${a} vs ${b}`).toBe(true);
    }));
  });

  test('A GENUINELY DIFFERENT MODEL still reads as different — the guard survives', () => {
    // Also from this rig's real history: it has been scanned on both.
    expect(sameSubstrate('qwen3.5-122b-a10b', 'gemma-4-31b')).toBe(false);
    expect(sameSubstrate('gemma-4-12b', 'gemma-4-31b')).toBe(false);
  });

  test('an UNNAMED side is not evidence of a change', () => {
    expect(sameSubstrate(null, 'gemma-4-31b')).toBe(true);
    expect(sameSubstrate('gemma-4-31b', '')).toBe(true);
    expect(substrateFamily(undefined)).toBe('');
  });

  test('a name that is ONLY packaging keeps itself rather than vanishing', () => {
    expect(substrateFamily('q8_0')).toBe('q8_0');
  });

  test('THE MEASURED CEILING SURVIVES the rename — 8 stays 8', () => {
    // The regression this exists for: an exact match clamped a rig measured at
    // 8 down to 1 and told the operator to re-scan a scan they had just run.
    const scan = { ceiling: 8, limitedBy: 'latency', incomplete: false, substrate: { model: 'gemma-4-31b' } };
    const b = localBudget(scan, 'gemma-4-31B-it-Q8_0.gguf');
    expect(b.limit).toBe(8);
    expect(b.basis).toBe(LOCAL_BASIS.measured);
  });

  test('...and a real model swap still clamps', () => {
    const scan = { ceiling: 8, limitedBy: 'latency', incomplete: false, substrate: { model: 'gemma-4-31b' } };
    const b = localBudget(scan, 'qwen3.5-122b-a10b');
    expect(b.basis).toBe(LOCAL_BASIS.stale);
    expect(b.limit).toBe(LOCAL_UNMEASURED_FLOOR);
  });
});

// Design note, 2026-11-10: […] Every reader took
// only the NEWEST scan, so A → B → back to A asked for a scan each time.
describe('scanForModel — a model switch never throws a measurement away', () => {
  const run = (id, model, ceiling, extra = {}) => ({ id, ceiling, incomplete: false, substrate: { model }, ...extra });
  // newest first, as listCapacity answers; the models are this rig's own (2026-11-02..10)
  const HAUHAU = '/models/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf';
  const runs = [run('c', 'qwen3.8-27b-neuma-t4-q6k', 4), run('b', 'qwen3.8-27b-neuma-t3', 4), run('a', HAUHAU, 8)];

  test('switching BACK to a scanned model reads its own scan, not the newest', () => {
    expect(scanForModel(runs, HAUHAU)).toEqual({ run: runs[2], carriedFrom: null });
    expect(scanForModel(runs, 'qwen3.8-27b-neuma-t3')).toEqual({ run: runs[1], carriedFrom: null });
  });

  test('a model never scanned CARRIES the newest finished scan, and names it', () => {
    expect(scanForModel(runs, 'qwen3.8-27b-neuma-t4-iq3_m')).toEqual({ run: runs[0], carriedFrom: 'qwen3.8-27b-neuma-t4-q6k' });
  });

  test('a scan that never finished is never carried', () => {
    const withPartial = [run('d', 'gemma-4-31b', 12, { incomplete: true }), ...runs];
    expect(scanForModel(withPartial, 'qwen3.5-122b-a10b')).toEqual({ run: runs[0], carriedFrom: 'qwen3.8-27b-neuma-t4-q6k' });
  });

  test('no model known, or nothing finished: the newest run, exactly as before', () => {
    expect(scanForModel(runs, null)).toEqual({ run: runs[0], carriedFrom: null });
    expect(scanForModel(runs, 'local-model')).toEqual({ run: runs[0], carriedFrom: null });
    const partial = [run('p', 'gemma-4-31b', 3, { incomplete: true })];
    expect(scanForModel(partial, 'qwen3.5-122b-a10b')).toEqual({ run: partial[0], carriedFrom: null });
    expect(scanForModel([], 'm')).toBeNull();
  });

  test('a CARRIED scan keeps its number, and the budget names both models', () => {
    const b = localBudget({ ...runs[0], limitedBy: 'latency', carriedFrom: runs[0].substrate.model }, 'qwen3.8-27b-neuma-t4-iq3_m');
    expect(b).toMatchObject({ limit: 4, basis: LOCAL_BASIS.carried });
    expect(b.reason).toContain('qwen3.8-27b-neuma-t4-q6k');
    expect(b.reason).toContain('qwen3.8-27b-neuma-t4-iq3_m');
  });

  test('THE REAL HISTORY on this machine: every scanned model reads its own scan', async () => {
    const { listCapacity } = await import('../../backend/services/capacity-store.js');
    const history = await listCapacity();
    for (const r of history.filter((x) => x.incomplete !== true && Number.isFinite(x.ceiling) && x.substrate?.model)) {
      const pick = scanForModel(history, r.substrate.model);
      expect(pick.carriedFrom).toBeNull();
      expect(sameSubstrate(pick.run.substrate?.model, r.substrate.model)).toBe(true);
    }
  });
});
