// bench-view.test.js — the BENCH window's display law, proven two ways
// (mirroring staff-view.test.js): the pure helpers against REAL captured
// harness artifacts (test/fixtures/bench/ — RULE 0), and the whole pane
// rendered for real (react-dom/server) over data shaped exactly like the
// server's own responses.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isHarnessAbsent, relTime, deadlineCountdown,
  servingLive, servingLine, gpuLine, relightResultLines, daemonLine, lockLine, nightLine, nightGroups,
  nightSteps, ownedLine, incidentRow, incidentRows, shortRunId,
  bundleLabel, cellLabel, modelLabel, planLabel, parseMetricsCsv,
  launchResultView, ARTIFACT_KEYS, proofStateLine, proofScoreLine, proofRow,
} from '../../frontend/app/RelinkShell/bench-view.js';
import { IDENTITY_ARMS, isIdentityArm } from '../../frontend/app/RelinkShell/bench-launch-view.js';
import { BenchBody } from '../../frontend/app/RelinkShell/BenchBody.jsx';
import { BenchLibrary } from '../../frontend/app/RelinkShell/BenchLibrary.jsx';
import { BenchRelight } from '../../frontend/app/RelinkShell/BenchRelight.jsx';
import { BenchProof } from '../../frontend/app/RelinkShell/BenchProof.jsx';

const FIX = (name) => readFileSync(path.resolve('test/fixtures/bench', name), 'utf8');
const NIGHT = JSON.parse(FIX('night-status.json'));
const CELL = JSON.parse(FIX('CELL.json'));
const MODELS = JSON.parse(FIX('models.json')).models;
const PLAN = JSON.parse(FIX('plan.json'));
const METRICS_CSV = FIX('bundle/metrics.csv');
const REPORT_MD = FIX('bundle/REPORT.md');
const INCIDENTS = FIX('serving-incidents.jsonl').trim().split('\n').map(JSON.parse);

// The night status as the plane projects it (bench-status.parseNightStatus).
const NIGHT_PROJECTED = {
  file: 'night-20260921t192252z-status.json',
  mtimeMs: Date.parse('2026-09-22T03:16:28.434Z'),
  status: NIGHT.status,
  pid: NIGHT.pid,
  startedAt: NIGHT.startedAt,
  deadline: NIGHT.deadline,
  waitingFor: NIGHT.waitingFor,
  groups: NIGHT.groups.map((g) => ({ id: g.id, status: g.status })),
  steps: [],
  stepCount: 0,
  unstartedGroups: NIGHT.unstartedGroups,
  serving: null,
  abortReason: null,
  finishedAt: NIGHT.finishedAt,
};

const NOW = Date.parse('2026-09-23T12:00:00.000Z');

describe('bench-view — the display law, pure', () => {
  it('identity arms mirror the harness contract', () => {
    expect(IDENTITY_ARMS).toEqual(['silo', 'neuma']);
    expect(isIdentityArm('neuma')).toBe(true);
    expect(isIdentityArm('silo')).toBe(true);
    expect(isIdentityArm('bare')).toBe(false);
    expect(isIdentityArm('platform')).toBe(false);
  });

  it('the harness-absent register reads from the structured refusal code', () => {
    const err = new Error('no benchmark harness at /x');
    err.code = 'BENCH_HARNESS_ABSENT';
    expect(isHarnessAbsent(err)).toBe(true);
    expect(isHarnessAbsent(new Error('other'))).toBe(false);
    expect(isHarnessAbsent(null)).toBe(false);
  });

  it('relTime — past, future, unknown, with the clock injected', () => {
    expect(relTime(NOW - 3 * 60000, NOW)).toBe('3M AGO');
    expect(relTime(NOW - 95 * 60000, NOW)).toBe('1H 35M AGO');
    expect(relTime(NOW - 26 * 3600e3, NOW)).toBe('1D 2H AGO');
    expect(relTime(NOW + 45 * 60000, NOW)).toBe('IN 45M');
    expect(relTime('not-a-date', NOW)).toBe('AGE UNKNOWN');
  });

  it('deadlineCountdown — time left, overdue, unparseable', () => {
    expect(deadlineCountdown('2026-09-23T14:15:00.000Z', NOW)).toEqual({ text: '2H 15M LEFT', overdue: false });
    expect(deadlineCountdown('2026-09-23T11:20:00.000Z', NOW)).toEqual({ text: 'OVERDUE 40M', overdue: true });
    expect(deadlineCountdown('garbage', NOW)).toBeNull();
  });

  it('serving — live with model ids, or DOWN with the reason', () => {
    expect(servingLive({ ok: true, models: ['qwen3.8-27b'] })).toBe(true);
    expect(servingLine({ ok: true, models: ['qwen3.8-27b', 'gemma-4-31b'] }))
      .toBe('SERVING — LIVE · 2 MODELS: qwen3.8-27b, gemma-4-31b');
    expect(servingLine({ ok: true, models: [] })).toContain('NONE LOADED');
    expect(servingLine({ ok: false, error: 'connect ECONNREFUSED' })).toContain('SERVING — DOWN');
    expect(servingLine(null)).toContain('NO READING');
  });

  it('daemons and the rig lock', () => {
    expect(daemonLine('SERVING WATCHDOG', { running: true, pids: [3297777] }))
      .toEqual({ text: 'SERVING WATCHDOG — LIVE (PID 3297777)', live: true });
    expect(daemonLine('SWAP MODEL', { running: false, pids: [] }).text).toBe('SWAP MODEL — NOT RUNNING');
    expect(lockLine(null)).toBeNull();
    expect(lockLine({ pid: 3133354, alive: true }).text).toContain('RIG LOCKED — PID 3133354 ALIVE');
    expect(lockLine({ pid: 1, alive: false }).text).toContain('STALE');
  });

  it('the night window over the REAL fixture status', () => {
    // A finished window reads its terminal status — no countdown, no warning.
    expect(nightLine(NIGHT_PROJECTED, NOW)).toContain('DEADLINE OR SIGNAL');
    expect(nightLine(NIGHT_PROJECTED, NOW)).toContain('FINISHED');
    expect(nightLine(null, NOW)).toBe('NO NIGHT WINDOW ON RECORD');
    const live = { ...NIGHT_PROJECTED, finishedAt: null };
    expect(nightLine(live, Date.parse('2026-09-22T01:00:00.000Z'))).toContain('LEFT');
    const groups = nightGroups(NIGHT_PROJECTED);
    expect(groups).toEqual([{ key: 'heartbeat', text: 'heartbeat — ENDPOINT UNAVAILABLE', register: 'loud' }]);
    expect(nightSteps(NIGHT_PROJECTED)).toEqual([]);
    expect(nightSteps({ steps: [{ cell: 'gsm8k-2568', arm: 'neuma', status: 'failed', attempt: 1 }] })[0].register).toBe('loud');
  });

  it('the incident rail — the real postmortem row plus a watch row, newest first', () => {
    const row = incidentRow(INCIDENTS[0]);
    expect(row.text).toContain('SERVING · POSTMORTEM');
    expect(row.register).toBe('quiet');
    const down = incidentRow({ at: '2026-09-23T01:00:00Z', event: 'down', probeFailures: 6 });
    expect(down.register).toBe('loud');
    const relight = incidentRow({ at: '2026-09-23T02:00:00Z', event: 'relight-exit', code: 1 });
    expect(relight.register).toBe('loud');
    const watch = incidentRow({ at: '2026-09-23T03:00:00Z', source: 'bench-watch', condition: 'endpoint-wait-stall', severity: 'warning', detail: 'stalled' });
    expect(watch.text).toContain('WATCH · ENDPOINT-WAIT-STALL');
    expect(watch.register).toBe('loud');
    const merged = incidentRows({ serving: [INCIDENTS[0], { at: '2026-09-23T01:00:00Z', event: 'down' }], watch: [{ at: '2026-09-23T03:00:00Z', source: 'bench-watch', condition: 'x', severity: 'info' }] });
    expect(merged[0].text).toContain('WATCH');
    expect(merged.length).toBe(3);
  });

  it('shortRunId — the real runId drops its stamp', () => {
    const runId = 'night-20260920t230631z-heartbeat-neuma-a1-20260920230831179';
    expect(shortRunId(runId)).toBe('night-20260920t230631z-heartbeat-neuma-a1');
    expect(shortRunId('plain-id')).toBe('plain-id');
  });

  it('parseMetricsCsv — the REAL fixture rows, quoted commas intact', () => {
    const rows = parseMetricsCsv(METRICS_CSV);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({
      runId: 'night-20260920t230631z-heartbeat-neuma-a1-20260920230831179',
      comparisonId: 'night-20260920t230631z-heartbeat',
      arm: 'neuma', status: 'succeeded', attempt: 1,
      metric: 'gsm8k/exact_match,strict-match', value: 0.96,
    });
    expect(rows[1].metric).toBe('gsm8k/exact_match,flexible-extract');
    expect(parseMetricsCsv('')).toEqual([]);
    expect(ARTIFACT_KEYS).toEqual(['report', 'metrics', 'receipts', 'queue']);
  });

  it('catalog labels over the REAL cell, models, and plan', () => {
    expect(cellLabel({ id: CELL.id, tier: CELL.tier, arms: CELL.arms })).toBe('T1 · gsm8k — 5 ARMS');
    const qwen = { key: 'qwen3.8-27b', quantization: MODELS['qwen3.8-27b'].quantization, hasSha256: true };
    expect(modelLabel(qwen)).toBe('qwen3.8-27b — Q8_0');
    const bare = { key: 'qwen3-30b-a3b-thinking', quantization: 'Q8_0', hasSha256: false };
    expect(modelLabel(bare)).toContain('NO SHA256 — NOT LAUNCH-READY');
    expect(planLabel({ name: 'tb-rem2a-20260918', windowHours: PLAN.windowHours, model: PLAN.model, groupCount: PLAN.groups.length, stepCount: 1 }))
      .toBe('tb-rem2a-20260918 — 8H WINDOW · qwen3.8-27b-uncensored-hauhaucs · 1 GROUP / 1 STEP');
    expect(bundleLabel({ id: 'night-x', mtimeMs: NOW - 3600e3 }, NOW).age).toBe('1H 0M AGO');
  });

  it('owned children and launch results read as the operator fired them', () => {
    expect(ownedLine({ verb: 'run-cell', pid: 42, startedAt: NOW - 60000, logFile: '/tmp/x.log' }, NOW))
      .toBe('RUN-CELL — PID 42 · STARTED 1M AGO · LOG /tmp/x.log');
    const view = launchResultView('RUN gsm8k / neuma', {
      argv: ['bench.mjs', 'run', 'gsm8k', '--arm', 'neuma', '--lane', 'keir'],
      pid: 42, logFile: '/tmp/x.log', long: true,
    });
    expect(view.argvLine).toBe('node bench.mjs run gsm8k --arm neuma --lane keir');
    expect(view.lines[1]).toContain('LONG VERB');
    const short = launchResultView('LIST', { argv: ['bench.mjs', 'list', '--json'], pid: 1, exitCode: 0, logFile: '/l', stdout: '[1]' });
    expect(short.lines[1]).toBe('EXIT 0');
    expect(short.stdout).toBe('[1]');
  });
});

// ── The pane itself, rendered for real over the server's own shapes ─────────

const STATUS = {
  serving: { ok: false, error: 'connect ECONNREFUSED 127.0.0.1:8089' },
  lock: null,
  night: NIGHT_PROJECTED,
  daemons: { servingWatchdog: { running: true, pids: [3297777] }, swapModel: { running: false, pids: [] } },
  gpu: { ok: true, name: 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition', utilizationPercent: 100, memoryUsedMiB: 59331 },
  incidents: INCIDENTS,
  owned: [],
};

const RELIGHT = {
  models: [{ key: 'qwen3.8-27b', label: 'Q', servedId: 'qwen3.8-27b', hasSha256: true, quantization: 'Q8_0' }],
  model: '', onModel: () => {}, busy: false, refusal: null, outcome: null,
  confirm: false, onAsk: () => {}, onCancel: () => {}, onRelight: () => {},
};

const renderBody = (props) => renderToStaticMarkup(createElement(BenchBody, {
  tab: 'overview', onTab: () => {}, absent: false, error: null,
  status: STATUS, incidents: { serving: INCIDENTS, watch: [] }, nowMs: NOW,
  runs: null,
  reports: { bundles: [], selected: null, onSelect: () => {}, artifact: 'report', onArtifact: () => {}, artifactText: null, report: null, loading: false, nowMs: NOW },
  launch: {
    cells: null, models: null, plans: null, form: {}, onForm: () => {}, busy: false,
    refusal: null, result: null, onPreflight: () => {}, onRun: () => {},
    onPlanVerb: () => {}, onReadVerb: () => {}, confirmNight: false,
    onAskNight: () => {}, onCancelNight: () => {}, owned: [], onStop: () => {}, nowMs: NOW,
  },
  relight: RELIGHT,
  ...props,
}));

describe('BenchBody — the whole pane, rendered for real (react-dom/server)', () => {
  it('OVERVIEW reads the rig, the window, and the incident rail', () => {
    const html = renderBody();
    expect(html).toContain('SERVING — DOWN');
    expect(html).toContain('SERVING WATCHDOG — LIVE (PID 3297777)');
    expect(html).toContain('THE RIG IS FREE');
    expect(html).toContain('DEADLINE OR SIGNAL');
    expect(html).toContain('UNSTARTED — arc-bare');
    expect(html).toContain('SERVING · POSTMORTEM');
    expect(html).toContain('NO PLANE-OWNED CHILDREN');
  });

  it('a live waiting window carries the «WARNING» in the alert register', () => {
    const live = { ...NIGHT_PROJECTED, finishedAt: null };
    const html = renderBody({
      status: { ...STATUS, night: live },
      nowMs: Date.parse('2026-09-22T01:00:00.000Z'),
    });
    expect(html).toContain('«WARNING» WAITING FOR MODEL ENDPOINT');
  });

  it('the absent harness reads «NOTICE», never an error crash', () => {
    const html = renderBody({ absent: true, status: null, incidents: null });
    expect(html).toContain('«NOTICE» NO BENCHMARK HARNESS STANDS ON THIS MACHINE');
    expect(html).not.toContain('THE RIG AS IT STANDS');
  });

  it('RUNS renders the ledger: the band, the rail by day and set, the focus', () => {
    const html = renderBody({
      tab: 'runs',
      runs: [
        { runId: 'r-neuma', comparisonId: 'cmp', arm: 'neuma', status: 'succeeded', attempt: 1, suiteId: 'smoke', suiteTier: 't0', startedAt: '2026-09-23T09:06:27.544Z', durationMs: 58993, primaryMetric: { id: 'm', value: 0.8, unit: 'ratio' }, tokens: { prompt: 6600, completion: 743 }, hashes: {} },
        { runId: 'r-bare', comparisonId: 'cmp', arm: 'bare', status: 'failed', attempt: 1, suiteId: 'gsm8k', suiteTier: 't1', startedAt: '2026-09-22T09:06:27.544Z', durationMs: null, primaryMetric: null, tokens: null, hashes: {} },
      ],
    });
    // THE BAND: the ledger in instruments, the failure in the alert register.
    expect(html).toContain('RUNS ON RECORD');
    expect(html).toContain('lx-band-inst is-alert');
    expect(html).toContain('lx-strip');
    // THE RAIL: search, the status counts, one line per run.
    expect(html).toContain('Search run, set or benchmark…');
    expect(html).toContain('FAILED<span class="atlas-seg-n">1</span>');
    expect(html).toContain('lx-status is-loud'); // the failed run reads loud
    // THE FOCUS: the newest run, its score, its set, its provenance.
    expect(html).toContain('<p class="lx-num">80.0%</p>');
    expect(html).toContain('59S');
    expect(html).toContain('THE SET — LAUNCHED TOGETHER');
    expect(html).toContain('PROVENANCE');
    expect(html).toContain('<dd>—</dd>'); // unmeasured instruments read honest
  });
});

// The LIBRARY pane (REPORTS → LIBRARY) — one list of proofs + bundles.
const libraryProps = (over) => ({
  items: [], ready: true, filter: 'all', onFilter: () => {}, selected: null,
  onSelect: () => {}, onStep: () => {}, onShare: () => {}, nowMs: NOW,
  proof: { busy: false, onExportMd: () => {}, onExportPdf: () => {} },
  bundle: { artifact: 'report', onArtifact: () => {}, artifactText: null, report: null, loading: false },
  ...over,
});
const BUNDLE_ITEM = { kind: 'bundle', id: 'night-20260920t230631z', mtimeMs: NOW - 86400e3, key: 'bundle:night-20260920t230631z' };

describe('BenchLibrary — the bundle pane, rendered for real', () => {
  it('REPORT.md renders through Markdown; metrics render as a table', () => {
    const asReport = renderToStaticMarkup(createElement(BenchLibrary, libraryProps({
      items: [BUNDLE_ITEM], selected: { kind: 'bundle', id: BUNDLE_ITEM.id },
      bundle: { artifact: 'report', onArtifact: () => {}, artifactText: null, report: REPORT_MD, loading: false },
    })));
    expect(asReport).toContain('Benchmark night 20260920t230631z');
    expect(asReport).toContain('NIGHT BUNDLE');
    expect(asReport).toContain('1 / 1');

    const asMetrics = renderToStaticMarkup(createElement(BenchLibrary, libraryProps({
      items: [BUNDLE_ITEM], selected: { kind: 'bundle', id: BUNDLE_ITEM.id },
      bundle: { artifact: 'metrics', onArtifact: () => {}, artifactText: METRICS_CSV, report: null, loading: false },
    })));
    expect(asMetrics).toContain('gsm8k/exact_match,strict-match');
    expect(asMetrics).toContain('0.96');
  });
});

describe('bench-view — the gpu + relight lines, pure', () => {
  it('gpuLine — the live driver reads name/util/memory; silence reads loud', () => {
    expect(gpuLine({ ok: true, name: 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition', utilizationPercent: 100, memoryUsedMiB: 59331 }))
      .toEqual({ text: 'GPU — NVIDIA RTX PRO 6000 BLACKWELL WORKSTATION EDITION · 100% · 59331 MIB', alert: false });
    const dead = gpuLine({ ok: false, error: 'spawn nvidia-smi ENOENT' });
    expect(dead.alert).toBe(true);
    expect(dead.text).toContain('DRIVER NOT ANSWERING');
    expect(gpuLine(null)).toEqual({ text: 'GPU — NO READING', alert: false });
  });

  it('relightResultLines — who stands, how, and what next', () => {
    const lines = relightResultLines({
      spawned: [
        { name: 'serving-watchdog', via: 'spawn', pid: 41 },
        { name: 'swap-model', via: 'systemd', pid: null },
      ],
      detail: 'the daemons stand',
    });
    expect(lines).toEqual([
      'SERVING-WATCHDOG STANDS — VIA SPAWN · PID 41',
      'SWAP-MODEL STANDS — VIA SYSTEMD',
      'the daemons stand',
    ]);
    expect(relightResultLines(null)).toEqual([]);
  });
});

describe('BenchRelight — the recovery panel, rendered for real', () => {
  it('OVERVIEW carries the GPU row; serving-down mounts the relight panel', () => {
    const html = renderBody();
    expect(html).toContain('GPU — NVIDIA RTX PRO 6000 BLACKWELL WORKSTATION EDITION · 100% · 59331 MIB');
    expect(html).toContain('RELIGHT SERVING');
  });

  it('a dead driver swaps the panel for the «WARNING» truth — no button', () => {
    const html = renderBody({
      status: { ...STATUS, gpu: { ok: false, error: 'ENOENT' } },
    });
    expect(html).toContain('«WARNING» THE GPU DRIVER IS NOT ANSWERING');
    expect(html).toContain('Relight is pointless into a dead driver');
    expect(html).not.toContain('RELIGHT NOW');
  });

  it('the confirm step, the verbatim refusal, and the outcome rows', () => {
    const confirmed = renderToStaticMarkup(createElement(BenchRelight, {
      gpu: { ok: true, name: 'G', utilizationPercent: 1, memoryUsedMiB: 2 },
      models: RELIGHT.models, model: 'qwen3.8-27b', onModel: () => {},
      busy: false, refusal: null, outcome: null,
      confirm: true, onAsk: () => {}, onCancel: () => {}, onRelight: () => {},
    }));
    expect(confirmed).toContain('«WARNING» relight swaps the model on the serving endpoint');
    expect(confirmed).toContain('RELIGHT NOW');

    const refused = renderToStaticMarkup(createElement(BenchRelight, {
      gpu: { ok: true, name: 'G', utilizationPercent: 1, memoryUsedMiB: 2 },
      models: RELIGHT.models, model: 'qwen3.8-27b', onModel: () => {},
      busy: false, refusal: 'the serving watchdog already stands (pid 3297777) — relight is its office; wait for it or read logs/serving-incidents.jsonl',
      outcome: null, confirm: false, onAsk: () => {}, onCancel: () => {}, onRelight: () => {},
    }));
    expect(refused).toContain('the serving watchdog already stands (pid 3297777)');

    const stood = renderToStaticMarkup(createElement(BenchRelight, {
      gpu: { ok: true, name: 'G', utilizationPercent: 1, memoryUsedMiB: 2 },
      models: RELIGHT.models, model: 'qwen3.8-27b', onModel: () => {},
      busy: false, refusal: null,
      outcome: { spawned: [{ name: 'serving-watchdog', via: 'spawn', pid: 41 }], detail: 'the daemons stand' },
      confirm: false, onAsk: () => {}, onCancel: () => {}, onRelight: () => {},
    }));
    expect(stood).toContain('SERVING-WATCHDOG STANDS — VIA SPAWN · PID 41');
  });
});

describe('bench-view — the proof lines, pure', () => {
  it('proofStateLine — idle, running, done, failed', () => {
    expect(proofStateLine(null)).toContain('NO PROOF RUN YET');
    expect(proofStateLine({ state: 'running', done: 9, total: 43, section: 'arithmetic', itemId: 'gsm8k-08', passCount: 7 }))
      .toBe('RUNNING — 9/43 · ARITHMETIC · gsm8k-08 · 7 PASS SO FAR');
    expect(proofStateLine({ state: 'done', verdict: { pass: 42, total: 43 }, proofId: 'p-1' }))
      .toBe('DONE — 42/43 PASS · CERTIFICATE p-1');
    expect(proofStateLine({ state: 'failed', error: 'the endpoint died' })).toBe('FAILED — the endpoint died');
  });

  it('proofScoreLine — total with per-section accuracy', () => {
    expect(proofScoreLine({
      total: { pass: 42, total: 43 },
      sections: { arithmetic: { pass: 24, total: 25 }, instruction: { pass: 12, total: 12 }, format: { pass: 6, total: 6 } },
    })).toBe('42/43 PASS — arithmetic 24/25 · instruction 12/12 · format 6/6');
  });

  it('proofRow — the certificate list row', () => {
    const row = proofRow({ id: '2026-09-24T01-00-00-000Z-deadbeef', mtimeMs: NOW - 7200e3 }, NOW);
    expect(row).toEqual({ key: '2026-09-24T01-00-00-000Z-deadbeef', id: '2026-09-24T01-00-00-000Z-deadbeef', age: '2H 0M AGO' });
  });
});

describe('BenchProof — the panel, rendered for real', () => {
  const base = {
    status: {
      serving: { ok: true, models: ['qwen3.8-27b'] },
      gpu: { ok: true, name: 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition', utilizationPercent: 12, memoryUsedMiB: 59331 },
    },
    run: null, confirm: false, busy: false, refusal: null,
    onAsk: () => {}, onCancel: () => {}, onRun: () => {},
  };

  it('reads what is served, the suite contents, and offers the act', () => {
    const html = renderToStaticMarkup(createElement(BenchProof, base));
    expect(html).toContain('BENCHMARK THE LOADED MODEL');
    expect(html).toContain('SERVING — LIVE · 1 MODEL: qwen3.8-27b');
    expect(html).toContain('25 REAL GSM8K');
    expect(html).toContain('RUN THE PROOF SUITE');
    expect(html).toContain('NO PROOF RUN YET');
  });

  it('a dead endpoint disables the act and says so', () => {
    const html = renderToStaticMarkup(createElement(BenchProof, {
      ...base, status: { serving: { ok: false, error: 'ECONNREFUSED' }, gpu: { ok: false, error: 'ENOENT' } },
    }));
    expect(html).toContain('SERVING — DOWN');
    expect(html).toContain('DRIVER NOT ANSWERING');
    expect(html).toContain('disabled=""'); // the RUN button is genuinely disabled
  });

  it('the «NOTICE» confirm, live progress, the verdict, and a verbatim refusal', () => {
    const confirm = renderToStaticMarkup(createElement(BenchProof, { ...base, confirm: true }));
    expect(confirm).toContain('«NOTICE» the proof suite runs 43 items');
    const running = renderToStaticMarkup(createElement(BenchProof, {
      ...base, run: { state: 'running', done: 9, total: 43, section: 'arithmetic', itemId: 'gsm8k-08', passCount: 7 },
    }));
    expect(running).toContain('RUNNING — 9/43');
    const done = renderToStaticMarkup(createElement(BenchProof, {
      ...base, run: { state: 'done', verdict: { pass: 42, total: 43 }, proofId: 'p-1' },
    }));
    expect(done).toContain('DONE — 42/43 PASS');
    expect(done).toContain('REPORTS');
    const refused = renderToStaticMarkup(createElement(BenchProof, {
      ...base, refusal: 'no model answers at the serving endpoint — load a model first, then run the proof',
    }));
    expect(refused).toContain('load a model first');
  });
});

describe('BenchLibrary — a proof certificate, rendered for real', () => {
  const PROOF_ITEM = { kind: 'proof', id: '2026-09-24T01-00-00-000Z-deadbeef', mtimeMs: NOW - 3600e3, key: 'proof:x' };
  it('lists the certificate and renders it with its score line, exports, and SHARE THIS', () => {
    const html = renderToStaticMarkup(createElement(BenchLibrary, libraryProps({
      items: [PROOF_ITEM, BUNDLE_ITEM],
      selected: { kind: 'proof', id: PROOF_ITEM.id },
      proof: {
        receipt: { total: { pass: 42, total: 43 }, sections: { arithmetic: { pass: 24, total: 25 } } },
        certificate: '# NEUMA BENCH — PROOF CERTIFICATE\n\nverdict text',
        busy: false, onExportMd: () => {}, onExportPdf: () => {},
      },
    })));
    expect(html).toContain('PROOF CERTIFICATE');
    expect(html).toContain('42/43 PASS — arithmetic 24/25');
    expect(html).toContain('EXPORT — PDF');
    expect(html).toContain('SHARE THIS');
    expect(html).toContain('1 / 2');
  });

  it('the empty register reads honestly', () => {
    const html = renderToStaticMarkup(createElement(BenchLibrary, libraryProps()));
    expect(html).toContain('NOTHING HERE YET');
  });
});

