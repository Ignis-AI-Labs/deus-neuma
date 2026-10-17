// bench-runs-view.test.js — the RUNS ledger's display law, proven pure
// (RULE 0) against the REAL W5 receipt (test/fixtures/bench/receipt-w5.json —
// a run that really happened on this rig), projected by the backend's own
// projectRunRow, plus the edge shapes (missing timing, missing metrics,
// aborted and failed rows) an older receipt degenerates to.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  scoreText, durationText, whenText, hashRow, hashBlockText,
  runDetailView, filterRuns, sortRuns, dayKey, runStatus, RUN_STATUS_CHOICES, RUN_ORDERS,
} from '../../frontend/app/RelinkShell/bench-runs-view.js';
import {
  compactCount, ledgerCounts, dayStrip, railRun, ledgerGroups, ledgerOrder, runFocus,
} from '../../frontend/app/RelinkShell/bench-ledger-view.js';
import { projectRunRow, listRuns } from '../../backend/services/bench/bench-reports.js';

const RECEIPT = JSON.parse(readFileSync(path.resolve('test/fixtures/bench/receipt-w5.json'), 'utf8'));
const ROW = projectRunRow(RECEIPT, RECEIPT.runId);
const NOW = Date.parse('2026-09-24T12:00:00.000Z');

describe('the backend row projection over the REAL W5 receipt', () => {
  it('every v2 field lands', () => {
    expect(ROW.runId).toBe('bench-plane-w5-bare-a1-20260923090627544');
    expect(ROW.comparisonId).toBe('bench-plane-w5');
    expect(ROW.suiteId).toBe('smoke');
    expect(ROW.suiteTier).toBe('t0');
    expect(ROW.startedAt).toBe('2026-09-23T09:06:27.544Z');
    expect(ROW.durationMs).toBe(58993);
    expect(ROW.primaryMetric).toEqual({ id: 'gsm8k/exact_match,strict-match', value: 0.8, unit: 'ratio' });
    expect(ROW.tokens).toEqual({ prompt: 6600, completion: 743 });
    expect(ROW.hashes.protocol).toBe('7c2815d8aaea9125ebbde65a8bffc8d61b9c71b7b591b65422932aa3dbe1c369');
    expect(ROW.hashes.model).toBe('4e7735df4d1e2ec721f2551f531b815702a2f89123238c564797eda4b0304bc2');
    expect(ROW.hashes.tokenizer).toBe('ab8f94ace68ab0d83e8ecd9e867ed6cf47a22073307efff45ab9f020d1b85de5');
    expect(ROW.hashes.samples).toBe('a8bc48fa8d083d8ec4d59c6b09de23e011f2157087232e3eba9223c932c9aba7');
    expect(ROW.modelId).toBe('Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf');
    expect(ROW.quantization).toBe('Q8_K_P');
    expect(ROW.environment.gpu).toContain('NVIDIA RTX PRO 6000');
    expect(ROW.environment.node).toBe('v24.13.1');
    expect(ROW.approvedBy).toBe('0x0b8aa7ee9b16e5f4cdb366f2e7096a9c01ae69b5');
    expect(ROW.approvedAt).toBe('2026-09-23T09:06:27.515Z');
    expect(ROW.efficiency).toEqual({ promptTokens: 6600, completionTokens: 743, requests: 5, toolCalls: 0 });
  });

  it('a sparse receipt reads null-honest — nothing invented', () => {
    const row = projectRunRow({ runId: 'old-run', status: 'succeeded' }, 'old-run');
    expect(row.suiteId).toBeNull();
    expect(row.startedAt).toBeNull();
    expect(row.primaryMetric).toBeNull();
    expect(row.tokens).toBeNull();
    expect(row.hashes).toEqual({ protocol: null, model: null, tokenizer: null, samples: null });
    expect(row.modelId).toBeNull();
    expect(row.environment).toBeNull();
    expect(row.approvedBy).toBeNull();
    expect(row.metricCount).toBe(0);
  });
});

describe('the column formatters, pure', () => {
  it('scoreText — ratio to percent, raw+unit, missing', () => {
    expect(scoreText({ value: 0.8, unit: 'ratio' })).toBe('80.0%');
    expect(scoreText({ value: 1, unit: 'ratio' })).toBe('100.0%');
    expect(scoreText({ value: 0, unit: 'ratio' })).toBe('0.0%');
    expect(scoreText({ value: 12.5, unit: 's' })).toBe('12.5 s');
    expect(scoreText(null)).toBe('—');
    expect(scoreText({ value: null, unit: 'ratio' })).toBe('—');
  });

  it('durationText — seconds, minutes, hours, missing', () => {
    expect(durationText(58993)).toBe('59S');
    expect(durationText(2700000)).toBe('45M');
    expect(durationText(5400000)).toBe('1.5 H');
    expect(durationText(7200000)).toBe('2 H');
    expect(durationText(null)).toBe('—');
  });

  it('whenText — absolute MM-DD HH:MM plus relative, missing reads honest', () => {
    const when = whenText(RECEIPT.timing.startedAt, NOW);
    expect(when.abs).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    // The absolute stamp is the receipt's own instant in the box's clock.
    const d = new Date(RECEIPT.timing.startedAt);
    const pad = (n) => String(n).padStart(2, '0');
    expect(when.abs).toBe(`${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
    expect(when.rel).toContain('AGO');
    expect(whenText(null, NOW)).toEqual({ abs: '—', rel: '' });
  });

  it('runStatus — an invalidated run is INVALIDATED, never a success or an ordinary failure', () => {
    expect(runStatus({ status: 'succeeded' })).toBe('succeeded');
    expect(runStatus({ status: 'failed' })).toBe('failed');
    expect(runStatus({ status: 'aborted' })).toBe('aborted');
    expect(runStatus({ status: 'endpoint-unavailable' })).toBe('other');
    expect(runStatus({ status: 'failed', originalStatus: 'succeeded', invalidation: { reason: 'r' } })).toBe('invalidated');
  });
});

describe('the detail panel + the hash block', () => {
  it('the real receipt: lines, all four hashes, copyable block', () => {
    const detail = runDetailView(ROW);
    const labels = detail.lines.map((l) => l.label);
    expect(labels).toEqual(['RUN', 'COMPARISON', 'SUBJECT', 'APPROVED', 'ENVIRONMENT']);
    expect(detail.lines.find((l) => l.label === 'SUBJECT').value).toContain('Q8_K_P');
    expect(detail.hashes.map((h) => h.label)).toEqual(['PROTOCOL', 'MODEL ARTIFACT', 'TOKENIZER', 'SAMPLE SELECTION']);
    expect(detail.copyText).toContain('4e7735df4d1e2ec721f2551f531b815702a2f89123238c564797eda4b0304bc2');
    expect(detail.copyText.split('\n').length).toBe(4);
  });

  it('missing hashes render nothing, never a placeholder', () => {
    expect(hashRow('PROTOCOL', null)).toBeNull();
    expect(hashRow('PROTOCOL', 'abc')).toEqual({ label: 'PROTOCOL', value: 'abc' });
    expect(hashBlockText({ protocol: 'p', model: null })).toBe('PROTOCOL  p');
    const detail = runDetailView(projectRunRow({ runId: 'x', status: 'succeeded' }, 'x'));
    expect(detail.hashes).toEqual([]);
    expect(detail.copyText).toBe('');
    expect(detail.lines.map((l) => l.label)).toEqual(['RUN']);
  });
});

describe('filterRuns / sortRuns', () => {
  const rows = [
    { runId: 'night-a-neuma-a1-20260920000000000', comparisonId: 'night-a', arm: 'neuma', status: 'succeeded', suiteId: 'gsm8k', suiteTier: 't1', startedAt: '2026-09-20T00:00:00Z', durationMs: 2700000, primaryMetric: { value: 0.96, unit: 'ratio' } },
    { runId: 'night-b-bare-a1-20260921000000000', comparisonId: 'night-b', arm: 'bare', status: 'failed', suiteId: 'smoke', suiteTier: 't0', startedAt: '2026-09-21T00:00:00Z', durationMs: 59000, primaryMetric: null },
    { runId: 'w5-bare', comparisonId: 'bench-plane-w5', arm: 'bare', status: 'succeeded', suiteId: 'smoke', suiteTier: 't0', startedAt: '2026-09-23T09:06:27Z', durationMs: 58993, primaryMetric: { value: 0.8, unit: 'ratio' } },
    { runId: 'untimed', comparisonId: 'x', arm: 'silo', status: 'aborted', suiteId: 'ifeval', startedAt: null, durationMs: null, primaryMetric: null },
  ];

  it('text search folds case across runId / comparisonId / benchmark', () => {
    expect(filterRuns(rows, { q: 'W5' }).map((r) => r.runId)).toEqual(['w5-bare']);
    expect(filterRuns(rows, { q: 'night' }).length).toBe(2);
    expect(filterRuns(rows, { q: 'ifeval' }).map((r) => r.runId)).toEqual(['untimed']);
    expect(filterRuns(rows, { q: '' }).length).toBe(4);
  });

  it('status / arm / tier / day narrow; all (and a null day) passes', () => {
    expect(filterRuns(rows, { status: 'failed' }).map((r) => r.runId)).toEqual(['night-b-bare-a1-20260921000000000']);
    expect(filterRuns(rows, { status: 'aborted' }).map((r) => r.runId)).toEqual(['untimed']);
    expect(filterRuns(rows, { arm: 'bare' }).length).toBe(2);
    expect(filterRuns(rows, { tier: 't0' }).length).toBe(2);
    expect(filterRuns(rows, { day: dayKey('2026-09-23T09:06:27Z') }).map((r) => r.runId)).toEqual(['w5-bare']);
    expect(filterRuns(rows, { status: 'all', arm: 'all', tier: 'all', day: null }).length).toBe(4);
    expect(filterRuns(rows, { status: 'failed', arm: 'bare' }).length).toBe(1);
    expect(RUN_STATUS_CHOICES).toEqual(['all', 'succeeded', 'failed', 'aborted', 'invalidated']);
  });

  it('orders newest/oldest by stamp, an untimed run last both ways', () => {
    expect(sortRuns(rows, 'newest').map((r) => r.runId)).toEqual(['w5-bare', 'night-b-bare-a1-20260921000000000', 'night-a-neuma-a1-20260920000000000', 'untimed']);
    expect(sortRuns(rows, 'oldest').map((r) => r.runId)).toEqual(['night-a-neuma-a1-20260920000000000', 'night-b-bare-a1-20260921000000000', 'w5-bare', 'untimed']);
    expect(RUN_ORDERS.map((o) => o.id)).toEqual(['newest', 'oldest']);
  });

  it('dayKey reads the local calendar day, null when untimed', () => {
    const d = new Date('2026-09-23T09:06:27Z');
    expect(dayKey('2026-09-23T09:06:27Z')).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    expect(dayKey(null)).toBeNull();
  });
});

// THE LEDGER'S SHAPE over the REAL receipts committed under
// test/fixtures/bench/runs (a 4-arm GSM8K set, a failed heartbeat, singles),
// read by the backend's own listRuns — nothing hand-built.
const RUNS = await listRuns(path.resolve('test/fixtures/bench'));

describe('the ledger shape over the real fixture runs', () => {
  const SET = 'night-20260915t150502z-gsm100-4arm';
  const NOW_L = Date.parse('2026-09-22T12:00:00.000Z');

  it('the fixture ledger is what we think it is', () => {
    expect(RUNS.length).toBe(8);
    expect(RUNS.filter((r) => r.comparisonId === SET).length).toBe(4);
  });

  it('ledgerCounts — totals, landed share, compute, compact tokens', () => {
    const c = ledgerCounts(RUNS);
    expect(c.total).toBe(8);
    expect(c.succeeded).toBe(7);
    expect(c.failed).toBe(1);
    expect(c.aborted).toBe(0);
    expect(c.landed).toBe('88%');
    expect(c.compute).not.toBe('—');
    expect(compactCount(950)).toBe('950');
    expect(compactCount(69319)).toBe('69K');
    expect(compactCount(6600)).toBe('6.6K');
    expect(compactCount(1234567)).toBe('1.2M');
    expect(compactCount(null)).toBe('—');
    expect(ledgerCounts([]).landed).toBe('—');
  });

  it('dayStrip — one column per day first→last, quiet days kept, heights against the busiest', () => {
    const { days, peak } = dayStrip(RUNS);
    expect(days[0].day).toBe(dayKey('2026-09-12T16:08:44.407Z'));
    expect(days[days.length - 1].day).toBe(dayKey('2026-09-21T03:21:01.811Z'));
    expect(days.reduce((n, d) => n + d.total, 0)).toBe(8);
    expect(days.some((d) => d.total === 0)).toBe(true); // the quiet days read true
    expect(peak).toBe(Math.max(...days.map((d) => d.total)));
    expect(peak).toBeGreaterThanOrEqual(4); // the 4-arm set's day (local clock may fold a neighbour in)
    expect(Math.max(...days.map((d) => d.height))).toBe(1);
    expect(days.find((d) => d.failed).failed).toBe(1);
    expect(dayStrip(RUNS, 3).days.length).toBe(3); // the newest window only
    expect(dayStrip(RUNS).span).toMatch(/^09-12 → 09-2[12] · \d+ DAYS · BUSIEST \d+$/);
    expect(dayStrip([])).toEqual({ days: [], peak: 0, span: null });
  });

  it('ledgerGroups — days, then matched sets, runs in ladder order', () => {
    const days = ledgerGroups(sortRuns(RUNS, 'newest'), NOW_L);
    const set = days.flatMap((d) => d.sets).find((s) => s.id === SET);
    expect(set.lines.map((l) => l.arm)).toEqual(['bare', 'platform', 'silo', 'neuma']);
    expect(set.suiteId).toBe('gsm8k-2568');
    expect(set.tier).toBeTruthy();
    expect(days.reduce((n, d) => n + d.count, 0)).toBe(8);
    expect(ledgerOrder(days).length).toBe(8);
    expect(ledgerOrder(days)[0]).toBe('night-20260921t031900z-heartbeat-neuma-a1-20260921032101811');
    const failed = railRun(RUNS.find((r) => r.status === 'failed'));
    expect(failed.mark).toBe('FAILED');
    expect(failed.register).toBe('loud');
  });

  it('ledgerGroups names today and yesterday', () => {
    const run = RUNS.find((r) => r.comparisonId === 'night-20260921t031900z-heartbeat');
    const at = Date.parse(run.startedAt);
    expect(ledgerGroups([run], at)[0].label.startsWith('TODAY · ')).toBe(true);
    expect(ledgerGroups([run], at + 86400000)[0].label.startsWith('YESTERDAY · ')).toBe(true);
  });

  it('runFocus — the full being in its set: change vs bare, cost multiples, siblings', () => {
    const neuma = RUNS.find((r) => r.comparisonId === SET && r.arm === 'neuma');
    const bare = RUNS.find((r) => r.comparisonId === SET && r.arm === 'bare');
    const f = runFocus(neuma, RUNS, NOW_L);
    expect(f.armName).toBe('FULL BEING');
    expect(f.status).toBe('succeeded');
    const pts = Math.round((neuma.primaryMetric.value - bare.primaryMetric.value) * 1000) / 10;
    expect(f.delta).toContain(`${Math.abs(pts).toFixed(1)} PTS VS BARE`);
    expect(f.siblings.map((s) => s.arm)).toEqual(['bare', 'platform', 'silo', 'neuma']);
    expect(f.siblings.filter((s) => s.current).map((s) => s.arm)).toEqual(['neuma']);
    expect(f.instruments.map((i) => i.label)).toEqual(['STARTED', 'FINISHED', 'DURATION', 'ATTEMPT', 'PROMPT TOKENS', 'COMPLETION', 'REQUESTS', 'TOOL CALLS']);
    expect(f.instruments.find((i) => i.label === 'DURATION').sub).toMatch(/^×[\d.]+ BARE$/);
    expect(f.failure).toBeNull();
    const b = runFocus(bare, RUNS, NOW_L);
    expect(b.delta).toBeNull(); // bare is the floor, never measured against itself
    expect(b.instruments.find((i) => i.label === 'DURATION').sub).toBeNull();
  });

  it('runFocus — a failed run says why it stopped, verbatim', () => {
    const row = RUNS.find((r) => r.status === 'failed');
    const f = runFocus(row, RUNS, NOW_L);
    expect(f.register).toBe('loud');
    expect(f.failure.stage).toBe('lm-eval');
    expect(f.failure.code).toBe('BENCHMARK_PROCESS_FAILED');
    expect(f.failure.message).toBe(row.failure.message);
    expect(f.siblings.length).toBe(1);
  });
});
