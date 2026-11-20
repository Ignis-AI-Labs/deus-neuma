import { describe, test, expect } from 'vitest';
import {
  parsePrometheus, summarizeActivity, parseSampling, summarizeSlots,
  parseGpu, parseComputeApps, shortProcessName, withKvFromSlots,
} from '../../backend/services/substrate-telemetry.js';

// The live aggregation (getSubstrateTelemetry) is proven by integration against
// the real server + GPU (RULE 0); these cover the pure text→data parsers.

describe('parsePrometheus', () => {
  test('parses metric lines, strips labels, ignores comments/blanks', () => {
    const m = parsePrometheus('# HELP x\nllamacpp:tokens_predicted_total 959\nllamacpp:kv_cache_usage_ratio{slot="0"} 0.25\n\n');
    expect(m['llamacpp:tokens_predicted_total']).toBe(959);
    expect(m['llamacpp:kv_cache_usage_ratio']).toBe(0.25);
  });
  test('empty/absent text → empty map', () => {
    expect(Object.keys(parsePrometheus('')).length).toBe(0);
    expect(Object.keys(parsePrometheus(null)).length).toBe(0);
  });
});

describe('summarizeActivity', () => {
  test('maps known metrics; absent ones stay null (never faked zeros)', () => {
    const a = summarizeActivity({ 'llamacpp:requests_processing': 1 }, { genTokPerSec: 31.6, promptTokPerSec: 900 });
    expect(a.genTokPerSec).toBe(31.6);
    expect(a.promptTokPerSec).toBe(900);
    expect(a.requestsProcessing).toBe(1);
    expect(a.kvUsage).toBeNull();
  });

  test('the server\'s *_tokens_seconds gauges are never the rate — they read 0 through a whole reply', () => {
    const a = summarizeActivity({ 'llamacpp:predicted_tokens_seconds': 0, 'llamacpp:prompt_tokens_seconds': 0 });
    expect(a.genTokPerSec).toBeNull();
    expect(a.promptTokPerSec).toBeNull();
  });
});

describe('withKvFromSlots — KV pressure when /metrics has no kv gauges', () => {
  // The rig's real /metrics exposition (curl 2026-07-10) — NO kv_cache_* keys.
  const LIVE_KEYS = [
    'llamacpp:n_busy_slots_per_decode', 'llamacpp:n_decode_total',
    'llamacpp:n_tokens_max', 'llamacpp:predicted_tokens_seconds',
    'llamacpp:prompt_seconds_total', 'llamacpp:prompt_tokens_seconds',
    'llamacpp:prompt_tokens_total', 'llamacpp:requests_deferred',
    'llamacpp:requests_processing', 'llamacpp:tokens_predicted_seconds_total',
    'llamacpp:tokens_predicted_total',
  ];

  test('derives kvUsage/kvTokens from slot fill on a build without the gauges', () => {
    const activity = summarizeActivity(
      parsePrometheus(LIVE_KEYS.map((k) => `${k} 1`).join('\n')));
    expect(activity.kvUsage).toBeNull(); // the dead-meter condition, from real keys
    const slots = summarizeSlots([
      { id: 0, n_ctx: 16384, n_prompt_tokens: 4096, is_processing: false },
      { id: 1, n_ctx: 16384, n_prompt_tokens: 12288, is_processing: true },
    ]);
    const filled = withKvFromSlots(activity, slots);
    expect(filled.kvTokens).toBe(16384);
    expect(filled.kvUsage).toBeCloseTo(0.5);
  });

  test('a build that DOES expose the gauges wins over the derivation', () => {
    const activity = summarizeActivity({ 'llamacpp:kv_cache_usage_ratio': 0.25 });
    const slots = summarizeSlots([{ id: 0, n_ctx: 100, n_prompt_tokens: 90, is_processing: false }]);
    expect(withKvFromSlots(activity, slots)).toBe(activity);
  });

  test('no slots (server down) → activity untouched, never fake zeros', () => {
    const activity = summarizeActivity({});
    expect(withKvFromSlots(activity, summarizeSlots(null))).toBe(activity);
  });
});

describe('parseSampling', () => {
  test('pulls sampling knobs from props default_generation_settings', () => {
    const s = parseSampling({ default_generation_settings: { params: { temperature: 0.75, top_p: 0.9, top_k: 64, min_p: 0.05, repeat_penalty: 1.15, n_predict: -1 } } });
    expect(s).toEqual({ temperature: 0.75, topP: 0.9, topK: 64, minP: 0.05, repeatPenalty: 1.15, maxTokens: -1 });
  });
  test('missing params → null', () => {
    expect(parseSampling({})).toBeNull();
    expect(parseSampling(null)).toBeNull();
  });
});

describe('summarizeSlots', () => {
  test('counts total/busy and projects each slot', () => {
    const s = summarizeSlots([
      { id: 0, n_ctx: 65536, n_prompt_tokens: 0, is_processing: false },
      { id: 1, n_ctx: 65536, n_prompt_tokens: 128, is_processing: true },
    ]);
    expect(s.total).toBe(2);
    expect(s.busy).toBe(1);
    expect(s.slots[1]).toEqual({ id: 1, ctx: 65536, used: 128, processing: true });
  });
  test('non-array → empty', () => {
    expect(summarizeSlots(null)).toEqual({ total: 0, busy: 0, slots: [] });
  });
});

describe('parseGpu', () => {
  test('csv row → used/total/free/util/temp/power (discrete card: unified false)', () => {
    const g = parseGpu('87550, 97887, 96, 62, 434.84');
    expect(g).toEqual({ usedMB: 87550, totalMB: 97887, freeMB: 10337, utilPct: 96, tempC: 62, powerW: 434.84, unified: false });
  });
  test('absent input → null; a garbage row keeps its shape with every field null', () => {
    expect(parseGpu(null)).toBeNull();
    // Per-field salvage (b145c9f59): a field the driver cannot state is
    // null — never NaN, and never reason to kill the whole row. A fully
    // unparseable row is therefore an all-null reading, not a dead one.
    expect(parseGpu('x, y, z, a, b')).toEqual({
      usedMB: null, totalMB: null, freeMB: null, utilPct: null, tempC: null, powerW: null, unified: false,
    });
  });
  test("unified-memory silicon: [N/A] VRAM trio never discards the real util/temp/power (the GB10 law)", () => {
    expect(parseGpu('[N/A], [N/A], 96, 62, 434.84')).toEqual({
      usedMB: null, totalMB: null, freeMB: null, utilPct: 96, tempC: 62, powerW: 434.84, unified: false,
    });
  });
});

describe('parseComputeApps / shortProcessName', () => {
  test('shortens a full command path to the binary basename', () => {
    expect(shortProcessName('/opt/llama.cpp/build-cuda/bin/llama-server --port 8089')).toBe('llama-server');
    expect(shortProcessName('missioncenter')).toBe('missioncenter');
    expect(shortProcessName('')).toBe('unknown');
  });
  test('csv rows → pid/name/memMB with short names, bad rows dropped', () => {
    const apps = parseComputeApps('471924, /path/to/llama-server, 512\nbad-row-no-numbers');
    expect(apps).toEqual([{ pid: 471924, name: 'llama-server', memMB: 512 }]);
  });
});
