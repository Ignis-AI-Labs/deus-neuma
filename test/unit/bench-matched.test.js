// bench-matched.test.js — the matched set's pure argv law (RULE 0): every
// validation refusal and the exact per-arm argv — shared comparisonId,
// attempt 1, the loopback endpoint on floor arms, the one lane on identity
// arms. The chain mechanics against REAL spawned children live in
// test/integration/bench-matched.test.js (law split: pure here, spawn there).

import { describe, it, expect } from 'vitest';
import {
  buildChainArgv, mintComparisonId, IDENTITY_ARMS, COMPARISON_ID_RE,
} from '../../backend/services/bench/bench-matched.js';
import { armEstimateMs, matchedClockLine } from '../../frontend/app/RelinkShell/bench-launch-view.js';
import { estimateView } from '../../frontend/app/RelinkShell/bench-launch-layout-view.js';

const CELL = { id: 'gsm8k', arms: ['bare', 'platform', 'silo', 'neuma'] };
const MODELS = ['qwen3.8-27b'];
const CTX = {
  wallet: '0xabc123',
  cell: CELL,
  modelKeys: MODELS,
  servingEndpoint: 'http://127.0.0.1:8089',
  comparisonId: 'desk-test-1',
};

describe('buildChainArgv — the matched set law, pure', () => {
  it('one arm is a matched set of one; four arms is the cap', () => {
    const one = buildChainArgv({ cell: 'gsm8k', arms: ['bare'], model: 'qwen3.8-27b' }, CTX);
    expect(one.ok).toBe(true);
    expect(one.plans.length).toBe(1);
    const four = buildChainArgv({ cell: 'gsm8k', arms: ['bare', 'platform', 'silo', 'neuma'], model: 'qwen3.8-27b', lane: 'keir' }, CTX);
    expect(four.ok).toBe(true);
    expect(four.plans.map((p) => p.arm)).toEqual(['bare', 'platform', 'silo', 'neuma']);
  });

  it('every refusal reads plain', () => {
    const bad = (params, ctx = CTX) => {
      const built = buildChainArgv(params, ctx);
      expect(built.ok).toBe(false);
      return built.reason;
    };
    expect(bad({ cell: 'gsm8k', arms: [], model: 'qwen3.8-27b' })).toContain('one to five arms');
    expect(bad({ cell: 'gsm8k', arms: ['bare', 'platform', 'harness', 'silo', 'neuma', 'bare'], model: 'qwen3.8-27b' }, CTX)).toContain('one to five arms');
    expect(bad({ cell: 'gsm8k', arms: ['bare', 'bare'], model: 'qwen3.8-27b' })).toContain('an arm rides once');
    expect(bad({ cell: 'gsm8k', arms: ['cheat'], model: 'qwen3.8-27b' })).toContain('not one of gsm8k');
    expect(bad({ cell: 'nope', arms: ['bare'], model: 'qwen3.8-27b' })).toContain('unknown cell');
    expect(bad({ cell: 'gsm8k', arms: ['bare'], model: 'gpt-5' })).toContain('unregistered model');
    expect(bad({ cell: 'gsm8k', arms: ['bare', 'neuma'], model: 'qwen3.8-27b' })).toContain('--lane');
    expect(bad({ cell: 'gsm8k', arms: ['bare'], model: 'qwen3.8-27b', attempt: 2 })).toContain('attempt 1');
    expect(bad({ cell: 'gsm8k', arms: ['bare'], model: 'qwen3.8-27b' }, { ...CTX, comparisonId: 'Bad_ID' })).toContain('comparisonId');
    expect(bad({ cell: 'gsm8k', arms: ['bare'], model: 'qwen3.8-27b' }, { ...CTX, wallet: '' })).toContain('approving wallet');
    expect(bad({ cell: 'gsm8k', arms: ['bare'], model: 'qwen3.8-27b', limit: 0 })).toContain('limit');
    expect(bad({ cell: 'gsm8k', arms: ['bare'], model: 'qwen3.8-27b', deadline: '2020-01-01T00:00:00Z' })).toContain('past');
    expect(bad({ cell: 'gsm8k', arms: ['neuma'], model: 'qwen3.8-27b', lane: 'bad lane!' })).toContain('lane must match');
  });

  it('every arm shares the comparisonId, attempt 1; floor arms carry the endpoint, identity arms the lane', () => {
    const built = buildChainArgv({
      cell: 'gsm8k', arms: ['bare', 'neuma'], model: 'qwen3.8-27b', lane: 'keir', limit: 5,
    }, CTX);
    expect(built.ok).toBe(true);
    const [bare, neuma] = built.plans;
    expect(bare.argv).toEqual([
      'bench.mjs', 'run', 'gsm8k', '--model', 'qwen3.8-27b', '--arm', 'bare',
      '--endpoint', 'http://127.0.0.1:8089', '--approved-by', '0xabc123', '--lane', 'keir',
      '--comparison-id', 'desk-test-1', '--attempt', '1', '--limit', '5',
    ]);
    expect(neuma.argv).toEqual([
      'bench.mjs', 'run', 'gsm8k', '--model', 'qwen3.8-27b', '--arm', 'neuma',
      '--approved-by', '0xabc123', '--lane', 'keir',
      '--comparison-id', 'desk-test-1', '--attempt', '1', '--limit', '5',
    ]);
    // The endpoint never leaks onto the identity arm by default; explicit wins.
    const explicit = buildChainArgv({
      cell: 'gsm8k', arms: ['neuma'], model: 'qwen3.8-27b', lane: 'keir', endpoint: 'http://127.0.0.1:9000',
    }, CTX);
    expect(explicit.plans[0].argv).toContain('http://127.0.0.1:9000');
    // A remote endpoint is refused — the loopback doctrine holds on chains.
    expect(buildChainArgv({
      cell: 'gsm8k', arms: ['bare'], model: 'qwen3.8-27b', endpoint: 'https://evil.example.com',
    }, CTX).reason).toContain('loopback');
  });

  it('mintComparisonId is the desk-<iso> shape the regex accepts', () => {
    const id = mintComparisonId(new Date('2026-09-25T04:44:04.119Z'));
    expect(id).toBe('desk-2026-09-25t04-44-04');
    expect(COMPARISON_ID_RE.test(id)).toBe(true);
    expect(IDENTITY_ARMS).toEqual(['silo', 'neuma']);
  });
});

describe('the matched set\'s clock — estimate before the click, lens while it runs (pure)', () => {
  const CELL = { id: 'gsm8k', cost: { wallclockSec: 2700 } };
  const ROWS = [
    { suiteId: 'gsm8k', arm: 'bare', durationMs: 300000, startedAt: '2026-09-24T01:00:00Z' },
    { suiteId: 'gsm8k', arm: 'bare', durationMs: 600000, startedAt: '2026-09-25T02:00:00Z' }, // the LATEST wins
    { suiteId: 'other', arm: 'bare', durationMs: 9999999, startedAt: '2026-09-25T03:00:00Z' }, // not this cell
  ];

  it('history is the estimator: the latest measured row wins, catalog cost is the fallback', () => {
    expect(armEstimateMs('bare', CELL, ROWS)).toBe(600000);
    expect(armEstimateMs('silo', CELL, ROWS)).toBe(2700000);
    expect(armEstimateMs('bare', null, ROWS)).toBe(0);
  });

  it('the pre-run estimate: the total as one numeral, the finish time, each arm\u2019s share', () => {
    const now = new Date(2026, 8, 25, 21, 0).getTime(); // local 21:00
    const view = estimateView(['bare', 'silo'], CELL, ROWS, now);
    expect(view.total).toBe('~55 min');
    expect(view.finish).toBe('21:55');
    expect(view.parts.map((p) => p.text)).toEqual(['~10 min', '~45 min']);
    expect(estimateView([], CELL, ROWS, now)).toBeNull();
    expect(estimateView(['bare'], null, ROWS, now)).toBeNull();
  });

  it('the running lens: elapsed, on-arm, remaining (pace-scaled), finish-at', () => {
    const now = Date.parse('2026-09-25T10:06:40Z');
    const chain = {
      state: 'running', startedAt: '2026-09-25T10:00:00Z', armStartedAt: '2026-09-25T10:05:00Z',
      arms: ['bare', 'silo', 'neuma'], currentIndex: 1, currentArm: 'silo',
      outcomes: [{ arm: 'bare', ok: true, durationMs: 300000 }],
    };
    // done: bare measured 300000 vs estimated 600000 → pace 0.5; rest = silo+neuma = 2700000×2 ×0.5 = 2700000
    const line = matchedClockLine(chain, CELL, ROWS, now);
    expect(line).toContain('ELAPSED 6:40');
    expect(line).toContain('1:40 ON THIS ARM');
    expect(line).toContain('REMAINING ~45 MIN');
    expect(line).toContain('FINISH ~');
  });

  it('a settled chain reads its TOTAL; chains without timing read null', () => {
    const done = { state: 'done', startedAt: '2026-09-25T10:00:00Z', finishedAt: '2026-09-25T10:43:10Z', arms: ['bare'], outcomes: [{ arm: 'bare', ok: true }] };
    expect(matchedClockLine(done, CELL, [], 0)).toBe('ELAPSED 43:10 TOTAL');
    expect(matchedClockLine({ state: 'running' }, CELL, [], 0)).toBeNull();
  });
});

describe('the HARNESS arm is lane-seated (the platform agent, identity off)', () => {
  it('needs a lane, rides the lane route (no default endpoint), and says why', async () => {
    const { identityArgv, endpointArgv, LANE_ARMS } = await import('../../backend/services/bench/bench-matched.js');
    expect(LANE_ARMS).toEqual(['harness', 'silo', 'neuma']);
    expect(identityArgv('harness', {}).reason).toMatch(/borrows the lane's workspace and tools, never its identity/);
    expect(identityArgv('harness', { lane: 'keir' })).toEqual({ ok: true, argv: ['--lane', 'keir'] });
    expect(endpointArgv('harness', {}, { servingEndpoint: 'http://127.0.0.1:8089' })).toEqual({ ok: true, argv: [] });
    expect(endpointArgv('platform', {}, { servingEndpoint: 'http://127.0.0.1:8089' }).argv).toContain('--endpoint');
  });
});

