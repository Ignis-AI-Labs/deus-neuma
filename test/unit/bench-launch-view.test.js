// bench-launch-view.test.js — the LAUNCH tab's display law, split from
// bench-view.test.js under the 500-line law (the size-law decomposition:
// describe-family files over shared real fixtures). The RUN A BENCHMARK
// helpers proven pure against the real catalog/models fixtures, and the tab
// rendered for real (react-dom/server) over the server's own shapes.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  tierLegend, tierLegendFor, armChoices, armName, durationLine,
  servedModelMatch, subjectNotice, laneOptions,
  readinessVerdict, fineControlParams, chainMarkRow, matchedProgressView,
  launchProgressLine,
} from '../../frontend/app/RelinkShell/bench-launch-view.js';
import {
  tierTabs, openTier, benchmarkRow, armsForCell, chainStages, familyRows, variantLine,
} from '../../frontend/app/RelinkShell/bench-launch-layout-view.js';
import { launchResultView } from '../../frontend/app/RelinkShell/bench-view.js';
import { applyVariant } from '../../backend/services/bench/bench-catalog.js';
import { BenchLaunch } from '../../frontend/app/RelinkShell/BenchLaunch.jsx';
import { BenchLive } from '../../frontend/app/RelinkShell/BenchLive.jsx';

const FIX = (name) => readFileSync(path.resolve('test/fixtures/bench', name), 'utf8');
const CELL = JSON.parse(FIX('CELL.json'));
const MODELS = JSON.parse(FIX('models.json')).models;
// The models as the /models route projects them (bench-catalog.listModels).
const MODEL_LIST = Object.entries(MODELS).map(([key, m]) => ({
  key,
  label: m.label,
  servedId: m.servedId ?? null,
  fileName: typeof m.file === 'string' ? m.file.split('/').pop() : null,
  hasSha256: typeof m.sha256 === 'string' && m.sha256.length > 0,
  quantization: m.quantization ?? null,
}));

const NOW = Date.parse('2026-09-23T12:00:00.000Z');

describe('bench-view — RUN A BENCHMARK display law, pure', () => {
  it('tierLegend explains every tier, and unknown tiers never crash', () => {
    const legend = tierLegend();
    expect(legend.map((t) => t.tier)).toEqual(['t0', 't1', 't2', 't3']);
    expect(legend[0]).toMatchObject({
      name: 'T0 SMOKE',
      line: 'proves the road works, says nothing about the model',
      duration: 'a few minutes',
    });
    expect(legend[3].name).toBe('T3 AGENTIC');
    expect(tierLegendFor('t2').name).toBe('T2 DEEP');
    expect(tierLegendFor('t9').name).toBe('T9');
  });

  it('armChoices reads plain: three core arms first (bare DEFAULT), the two diagnostic arms after', () => {
    const arms = armChoices();
    expect(arms.map((a) => a.id)).toEqual(['bare', 'harness', 'neuma', 'platform', 'silo']);
    expect(arms.filter((a) => a.core).map((a) => a.name)).toEqual(['BARE MODEL', 'HARNESS', 'FULL BEING']);
    expect(arms[0].isDefault).toBe(true);
    expect(arms[1].line).toContain('every identity layer off'); // the platform agent (ruling, 2026-09-29)
    expect(arms[2].line).toContain('benchmarks a being, not a model');
    const diagnostic = arms.filter((a) => !a.core);
    expect(diagnostic.map((a) => a.name)).toEqual(['PLATFORM WIRE', 'SILO']);
    expect(diagnostic.every((a) => a.line.startsWith('Diagnostic:'))).toBe(true);
    expect(diagnostic[1].line).toContain('NITE'); // the silo names the identity engine it tests
  });

  it('durationLine — minutes under an hour, hours past it, nothing when undeclared', () => {
    expect(durationLine(2700)).toBe('~45 MIN');
    expect(durationLine(240)).toBe('~4 MIN');
    expect(durationLine(30)).toBe('~1 MIN');
    expect(durationLine(5400)).toBe('~1.5 H');
    expect(durationLine(7200)).toBe('~2 H');
    expect(durationLine(undefined)).toBe('');
    expect(durationLine(0)).toBe('');
  });

  it('benchmarkRow — the family as the name, the rest as plain words, the id as metadata', () => {
    const row = benchmarkRow({ id: CELL.id, label: CELL.label, tier: CELL.tier, dimensions: CELL.dimensions, cost: CELL.cost, arms: CELL.arms });
    expect(row).toMatchObject({
      id: 'gsm8k', name: 'GSM8K', about: 'grade-school math word problems, 8-shot chain of thought',
      meta: 'math · reasoning', duration: '~45 min', beingOnly: false, // the fixture's real cost.wallclockSec: 2700
    });
    const tb = benchmarkRow({ id: 'terminal-bench-rem2b', label: 'Terminal-Bench 0.1.1 — rem2 2B (12 tasks)', arms: ['neuma'], cost: { wallclockSec: 21600 } });
    expect(tb).toMatchObject({ name: 'Terminal-Bench 0.1.1', about: 'rem2 2B (12 tasks)', duration: '~6 h', beingOnly: true });
    expect(benchmarkRow({ id: 'x', label: 'Plain' })).toMatchObject({ name: 'Plain', about: '', duration: '' });
  });

  it('servedModelMatch — the loaded truth first, the probe string as fallback, .gguf tolerated', () => {
    const models = MODEL_LIST;
    // The platform's loaded truth wins over the probe string entirely.
    expect(servedModelMatch({ ok: true, loaded: 'qwen3.8-27b', models: ['/proc/self/fd/4'] }, models))
      .toMatchObject({ state: 'matched', model: { key: 'qwen3.8-27b' } });
    // The supervised key drops the .gguf extension — the registry's fileName still matches.
    const hauhaucs = MODEL_LIST.find((m) => m.key === 'qwen3.8-27b-uncensored-hauhaucs');
    const loadedKey = `${hauhaucs.fileName.replace(/\.gguf$/, '')}`;
    expect(servedModelMatch({ ok: true, loaded: `HauhauCS/dir/${loadedKey}`, models: [] }, models))
      .toMatchObject({ state: 'matched', model: { key: 'qwen3.8-27b-uncensored-hauhaucs' } });
    // The fd-blind probe falls back to the probe string when no loaded truth rides.
    const servedPath = hauhaucs.servedId;
    expect(servedModelMatch({ ok: true, models: [servedPath] }, models))
      .toMatchObject({ state: 'matched', model: { key: 'qwen3.8-27b-uncensored-hauhaucs' } });
    // A stranger is named, never substituted.
    const stranger = servedModelMatch({ ok: true, loaded: '/models/Some-Stranger.gguf', models: ['/proc/self/fd/4'] }, models);
    expect(stranger.state).toBe('unregistered');
    expect(stranger.served).toBe('/models/Some-Stranger.gguf');
    // Nothing serving at all — not-serving, not a guess.
    expect(servedModelMatch({ ok: false, error: 'down' }, models).state).toBe('not-serving');
    expect(servedModelMatch({ ok: true, models: [] }, models).state).toBe('not-serving');
    expect(servedModelMatch(null, models).state).toBe('not-serving');
  });

  it('subjectNotice — shown not chosen, with the honest blocks', () => {
    const matched = { state: 'matched', model: { key: 'qwen3.8-27b', label: 'Qwen3.8 27B Q8_0 — the house substrate' }, served: 'qwen3.8-27b' };
    expect(subjectNotice(matched)).toBeNull();
    const unregistered = { state: 'unregistered', served: '/models/Some-Stranger.gguf' };
    expect(subjectNotice(unregistered)).toContain('not bench-registered');
    const dark = { state: 'not-serving', served: null };
    expect(subjectNotice(dark)).toBe('«NOTICE» NOTHING IS LOADED — LOAD A MODEL FIRST');
  });

  it('laneOptions — the operator\u2019s own lanes as Select options, kind named', () => {
    expect(laneOptions([
      { laneId: 'hazel', label: 'Hazel', kind: 'neuma' },
      { laneId: 'witness-xai-Grok', label: 'Grok', kind: 'witness' },
    ])).toEqual([
      { value: 'hazel', label: 'Hazel — NEUMA' },
      { value: 'witness-xai-Grok', label: 'Grok — WITNESS' },
    ]);
    expect(laneOptions(null)).toEqual([]);
  });

  it('readinessVerdict — the gate\u2019s own last line rides verbatim', () => {
    expect(readinessVerdict({ exitCode: 0, stdoutTail: '\n  ✓ preflight passed. Nothing was spent.\n' }))
      .toEqual({ ok: true, line: 'READY — ✓ preflight passed. Nothing was spent.' });
    expect(readinessVerdict({ exitCode: 1, stdoutTail: 'slab absent — run bench pull\n' }).line)
      .toBe('NOT READY — slab absent — run bench pull');
    expect(readinessVerdict({ exitCode: 2, stdoutTail: '' }).line).toBe('NOT READY — exit 2');
    expect(readinessVerdict(null).ok).toBe(false);
  });

  it('fineControlParams — empty means NOT SENT; numbers coerce; whitespace trims', () => {
    const EMPTY = { limit: '', attempt: '', deadline: '', comparisonId: '', lane: '', workspaceRoot: '' };
    expect(fineControlParams(EMPTY)).toEqual({});
    expect(fineControlParams({ ...EMPTY, limit: ' 25 ', attempt: '2' })).toEqual({ limit: 25, attempt: 2 });
    expect(fineControlParams({ ...EMPTY, deadline: ' 2026-10-01T00:00:00Z ', comparisonId: 'cmp-1', lane: ' hazel ' }))
      .toEqual({ deadline: '2026-10-01T00:00:00Z', comparisonId: 'cmp-1', lane: 'hazel' });
    expect(fineControlParams({ ...EMPTY, workspaceRoot: '/abs/path' })).toEqual({ workspaceRoot: '/abs/path' });
    // A non-number is passed through for the SERVER to refuse — never client-judged.
    expect(fineControlParams({ ...EMPTY, limit: 'abc' })).toEqual({ limit: NaN });
  });

  it('launchProgressLine — the live run with its expected duration', () => {
    const cell = { cost: { wallclockSec: 2700 } };
    expect(launchProgressLine({ verb: 'run-cell', pid: 7, startedAt: NOW - 120000 }, cell, NOW))
      .toBe('RUNNING — RUN-CELL · STARTED 2M AGO — USUALLY ~45 MIN — WATCHING…');
    expect(launchProgressLine({ verb: 'run-cell', startedAt: NOW }, null, NOW)).toContain('WATCHING…');
  });
});

describe('BenchLaunch — RUN A BENCHMARK, the first-timer flow, rendered for real', () => {
  const FORM = {
    cell: 'gsm8k', arms: ['neuma'], model: '', lane: 'hazel', workspaceRoot: '',
    limit: '', attempt: '', deadline: '', comparisonId: '', plan: 'tb-rem2a-20260918',
  };
  const base = {
    cells: [{ id: 'gsm8k', tier: 't1', label: CELL.label, arms: CELL.arms, dimensions: CELL.dimensions, adapter: 'lm-eval', cost: CELL.cost }],
    models: [
      { key: 'qwen3.8-27b', label: 'Qwen3.8 27B Q8_0 — the house substrate', servedId: 'qwen3.8-27b', fileName: 'qwen3.8-27B-Q8_0.gguf', hasSha256: true, quantization: 'Q8_0' },
      { key: 'qwen3-30b-a3b-thinking', label: 'Q30', servedId: 'qwen3-30b-a3b-thinking-2507', fileName: 'Qwen3-30B.gguf', hasSha256: false, quantization: 'Q8_0' },
    ],
    lanes: [
      { laneId: 'hazel', label: 'Hazel', kind: 'neuma' },
      { laneId: 'witness-xai-Grok', label: 'Grok', kind: 'witness' },
    ],
    plans: [{ name: 'tb-rem2a-20260918', windowHours: 8, model: 'qwen3.8-27b-uncensored-hauhaucs', groupCount: 1, stepCount: 1 }],
    serving: { ok: true, models: ['/proc/self/fd/4'], loaded: 'qwen3.8-27b' },
    form: FORM, onForm: () => {}, busy: false, refusal: null, result: null,
    preflightResults: null, runFired: false, chain: null,
    onPreflight: () => {}, onRun: () => {}, onPlanVerb: () => {}, onReadVerb: () => {},
    confirmNight: false, onAskNight: () => {}, onCancelNight: () => {},
    owned: [], onStop: () => {}, nowMs: NOW,
  };

  it('two columns: tier tabs over a short list on the left, THIS RUN on the right', () => {
    const html = renderToStaticMarkup(createElement(BenchLaunch, base));
    expect(html).toContain('class="bl-setup"');
    expect(html).toContain('aria-label="This run"');
    // 1 BENCHMARK — a tab per tier PRESENT, with its count; the open tier's
    // meaning reads as a sentence; its benchmarks are options, the family as
    // the name and the id only as metadata.
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/T1 QUICK <span class="bl-tier-count">1<\/span>/);
    expect(html).not.toContain('T0 SMOKE');
    expect(html).toContain('Core capability checks (math, instruction-following) — minutes.');
    expect(html).toContain('role="option" aria-selected="true"');
    expect(html).toContain('<span class="bl-bench-name">GSM8K</span>');
    expect(html).toContain('math · reasoning · ~45 min · gsm8k');
    // 2 HOW IT RUNS — the four tiles, the id small, bare marked default.
    expect(html).toContain('HOW IT RUNS');
    expect(html).toContain('A matched set shares one comparison id, so the bars land side by side in REPORTS.');
    expect(html).toContain('BARE MODEL');
    expect(html).toContain('bare · default');
    expect(html).toContain('benchmarks a being, not a model');
    // The jargon is GONE.
    expect(html).not.toContain('RUN ONE CELL');
    expect(html).not.toContain('choose the question');
    // THIS RUN — the picked benchmark, the cost as one numeral, the acts.
    expect(html).toContain('<span class="bl-numeral kx-scan">~45 min</span>');
    expect(html).toContain('CHECK READINESS');
    expect(html).toContain('RUN THE BENCHMARK');
    // Fine control starts collapsed; expert values sit behind it, EMPTY.
    expect(html).toContain('FINE CONTROL — OPEN');
    expect(html).not.toContain('EMPTY MEANS THE FIELD IS NOT SENT');
    // WINDOW / NIGHT and the harness checks sit behind folds.
    expect(html).toContain('ADVANCED — WINDOW / NIGHT');
    expect(html).not.toContain('VALIDATE WINDOW');
    expect(html).toContain('HARNESS CHECKS — DOCTOR / LIST');
  });

  it('a benchmark that does not offer an arm shows it dimmed with the reason, never hidden', () => {
    const tb = { id: 'terminal-bench-rem2b', tier: 't3', label: 'Terminal-Bench 0.1.1 — rem2 2B (12 tasks)', arms: ['neuma'], dimensions: ['agents'], cost: { wallclockSec: 21600 } };
    const html = renderToStaticMarkup(createElement(BenchLaunch, {
      ...base, cells: [...base.cells, tb], form: { ...FORM, cell: tb.id, arms: ['neuma'] },
    }));
    expect(html).toMatch(/<button type="button" aria-pressed="false" disabled="" class="bl-arm kx-lock kx-cham">.*?not offered by this benchmark/);
    expect(html).toContain('1 OF 1 PICKED');
    expect(html).toContain('full being only');
    expect(html).toContain('<span class="bl-numeral kx-scan">~6 h</span>');
  });

  it('an identity arm reveals the lane as a Select of the operator\u2019s OWN lanes; floor arms hide it', () => {
    const identity = renderToStaticMarkup(createElement(BenchLaunch, base));
    expect(identity).toContain('ONE LANE RIDES EVERY IDENTITY ARM');
    expect(identity).toContain('Identity arms benchmark a being, not a model');
    // The lane is a dropdown of MY house + MY witnesses — never free text.
    expect(identity).toContain('aria-label="The being under test"');
    expect(identity).toContain('Hazel — NEUMA');
    expect(identity).not.toContain('bench-input" value="hazel'); // no free-text lane field
    const floor = renderToStaticMarkup(createElement(BenchLaunch, { ...base, form: { ...FORM, arms: ['bare'] } }));
    expect(floor).not.toContain('ONE LANE RIDES');
    const noLanes = renderToStaticMarkup(createElement(BenchLaunch, { ...base, lanes: [] }));
    expect(noLanes).toContain('NO BEINGS IN YOUR HOUSE YET');
  });

  it('the loaded model is SHOWN not chosen — matched names the registry; unregistered and not-serving block honestly', () => {
    const matched = renderToStaticMarkup(createElement(BenchLaunch, base));
    expect(matched).toContain('MODEL UNDER TEST');
    expect(matched).toContain('Qwen3.8 27B Q8_0 — the house substrate');
    expect(matched).toContain('as served · qwen3.8-27b');
    // No subject picker anywhere — the fd-serving probe string never leaks.
    expect(matched).not.toContain('/proc/self/fd/4');
    expect(matched).not.toContain('A DIFFERENT SUBJECT');
    const stranger = renderToStaticMarkup(createElement(BenchLaunch, {
      ...base, serving: { ok: true, models: ['/proc/self/fd/4'], loaded: '/models/Some-Stranger.gguf' },
    }));
    expect(stranger).toContain('Some-Stranger.gguf');
    expect(stranger).toContain('«NOTICE» the loaded model');
    expect(stranger).toContain('not bench-registered');
    expect(stranger).toMatch(/RUN THE BENCHMARK/);
    expect(stranger).toMatch(/disabled=""[^>]*>RUN THE BENCHMARK/);
    const dark = renderToStaticMarkup(createElement(BenchLaunch, { ...base, serving: { ok: false, error: 'x' } }));
    expect(dark).toContain('«NOTICE» NOTHING IS LOADED — LOAD A MODEL FIRST');
  });

  it('fine control opened shows the law and EMPTY fields; a readiness verdict and a live run read plain', () => {
    const open = renderToStaticMarkup(createElement(BenchLaunch, {
      ...base, fineStartOpen: true,
      preflightResults: [{ arm: 'neuma', result: { exitCode: 0, stdoutTail: '\n    ✓ preflight passed. Nothing was spent.\n' } }],
    }));
    expect(open).toContain('EMPTY MEANS THE FIELD IS NOT SENT');
    expect(open).toContain('NEUMA — READY — ✓ preflight passed. Nothing was spent.');
    // a run in flight is WATCHED in LIVE — LAUNCH only points there, and offers no second run
    const running = renderToStaticMarkup(createElement(BenchLaunch, {
      ...base,
      owned: [{ verb: 'run-benchmark', pid: 7, startedAt: NOW - 60000, logFile: '/l', long: true }],
    }));
    expect(running).toContain('A RUN IS IN FLIGHT');
    expect(running).toContain('WATCH IT LIVE →');
    expect(running).not.toContain('RUN THE BENCHMARK');
    expect(running).not.toContain('STOP THE RUN'); // STOP stands in LIVE, beside the run it stops
    const fired = renderToStaticMarkup(createElement(BenchLaunch, { ...base, runFired: true, owned: [{ verb: 'run-benchmark', pid: 7, startedAt: NOW, long: true }] }));
    expect(fired).toContain('THE RUN IS FIRED');
    const watched = renderToStaticMarkup(createElement(BenchLive, {
      status: { owned: [{ verb: 'run-benchmark', pid: 7, startedAt: NOW - 60000, logFile: '/l', long: true }] }, nowMs: NOW,
    }));
    expect(watched).toContain('RUNNING — RUN-BENCHMARK');
    expect(watched).toContain('RUNS →');
    expect(watched).toContain('STOP THE RUN');
  });

  it('the multi-select marks the chosen arms and prices the set; the chain reads as a stage list', () => {
    const two = renderToStaticMarkup(createElement(BenchLaunch, {
      ...base, form: { ...FORM, arms: ['bare', 'neuma'] },
    }));
    expect(two).toContain('✓ BARE MODEL');
    expect(two).toContain('✓ FULL BEING');
    expect(two).toContain('2 OF 5 PICKED');
    expect(two).toContain('RUN THE MATCHED SET (2)');
    expect(two).toContain('<span class="bl-numeral kx-scan">~1.5 h</span>');
    expect(two).toContain('bare model ~45 min · full being ~45 min');
    expect(two).toContain('2 arms · Hazel');
    const chainState = {
      chainId: 'chain-x', state: 'running', cell: 'gsm8k', arms: ['bare', 'neuma'],
      comparisonId: 'desk-x', startedAt: new Date(NOW - 60000).toISOString(),
      currentIndex: 1, currentArm: 'neuma',
      outcomes: [{ arm: 'bare', exitCode: 0, signal: null, ok: true, logFile: '/l' }],
    };
    const launch = renderToStaticMarkup(createElement(BenchLaunch, { ...base, form: { ...FORM, arms: ['bare', 'neuma'] }, chain: chainState }));
    expect(launch).toContain('WATCH IT LIVE →');
    expect(launch).not.toContain('bl-stage'); // the stage list lives in LIVE
    const chain = renderToStaticMarkup(createElement(BenchLive, {
      status: { chain: chainState, live: [{ pid: 9, cell: 'gsm8k', arm: 'neuma', minutes: 3, done: 4, total: 10 }] },
      cells: base.cells, nowMs: NOW,
    }));
    expect(chain).toContain('RUNNING NOW — THIS DESK');
    expect(chain).toContain('ARM 2 OF 2 — FULL BEING — RUNNING…');
    expect(chain).toContain('receipts land in RUNS as they seal');
    expect(chain).toMatch(/class="bl-stage is-done">.*?✓.*?BARE MODEL/);
    expect(chain).toMatch(/class="bl-stage is-live">.*?….*?FULL BEING.*?4\/10/);
    expect(chain).toContain('STOP THE RUN');
    expect(chain).not.toContain('bl-numeral'); // a running set shows the clock, not the pre-run price
  });

  it('the advanced disclosure opens to the plan verbs; the night-start confirm keeps its «NOTICE»', () => {
    const html = renderToStaticMarkup(createElement(BenchLaunch, { ...base, advancedStartOpen: true, confirmNight: true }));
    expect(html).toContain('overnight instrument');
    expect(html).toContain('VALIDATE WINDOW');
    expect(html).toContain('«NOTICE» NIGHT START opens a real benchmark window on the GPU');
    const refused = renderToStaticMarkup(createElement(BenchLaunch, {
      ...base, refusal: 'the rig is locked by pid 42 — one benchmark at a time',
    }));
    expect(refused).toContain('the rig is locked by pid 42');
    const argv = renderToStaticMarkup(createElement(BenchLaunch, {
      ...base,
      result: launchResultView('RUN THE BENCHMARK — gsm8k / neuma', { argv: ['bench.mjs', 'run', 'gsm8k', '--lane', 'hazel'], pid: 7, logFile: '/l', long: true }),
    }));
    expect(argv).toContain('node bench.mjs run gsm8k --lane hazel');
  });
});


describe('the two-column layout display law, pure', () => {
  const CELLS = [
    { id: 'smoke', tier: 't0', label: 'SMOKE — 5 GSM8K problems; proves the road, never the model', arms: CELL.arms, cost: { wallclockSec: 240 } },
    { id: 'gsm8k', tier: 't1', label: CELL.label, arms: CELL.arms, cost: CELL.cost },
    { id: 'ifeval', tier: 't1', label: 'IFEval — instruction following', arms: CELL.arms, cost: {} },
    { id: 'terminal-bench-rem2b', tier: 't3', label: 'Terminal-Bench 0.1.1 — rem2 2B (12 tasks)', arms: ['neuma'], cost: { wallclockSec: 21600 } },
  ];

  it('tierTabs — the tiers PRESENT in T0→T3 order, counted, the meaning a sentence; an unknown tier names itself', () => {
    expect(tierTabs(CELLS).map((t) => [t.name, t.count])).toEqual([['T0 SMOKE', 1], ['T1 QUICK', 2], ['T3 AGENTIC', 1]]);
    expect(tierTabs(CELLS)[1].line).toBe('Core capability checks (math, instruction-following)');
    expect(tierTabs([{ tier: 't4' }])).toEqual([{ tier: 't4', name: 'T4', line: '', duration: '', count: 1 }]);
    expect(tierTabs(null)).toEqual([]);
  });

  it('openTier — the browsed tab, else the picked benchmark\u2019s tier, else the first present', () => {
    expect(openTier(CELLS, '', null)).toBe('t0');
    expect(openTier(CELLS, 'terminal-bench-rem2b', null)).toBe('t3');
    expect(openTier(CELLS, 'terminal-bench-rem2b', 't1')).toBe('t1');
    expect(openTier(CELLS, '', 't9')).toBe('t0'); // a tab no benchmark stands in never opens
    expect(openTier([], '', null)).toBeNull();
  });

  // THE FAMILIES — the real gsm8k cell and its real variant overlay (the
  // harness's variants/ layout, 2026-09-26), laid over each other by the
  // plane's own applyVariant: one row per benchmark, the versions beneath.
  const VARIANT = JSON.parse(FIX('variants/gsm8k-2568.json'));
  const FAMILY = [
    ...CELLS.map((c) => ({ ...c, family: c.id, variant: false })),
    { ...applyVariant({ id: 'gsm8k', tier: 't1', label: CELL.label, arms: CELL.arms, cost: CELL.cost }, { id: VARIANT.id, label: VARIANT.label }), family: 'gsm8k', variant: true },
  ];

  it('tierTabs counts benchmarks, never a variant as another benchmark', () => {
    expect(tierTabs(FAMILY).find((t) => t.tier === 't1').count).toBe(2);
  });

  it('familyRows — one row per family; its versions asked only once it is picked', () => {
    const idle = familyRows(FAMILY, 't1', '');
    expect(idle.map((r) => r.family)).toEqual(['gsm8k', 'ifeval']);
    expect(idle[0]).toMatchObject({ name: 'GSM8K', on: false, pickedVersion: null });
    expect(idle[0].versions.map((v) => v.id)).toEqual(['gsm8k', 'gsm8k-2568']);
    expect(idle[0].versions[0].standard).toBe(true);
    expect(idle[0].versions[1].line).toBe('2568-token reasoning and final-answer budget');
    expect(idle[1].versions).toEqual([]); // a family of one asks nothing
    const picked = familyRows(FAMILY, 't1', 'gsm8k-2568');
    expect(picked[0]).toMatchObject({ on: true, pickedVersion: 'gsm8k-2568' });
    expect(openTier(FAMILY, 'gsm8k-2568', null)).toBe('t1');
  });

  it('a variant that earned a higher tier still stands under its family, and says so', () => {
    // benchmarks e47de3bd: math500-8192 lives in cells/t1/math500/variants/ but earns t2.
    const climbed = [...FAMILY, { ...applyVariant({ id: 'gsm8k', tier: 't1', label: CELL.label, arms: CELL.arms, cost: CELL.cost }, { id: 'gsm8k-8192', label: `${CELL.label} — 8192-token budget`, tier: 't2', cost: { wallclockSec: 9300 } }), family: 'gsm8k', variant: true }];
    const row = familyRows(climbed, 't1', 'gsm8k-8192').find((r) => r.family === 'gsm8k');
    expect(row.on).toBe(true);
    expect(row.versions.map((v) => v.id)).toEqual(['gsm8k', 'gsm8k-2568', 'gsm8k-8192']);
    expect(row.versions.find((v) => v.id === 'gsm8k-8192')).toMatchObject({ tier: 'T2', duration: '~2.6 h' });
    expect(row.versions.find((v) => v.id === 'gsm8k-2568').tier).toBeNull();
    expect(openTier(climbed, 'gsm8k-8192', null)).toBe('t1'); // it opens its family's tab
    expect(familyRows(climbed, 't2', '')).toEqual([]); // never a stray row in T2
    expect(tierTabs(climbed).find((t) => t.tier === 't1').count).toBe(2);
  });

  it('variantLine — what sets a version apart, in the harness\u2019s own words', () => {
    const base = { id: 'terminal-bench', label: 'Terminal-Bench legacy core 0.1.1 — end-to-end agentic terminal tasks in containers' };
    expect(variantLine(base, { id: 'terminal-bench-rem2b', label: 'Terminal-Bench 0.1.1 — rem2 2B (12 tasks)' })).toBe('rem2 2B (12 tasks)');
    expect(variantLine({ id: 'ifeval', label: 'IFEval — verifiable instruction-following constraints' }, { id: 'ifeval-budget-smoke', label: 'IFEval budget smoke — 5 prompts, 2048 output tokens' }))
      .toBe('budget smoke — 5 prompts, 2048 output tokens');
    expect(variantLine(base, { id: 'x' })).toBe('x');
  });


  it('armsForCell — a full-being-only benchmark never inherits the default BARE', () => {
    expect(armsForCell(['bare'], CELLS[3])).toEqual(['neuma']);
    expect(armsForCell(['bare', 'neuma'], CELLS[3])).toEqual(['neuma']);
    expect(armsForCell(['bare', 'silo'], CELLS[1])).toEqual(['bare', 'silo']);
    expect(armsForCell(['neuma'], { arms: ['bare', 'platform'] })).toEqual(['bare']);
    expect(armsForCell(['bare'], null)).toEqual(['bare']);
  });

  it('chainStages — landed arms fill, the running arm fills by its estimate but never claims a finish', () => {
    const start = NOW - 30 * 60000;
    const chain = {
      state: 'running', arms: ['bare', 'platform', 'neuma'], currentIndex: 1, currentArm: 'platform',
      startedAt: new Date(start).toISOString(), armStartedAt: new Date(NOW - 9 * 60000).toISOString(),
      outcomes: [{ arm: 'bare', ok: true }],
    };
    const cell = { id: 'gsm8k', cost: { wallclockSec: 1800 } };
    const stages = chainStages(chain, cell, [], NOW);
    expect(stages.map((s) => s.state)).toEqual(['done', 'live', 'pending']);
    expect(stages[0].fill).toBe(1);
    expect(stages[1].fill).toBeCloseTo(0.3, 5); // 9 of 30 minutes
    expect(stages[2].fill).toBe(0);
    const late = chainStages({ ...chain, armStartedAt: new Date(NOW - 90 * 60000).toISOString() }, cell, [], NOW);
    expect(late[1].fill).toBe(0.95);
    const stopped = { state: 'stopped', arms: ['bare', 'platform'], outcomes: [{ arm: 'bare', ok: false }, { arm: 'platform', skipped: true }] };
    expect(chainStages(stopped, cell, [], NOW).map((s) => s.state)).toEqual(['failed', 'skipped']);
    expect(chainStages(null)).toEqual([]);
  });
});

describe('the matched-set display law, pure', () => {
  it('armName reads plain from the id, with a total fallback', () => {
    expect(armName('bare')).toBe('BARE MODEL');
    expect(armName('neuma')).toBe('FULL BEING');
    expect(armName('mystery')).toBe('MYSTERY');
  });

  it('chainMarkRow — verdicts from outcomes only, never invented', () => {
    const running = {
      state: 'running', arms: ['bare', 'platform', 'neuma'], currentIndex: 1,
      outcomes: [{ arm: 'bare', ok: true }],
    };
    expect(chainMarkRow(running).map((m) => m.mark)).toEqual(['✓', '…', '·']);
    expect(chainMarkRow(running).map((m) => m.name)).toEqual(['BARE MODEL', 'PLATFORM WIRE', 'FULL BEING']);
    const settled = {
      state: 'done', arms: ['bare', 'platform'], currentIndex: null,
      outcomes: [{ arm: 'bare', ok: true }, { arm: 'platform', ok: false }],
    };
    expect(chainMarkRow(settled).map((m) => m.mark)).toEqual(['✓', '✗']);
    const stopped = {
      state: 'stopped', arms: ['bare', 'platform'], currentIndex: null,
      outcomes: [{ arm: 'bare', ok: false, signal: 'SIGTERM' }, { arm: 'platform', skipped: true }],
    };
    expect(chainMarkRow(stopped).map((m) => m.mark)).toEqual(['✗', '—']);
    expect(chainMarkRow(null)).toEqual([]);
  });

  it('matchedProgressView — the line per state, marks always ride', () => {
    expect(matchedProgressView(null)).toBeNull();
    const running = {
      state: 'running', arms: ['bare', 'neuma'], currentIndex: 1, currentArm: 'neuma',
      outcomes: [{ arm: 'bare', ok: true }],
    };
    expect(matchedProgressView(running).line).toBe('ARM 2 OF 2 — FULL BEING — RUNNING… receipts land in RUNS as they seal');
    expect(matchedProgressView(running).marks.length).toBe(2);
    const done = {
      state: 'done', arms: ['bare', 'platform'], currentIndex: null,
      outcomes: [{ arm: 'bare', ok: true }, { arm: 'platform', ok: false }],
    };
    expect(matchedProgressView(done).line).toContain('MATCHED SET SETTLED — 1/2 ARMS CLEAN');
    expect(matchedProgressView(done).line).toContain('1 FAILED — THE RECEIPTS CARRY IT');
    expect(matchedProgressView({ state: 'stopped', arms: ['bare'], outcomes: [], currentIndex: null }).line)
      .toBe('MATCHED SET STOPPED — THE REST NEVER RAN');
    expect(matchedProgressView({ state: 'failed', error: 'spawn died', arms: [], outcomes: [] }).line)
      .toContain('MATCHED SET FAILED — spawn died');
  });
});
