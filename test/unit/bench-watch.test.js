// THE WATCH (Design note, 2026-10-15: […]) — the
// pure readings behind the composer's BENCHMARK chip, the BENCH window's live
// stage bar, and the card a settled set sends the operator.
import { describe, expect, test } from 'vitest';
import { tqdmProgress, liveLine } from '../../backend/services/bench/bench-live.js';
import { settledCard } from '../../backend/services/bench/bench-matched.js';
import { benchChipView, liveRunLine } from '../../frontend/app/RelinkShell/bench-run-chip-view.js';
import { chainStages } from '../../frontend/app/RelinkShell/bench-launch-layout-view.js';

const chain = (over = {}) => ({
  state: 'running', cell: 'smoke', arms: ['bare', 'harness'], currentIndex: 1, currentArm: 'harness',
  comparisonId: 'desk-1', startedAt: '2026-10-15T09:45:43Z', outcomes: [{ arm: 'bare', ok: true }], ...over,
});
const run = { pid: 7, cell: 'smoke', arm: 'harness', minutes: 4, comparisonId: 'desk-1', done: 3, total: 5 };

describe('reading a running arm', () => {
  test('the lm-eval progress line: the NEWEST count wins', () => {
    const log = 'Requesting API:  20%|█ | 1/5 [00:04<00:16]\rRequesting API:  60%|███ | 3/5 [00:13<00:08, 4.13s/it]';
    expect(tqdmProgress(log)).toEqual({ done: 3, total: 5 });
    expect(tqdmProgress('no progress here')).toBeNull();
  });

  test('a run reads as one line; unknown items are left out, never guessed', () => {
    expect(liveLine(run)).toBe('smoke · harness arm · 3 of 5 items · 4 min');
    expect(liveLine({ cell: 'inspect-gpqa-diamond', arm: 'bare', minutes: 12, done: null, total: 198 }))
      .toBe('inspect-gpqa-diamond · bare arm · 12 min');
    expect(liveRunLine(run)).toBe(liveLine(run));
  });
});

describe('the composer chip', () => {
  test('nothing running — nothing shown', () => {
    expect(benchChipView({ live: [], chain: null })).toBeNull();
    expect(benchChipView({ live: [], chain: chain({ state: 'done' }) })).toBeNull();
    expect(benchChipView(null)).toBeNull();
  });

  test('a run names its cell, arm and items, and the bar fills with them', () => {
    const view = benchChipView({ live: [run], chain: chain() });
    expect(view.label).toBe('BENCHMARK · smoke · harness · 3/5');
    expect(view.fill).toBeCloseTo(0.6);
    expect(view.detail).toContain('harness arm · 4 min · 3 of 5 items');
  });

  test('the minute before an arm takes the GPU still shows — and what comes next', () => {
    const view = benchChipView({ live: [], chain: chain({ currentIndex: 0, currentArm: 'bare', outcomes: [] }) });
    expect(view.label).toBe('BENCHMARK · smoke · bare');
    expect(view.detail).toContain('starting');
    expect(view.detail).toContain('then harness');
    expect(view.fill).toBeNull();
  });

  test('a run another desk launched (no chain here) shows too', () => {
    expect(benchChipView({ live: [{ pid: 9, cell: 'inspect-mmlu', arm: 'neuma', minutes: 30 }], chain: null }).label)
      .toBe('BENCHMARK · inspect-mmlu · neuma');
  });
});

describe('the BENCH window stage bar', () => {
  test('the live arm fills by items done when the machine reports them', () => {
    const stages = chainStages(chain(), null, [], Date.parse('2026-10-15T09:50:00Z'), [run]);
    expect(stages[0]).toMatchObject({ arm: 'bare', state: 'done', fill: 1 });
    expect(stages[1]).toMatchObject({ arm: 'harness', state: 'live', fill: 0.6, items: '3/5' });
  });

  test('without a reading it falls back to the estimate, never claiming a finish', () => {
    const [, live] = chainStages(chain(), null, [], Date.now(), []);
    expect(live.state).toBe('live');
    expect(live.items).toBeUndefined();
    expect(live.fill).toBeLessThanOrEqual(0.95);
  });
});

describe('the card a settled set sends', () => {
  test('done, every arm ok', () => {
    expect(settledCard(chain({ state: 'done', outcomes: [{ arm: 'bare', ok: true }, { arm: 'harness', ok: true }] })))
      .toEqual({ title: 'Benchmark smoke finished', detail: 'bare ✓ · harness ✓ · desk-1' });
  });

  test('a failed arm and a stop say so', () => {
    expect(settledCard(chain({ state: 'done', outcomes: [{ arm: 'bare', ok: true }, { arm: 'harness', ok: false }] })).title)
      .toBe('Benchmark smoke finished with a failed arm');
    expect(settledCard(chain({ state: 'stopped', outcomes: [{ arm: 'bare', ok: true }, { arm: 'harness', skipped: true }] })))
      .toEqual({ title: 'Benchmark smoke was stopped', detail: 'bare ✓ · harness — · desk-1' });
  });
});

describe('the BENCH window keeps LIVE apart from LAUNCH', () => {
  test('LIVE wears its dot while a run is live and shows the run; quiet otherwise', async () => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { BenchBody } = await import('../../frontend/app/RelinkShell/BenchBody.jsx');
    const { BenchLive } = await import('../../frontend/app/RelinkShell/BenchLive.jsx');
    const status = { serving: { ok: true }, live: [{ pid: 9, cell: 'inspect-mmlu', arm: 'neuma', minutes: 30, done: 40, total: 100 }] };
    const busy = renderToStaticMarkup(createElement(BenchBody, { tab: 'live', onTab: () => {}, status, nowMs: Date.now() }));
    expect(busy).toMatch(/role="tab"[^>]*>(<[^>]+>)*●(<[^>]+>)* LIVE/);
    expect(busy).toContain('RUNNING NOW — ON THIS MACHINE');
    expect(busy).toContain('inspect-mmlu · neuma arm · 40 of 100 items · 30 min');
    const quiet = renderToStaticMarkup(createElement(BenchLive, { status: { live: [], chain: null } }));
    expect(quiet).toContain('NOTHING IS RUNNING ON THIS MACHINE');
    expect(quiet).toContain('LAUNCH A BENCHMARK →');
  });
});

describe('the chat card a launch leaves — watched to its end in the conversation', () => {
  const bench = { comparisonId: 'desk-1', cell: 'smoke', arms: ['bare', 'harness'] };
  test('running: the arm, the items, the minutes — and the arms already landed', async () => {
    const { benchRunCardView } = await import('../../frontend/app/RelinkShell/bench-run-chip-view.js');
    const view = benchRunCardView(bench, { live: [run], chain: chain(), runs: [{ comparisonId: 'desk-1', arm: 'bare', status: 'succeeded', primaryMetric: { value: 0.8 } }] });
    expect(view).toMatchObject({ state: 'running', fill: 0.6 });
    expect(view.line).toBe('running · harness arm · 3 of 5 items · 4 min · bare ✓ 0.8');
  });

  test('settled on this desk: every arm with its mark and score', async () => {
    const { benchRunCardView } = await import('../../frontend/app/RelinkShell/bench-run-chip-view.js');
    const runs = [
      { comparisonId: 'desk-1', arm: 'bare', status: 'succeeded', primaryMetric: { value: 0.8 } },
      { comparisonId: 'desk-1', arm: 'harness', status: 'succeeded', primaryMetric: { value: 1 } },
    ];
    const done = chain({ state: 'done', outcomes: [{ arm: 'bare', ok: true }, { arm: 'harness', ok: true }] });
    expect(benchRunCardView(bench, { chain: done, runs })).toEqual({ state: 'done', line: 'finished · bare ✓ 0.8 · harness ✓ 1', fill: null });
    // a restarted desk has no chain — the sealed runs still tell how it ended
    expect(benchRunCardView(bench, { chain: null, runs }).line).toBe('finished · bare ✓ 0.8 · harness ✓ 1');
    expect(benchRunCardView(bench, { chain: null, runs: runs.slice(0, 1) }))
      .toMatchObject({ state: 'failed', line: 'did not finish every arm · bare ✓ 0.8 · harness —' });
  });

  test('another desk\'s set of the same comparison is never mistaken for this one', async () => {
    const { benchRunCardView } = await import('../../frontend/app/RelinkShell/bench-run-chip-view.js');
    expect(benchRunCardView(bench, { chain: chain({ comparisonId: 'desk-2' }), runs: [] }).state).toBe('unknown');
  });
});
