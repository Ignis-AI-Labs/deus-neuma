// bench-runs-view.js — the RUNS ledger's pure display law. The operator
// (2026-09-24): […]
//
// The formatters, the provenance panel, and the filter/order law live here;
// the ledger's shape (days, sets, the focus) is bench-ledger-view.js; the
// rail + focus (BenchRuns.jsx, BenchRunFocus.jsx) stay declarative; the IO is
// BenchApp.jsx's. bench-view.js does not grow — the run ledger has its own
// view-model (the 500-line law; decomposition-first).

import { relTime } from './bench-view.js';

/**
 * The score column from the run's primary metric: a ratio reads as a percent,
 * anything else reads raw with its unit, a missing metric reads '—'. Pure.
 * @param {{value: ?number, unit: ?string}|null} metric
 */
export const scoreText = (metric) => {
  if (!metric || !Number.isFinite(metric.value)) return '—';
  if (metric.unit === 'ratio') return `${(metric.value * 100).toFixed(1)}%`;
  return `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
};

/** pure — the duration column: 59S / 45M / 1.5 H, '—' when absent. */
export const durationText = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 60000) return `${Math.round(ms / 1000)}S`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}M`;
  const hours = ms / 3600000;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} H`;
};

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * The WHEN column: absolute local `MM-DD HH:MM` (the operator's rig reads its
 * own clock) with the relative age as secondary. '—' when the receipt carries
 * no timing. Pure — the clock is injected.
 * @param {?string} iso
 * @param {number} nowMs
 * @returns {{abs: string, rel: string}}
 */
export const whenText = (iso, nowMs) => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return { abs: '—', rel: '' };
  const d = new Date(ms);
  return {
    abs: `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    rel: relTime(ms, nowMs),
  };
};

/**
 * One hash row for the detail panel, or null when the receipt lacks it —
 * the panel never renders a hash that isn't there. Pure.
 */
export const hashRow = (label, hash) =>
  (typeof hash === 'string' && hash ? { label, value: hash } : null);

/** pure — the detail panel's hash block as copyable text (the COPY act). */
export const hashBlockText = (hashes) =>
  [
    ['PROTOCOL', hashes?.protocol],
    ['MODEL ARTIFACT', hashes?.model],
    ['TOKENIZER', hashes?.tokenizer],
    ['SAMPLE SELECTION', hashes?.samples],
  ].filter(([, v]) => typeof v === 'string' && v)
    .map(([label, v]) => `${label}  ${v}`)
    .join('\n');

/**
 * The focus's PROVENANCE — who, what, where, and the hashes that verify it
 * (what the run cost is the focus's instruments, not repeated here). Every
 * field null-honest. Pure.
 * @param {object} row the plane's run row (projectRunRow shape)
 */
export const runDetailView = (row) => ({
  lines: [
    { label: 'RUN', value: row.runId },
    { label: 'COMPARISON', value: row.comparisonId },
    { label: 'SUBJECT', value: [row.modelId, row.quantization].filter(Boolean).join(' · ') || null },
    { label: 'APPROVED', value: row.approvedBy || row.approvedAt
      ? `${row.approvedBy ?? '?'}${row.approvedAt ? ` AT ${row.approvedAt}` : ''}` : null },
    { label: 'ENVIRONMENT', value: row.environment
      ? [row.environment.gpu, row.environment.node].filter(Boolean).join(' · ') || null : null },
  ].filter((l) => l.value),
  hashes: [
    hashRow('PROTOCOL', row.hashes?.protocol),
    hashRow('MODEL ARTIFACT', row.hashes?.model),
    hashRow('TOKENIZER', row.hashes?.tokenizer),
    hashRow('SAMPLE SELECTION', row.hashes?.samples),
  ].filter(Boolean),
  copyText: hashBlockText(row.hashes),
});

export const RUN_STATUS_CHOICES = Object.freeze(['all', 'succeeded', 'failed', 'aborted', 'invalidated']);

/**
 * The run's standing, one word: an invalidated run (the harness struck it
 * after the fact — invalidation.json, read by the plane) is INVALIDATED,
 * never a success and never an ordinary failure; otherwise its own status.
 * Pure.
 */
export const runStatus = (row) => {
  if (row?.invalidation) return 'invalidated';
  const s = String(row?.status ?? '').toLowerCase();
  if (/succeed/.test(s)) return 'succeeded';
  if (/fail/.test(s)) return 'failed';
  if (/abort/.test(s)) return 'aborted';
  return 'other';
};
export const RUN_ORDERS = Object.freeze([
  Object.freeze({ id: 'newest', label: 'NEWEST' }),
  Object.freeze({ id: 'oldest', label: 'OLDEST' }),
]);

/** pure — the run's LOCAL calendar day (YYYY-MM-DD, the rig's own clock), or null. */
export const dayKey = (iso) => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/**
 * The filter law: text matches runId / comparisonId / benchmark (case
 * folded); status, arm, tier and day narrow; 'all' (or a null day) passes
 * everything. Pure.
 * @param {object[]} rows the plane's run rows
 * @param {{q?: string, status?: string, arm?: string, tier?: string, day?: ?string}} filters
 */
export const filterRuns = (rows, filters = {}) => {
  const q = (filters.q ?? '').trim().toLowerCase();
  return (rows ?? []).filter((row) => {
    if (filters.status && filters.status !== 'all' && runStatus(row) !== filters.status) return false;
    if (filters.arm && filters.arm !== 'all' && row.arm !== filters.arm) return false;
    if (filters.tier && filters.tier !== 'all' && row.suiteTier !== filters.tier) return false;
    if (filters.day && dayKey(row.startedAt) !== filters.day) return false;
    if (q) {
      const hay = `${row.runId ?? ''} ${row.comparisonId ?? ''} ${row.suiteId ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
};

/**
 * The order law: newest/oldest by startedAt — a missing stamp sorts last in
 * BOTH directions (an untimed run is never "newest" and never "oldest").
 * Pure — returns a new array.
 */
export const sortRuns = (rows, key = 'newest') => {
  const startedMs = (r) => {
    const ms = Date.parse(r.startedAt);
    return Number.isFinite(ms) ? ms : null;
  };
  const dir = key === 'oldest' ? 1 : -1;
  return [...(rows ?? [])].sort((a, b) => {
    const am = startedMs(a);
    const bm = startedMs(b);
    if (am === null || bm === null) return (am === null) - (bm === null);
    return (am - bm) * dir;
  });
};
