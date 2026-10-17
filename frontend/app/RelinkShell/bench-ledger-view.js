// bench-ledger-view.js — the RUNS ledger's SHAPE, PURE. The operator
// (2026-09-26): […] — the Atlas and
// Explorer's navigable read, over the run ledger.
//
//   THE BAND — the ledger in instruments (runs, how many landed, failed,
//     aborted, compute time, tokens) and a day strip: one stacked column per
//     day, clickable to narrow the rail to that day.
//   THE RAIL — the runs by day, then by matched set (one comparisonId = one
//     set launched together), each run one line: arm glyph, arm, score, status.
//   THE FOCUS — one run in depth: its score, what it cost, why it stopped
//     (when it did), its siblings in the same set, then its provenance.
//
// The formatters and the filter/order law are bench-runs-view.js's.

import { armName } from './bench-launch-view.js';
import { benchMeaning } from './bench-glossary.js';
import { EVERY_ARM } from './bench-atlas-view.js';
import { dayKey, durationText, runStatus, scoreText, whenText } from './bench-runs-view.js';

const DAY_MS = 86400000;
const armRank = (arm) => {
  const i = EVERY_ARM.indexOf(arm);
  return i < 0 ? EVERY_ARM.length : i;
};
const statusOf = runStatus;
const STATUS_MARK = Object.freeze({ succeeded: 'DONE', failed: 'FAILED', aborted: 'ABORTED', invalidated: 'INVALIDATED', other: '?' });
// The register each standing reads in: signal landed, alert failed, disabled
// for aborted and for a run struck from the record.
const STATUS_REGISTER = Object.freeze({ succeeded: 'live', failed: 'loud', aborted: 'dim', invalidated: 'dim', other: 'quiet' });
const EMPTY_COUNTS = () => ({ succeeded: 0, failed: 0, aborted: 0, invalidated: 0, other: 0 });

/** pure — a count in the ledger's compact register: 950 · 69.3K · 1.2M. */
export const compactCount = (n) => {
  if (!Number.isFinite(n)) return '—';
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`;
  return `${(n / 1e6).toFixed(1)}M`;
};

/** pure — a whole-number count with separators, '—' when unmeasured. */
const fullCount = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '—');

/**
 * THE BAND's instruments over every run on record. Pure.
 * @param {object[]} runs
 */
export const ledgerCounts = (runs) => {
  const all = runs ?? [];
  const by = EMPTY_COUNTS();
  let computeMs = 0;
  let tokens = 0;
  for (const r of all) {
    by[statusOf(r)] += 1;
    if (Number.isFinite(r.durationMs)) computeMs += r.durationMs;
    tokens += (r.tokens?.prompt ?? 0) + (r.tokens?.completion ?? 0);
  }
  return {
    total: all.length,
    ...by,
    landed: all.length ? `${Math.round((by.succeeded / all.length) * 100)}%` : '—',
    compute: durationText(computeMs),
    tokens: compactCount(tokens),
  };
};

/**
 * THE DAY STRIP — one column per calendar day from the first run on record
 * to the last (the newest `maxDays` of them), quiet days included so the gaps
 * read true. Each column's parts are fractions of the busiest day; the
 * column label is the day of the month, the span line names the months. Pure.
 * @param {object[]} runs
 * @param {number} [maxDays]
 */
export const dayStrip = (runs, maxDays = 28) => {
  const counts = new Map();
  for (const r of runs ?? []) {
    const day = dayKey(r.startedAt);
    if (!day) continue;
    const c = counts.get(day) ?? EMPTY_COUNTS();
    c[statusOf(r)] += 1;
    counts.set(day, c);
  }
  if (!counts.size) return { days: [], peak: 0, span: null };
  const keys = [...counts.keys()].sort();
  const noon = (key) => Date.parse(`${key}T12:00:00`);
  const last = noon(keys[keys.length - 1]);
  const first = Math.max(noon(keys[0]), last - (maxDays - 1) * DAY_MS);
  const days = [];
  for (let t = first; t <= last + DAY_MS / 2; t += DAY_MS) {
    const key = dayKey(new Date(t).toISOString());
    const c = counts.get(key) ?? EMPTY_COUNTS();
    days.push({ day: key, label: key.slice(8), total: c.succeeded + c.failed + c.aborted + c.invalidated + c.other, ...c });
  }
  const peak = Math.max(...days.map((d) => d.total));
  return {
    days: days.map((d) => ({ ...d, height: peak ? d.total / peak : 0 })),
    peak,
    span: `${days[0].day.slice(5)} → ${days[days.length - 1].day.slice(5)} · ${days.length} DAY${days.length === 1 ? '' : 'S'} · BUSIEST ${peak}`,
  };
};

/** pure — one run as a rail line. */
export const railRun = (row) => {
  const status = statusOf(row);
  return {
    key: row.runId,
    arm: row.arm ?? 'unknown',
    name: row.arm ? armName(row.arm) : '?',
    score: status === 'invalidated' ? '—' : scoreText(row.primaryMetric), // a struck score is never shown as a reading
    status,
    mark: STATUS_MARK[status],
    register: STATUS_REGISTER[status],
    retry: Number.isInteger(row.attempt) && row.attempt > 1 ? `A${row.attempt}` : null,
  };
};

/**
 * THE RAIL's shape: the rows (already filtered and ordered) folded into days,
 * each day into its matched sets in first-seen order, each set's runs in the
 * ladder order (bare → full being, retries after). A run without a
 * comparison stands as a set of one. Pure.
 * @param {object[]} rows
 * @param {number} nowMs
 */
export const ledgerGroups = (rows, nowMs) => {
  const days = [];
  const today = dayKey(new Date(nowMs).toISOString());
  const yesterday = dayKey(new Date(nowMs - DAY_MS).toISOString());
  for (const row of rows ?? []) {
    const day = dayKey(row.startedAt) ?? 'undated';
    let d = days.find((x) => x.day === day);
    if (!d) {
      const name = day === today ? 'TODAY' : day === yesterday ? 'YESTERDAY' : null;
      d = { day, label: day === 'undated' ? 'UNDATED' : [name, day].filter(Boolean).join(' · '), sets: [], count: 0 };
      days.push(d);
    }
    const setId = row.comparisonId ?? row.runId;
    let set = d.sets.find((x) => x.id === setId);
    if (!set) {
      set = { id: setId, suiteId: row.suiteId ?? '—', tier: row.suiteTier ? row.suiteTier.toUpperCase() : null, time: whenText(row.startedAt, nowMs).abs.slice(6), runs: [] };
      d.sets.push(set);
    }
    set.runs.push(row);
    d.count += 1;
  }
  for (const d of days) {
    for (const set of d.sets) {
      set.runs.sort((a, b) => armRank(a.arm) - armRank(b.arm) || (a.attempt ?? 0) - (b.attempt ?? 0));
      set.lines = set.runs.map(railRun);
    }
  }
  return days;
};

/** pure — the rail's reading order (↑/↓ walk it), as run ids. */
export const ledgerOrder = (days) => days.flatMap((d) => d.sets.flatMap((s) => s.lines.map((l) => l.key)));

/**
 * THE FOCUS — one run in depth. `runs` is the WHOLE ledger (not the filtered
 * rows), so a sibling filtered out of the rail still stands in the set. Pure —
 * the clock is injected.
 * @param {object} row
 * @param {object[]} runs
 * @param {number} nowMs
 */
export const runFocus = (row, runs, nowMs) => {
  const status = statusOf(row);
  const started = whenText(row.startedAt, nowMs);
  const finished = whenText(row.finishedAt, nowMs);
  const siblings = row.comparisonId
    ? (runs ?? []).filter((r) => r.comparisonId === row.comparisonId)
      .sort((a, b) => armRank(a.arm) - armRank(b.arm) || (a.attempt ?? 0) - (b.attempt ?? 0))
    : [row];
  const bare = siblings.find((r) => r.arm === 'bare' && statusOf(r) === 'succeeded' && Number.isFinite(r.primaryMetric?.value));
  const mine = row.primaryMetric?.value;
  const delta = bare && row.arm !== 'bare' && Number.isFinite(mine) && row.primaryMetric?.unit === 'ratio'
    ? Math.round((mine - bare.primaryMetric.value) * 1000) / 10
    : null;
  const vsBare = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 && row.arm !== 'bare' ? `×${(a / b).toFixed(a / b >= 10 ? 0 : 1)} BARE` : null);
  return {
    suiteId: row.suiteId ?? '—',
    tier: row.suiteTier ? row.suiteTier.toUpperCase() : null,
    meaning: benchMeaning(row.suiteId),
    arm: row.arm ?? 'unknown',
    armName: row.arm ? armName(row.arm) : 'UNKNOWN ARM',
    status,
    mark: STATUS_MARK[status],
    register: STATUS_REGISTER[status],
    score: status === 'invalidated' ? '—' : scoreText(row.primaryMetric), // a struck score is never shown as a reading
    metricId: row.primaryMetric?.id ?? null,
    delta: delta === null ? null : `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta).toFixed(1)} PTS VS BARE`,
    deltaSign: delta === null ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'even',
    instruments: [
      { label: 'STARTED', value: started.abs, sub: started.rel || null },
      { label: 'FINISHED', value: finished.abs, sub: null },
      { label: 'DURATION', value: durationText(row.durationMs), sub: vsBare(row.durationMs, bare?.durationMs) },
      { label: 'ATTEMPT', value: row.attempt ?? '—', sub: null },
      { label: 'PROMPT TOKENS', value: fullCount(row.efficiency?.promptTokens ?? row.tokens?.prompt), sub: vsBare(row.tokens?.prompt, bare?.tokens?.prompt) },
      { label: 'COMPLETION', value: fullCount(row.efficiency?.completionTokens ?? row.tokens?.completion), sub: null },
      { label: 'REQUESTS', value: fullCount(row.efficiency?.requests), sub: null },
      { label: 'TOOL CALLS', value: fullCount(row.efficiency?.toolCalls), sub: null },
    ],
    failure: row.failure && status !== 'succeeded'
      ? { stage: row.failure.stage ?? null, code: row.failure.code ?? null, message: row.failure.message ?? null }
      : null,
    // A struck run says who struck it, when, and what it had read before.
    invalidation: row.invalidation
      ? { by: row.invalidation.by ?? null, at: row.invalidation.at ?? null, was: [row.originalStatus ? String(row.originalStatus).toUpperCase() : null, row.primaryMetric ? scoreText(row.primaryMetric) : null].filter(Boolean).join(' ') || null }
      : null,
    siblings: siblings.map((r) => ({ ...railRun(r), current: r.runId === row.runId })),
  };
};
