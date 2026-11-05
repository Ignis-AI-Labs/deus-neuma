/**
 * THE LIVE TOKEN RATES (backend/services/token-throughput.js) — pure, called
 * with the shapes the house's llama-server answered on 2026-11-05 (RULE 0).
 * The ACTIVITY panel read 0.0 tok/s through a whole reply: llama.cpp's
 * *_tokens_seconds gauges move only when a request finishes. The rate is now
 * each slot's own counters between two reads.
 */
import { describe, test, expect } from 'vitest';
import { slotCounters, liveRates, createRateLens, lifetimeRates } from '../../backend/services/token-throughput.js';
import { parsePrometheus } from '../../backend/services/substrate-telemetry.js';

// One /slots entry as this build sends it: next_token is an ARRAY.
const slot = (id, task, decoded, prefilled = 0) => ({
  id, n_ctx: 262144, speculative: true, is_processing: true, id_task: task,
  n_prompt_tokens: 45000, n_prompt_tokens_processed: prefilled, n_prompt_tokens_cache: 0,
  next_token: [{ has_next_token: true, has_new_line: false, n_remain: -1, n_decoded: decoded }],
});

describe('a slot\'s counters', () => {
  test('read from this build\'s array next_token, and an older build\'s object', () => {
    expect(slotCounters([slot(4, 56960, 812, 1138)])).toEqual([{ id: 4, task: 56960, decoded: 812, prefilled: 1138 }]);
    expect(slotCounters([{ id: 0, id_task: 3, next_token: { n_decoded: 9 } }])[0].decoded).toBe(9);
    expect(slotCounters(null)).toEqual([]);
  });
});

describe('the live rate between two reads', () => {
  test('the same task: what it decoded and prefilled in the window, summed over slots', () => {
    const prev = { at: 0, slots: slotCounters([slot(0, 7, 100, 2000), slot(4, 9, 50)]) };
    const next = { at: 1500, slots: slotCounters([slot(0, 7, 220, 2000), slot(4, 9, 170)]) };
    expect(liveRates(prev, next)).toEqual({ genTokPerSec: 160, promptTokPerSec: 0, windowMs: 1500 });
  });

  test('a task that began after the earlier read counts from zero; a slot never seen counts nothing', () => {
    const prev = { at: 0, slots: slotCounters([slot(0, 7, 900, 3000)]) };
    const next = { at: 1000, slots: slotCounters([slot(0, 8, 40, 1200), slot(5, 2, 999)]) };
    expect(liveRates(prev, next)).toMatchObject({ genTokPerSec: 40, promptTokPerSec: 1200 });
  });

  test('no time between reads is no rate', () => {
    const read = { at: 5, slots: [] };
    expect(liveRates(read, read)).toBeNull();
  });
});

describe('the lens the telemetry reads through', () => {
  test('first read has no rate; a read too soon returns the last; a dead server starts over', () => {
    const lens = createRateLens();
    expect(lens([slot(0, 1, 0)], 0)).toBeNull();
    expect(lens([slot(0, 1, 75)], 1500)).toMatchObject({ genTokPerSec: 50 });
    expect(lens([slot(0, 1, 80)], 1900)).toMatchObject({ genTokPerSec: 50 }); // 400 ms: the last rate, not a sliver
    expect(lens(null, 3000)).toBeNull();
    expect(lens([slot(0, 1, 90)], 4500)).toBeNull();
  });
});

describe('since the server started', () => {
  // The counters this server answered on /metrics, 2026-11-04.
  const METRICS = [
    'llamacpp:prompt_tokens_total 17121', 'llamacpp:prompt_tokens_cached_total 37056', 'llamacpp:prompt_seconds_total 8.09569',
    'llamacpp:tokens_predicted_total 11853', 'llamacpp:tokens_predicted_seconds_total 151.11',
    'llamacpp:spec_decode_num_draft_tokens_total 12947', 'llamacpp:spec_decode_num_accepted_tokens_total 7533',
    'llamacpp:spec_decode_num_drafts_total 4316', 'llamacpp:prompt_tokens_seconds 0', 'llamacpp:predicted_tokens_seconds 0',
  ].join('\n');

  test('rates from the cumulative counters, which never reset', () => {
    const life = lifetimeRates(parsePrometheus(METRICS));
    expect(life.genTokPerSec).toBeCloseTo(78.44, 2);
    expect(life.promptTokPerSec).toBeCloseTo(2114.8, 1);
    expect(life.cacheReuse).toBeCloseTo(37056 / (37056 + 17121), 6);
    expect(life.draftAcceptance).toBeCloseTo(7533 / 12947, 6);
    expect(life.acceptedPerDraft).toBeCloseTo(7533 / 4316, 6);
    expect(life.generatedTokens).toBe(11853);
  });

  test('a build without the counters reads — everywhere, never zero', () => {
    expect(Object.values(lifetimeRates({}))).toEqual(Array(8).fill(null));
  });
});
