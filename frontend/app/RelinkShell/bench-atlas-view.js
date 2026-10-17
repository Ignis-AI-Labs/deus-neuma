// bench-atlas-view.js — THE ATLAS's display law, PURE. The operator
// (2026-09-26): […]
//
// One row per benchmark taken; each row is the comparison it stands on (the
// newest matched set, or the strongest evidence), its arms as points on one
// 0–100% line. Above the rows, the INFLUENCE: what each layer of the
// architecture does to the model, benchmark by benchmark — the mean change
// in points against the bare model, how often it wins, and what it costs in
// prompt tokens and time. Only paired comparisons count (the same questions,
// the same set): a layer is never judged against a bare run it did not share
// questions with.

import { armName } from './bench-launch-view.js';
import { benchMeaning } from './bench-glossary.js';

// THE THREE CORE ARMS (Design note, 2026-09-29/10-01: […]). The diagnostic arms (PLATFORM WIRE, SILO) never plot here;
// they live in RUNS and REPORTS for debugging one layer.
export const ATLAS_ARMS = Object.freeze(['bare', 'harness', 'neuma']);
// Every arm, in ladder order: RUNS, REPORTS and the ledger show the diagnostic arms too.
export const EVERY_ARM = Object.freeze(['bare', 'platform', 'harness', 'silo', 'neuma']);
// The headline layers against BARE: the harness (the platform) and the full being.
export const LAYER_ARMS = Object.freeze(['harness', 'neuma']);
export const ATLAS_MODES = Object.freeze([
  Object.freeze({ id: 'latest', label: 'LATEST SET' }),
  Object.freeze({ id: 'strongest', label: 'STRONGEST EVIDENCE' }),
]);
const TIER_ORDER = ['t0', 't1', 't2', 't3'];

const pct = (v) => `${Math.round(v * 1000) / 10}%`;
/** pure — a change in points, signed, one decimal: "+31.0" / "−4.0" / "±0.0". */
export const pointsText = (d) => {
  if (!Number.isFinite(d)) return '—';
  const v = Math.round(d * 1000) / 10;
  if (v === 0) return '±0.0';
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
};

/**
 * The series a row stands on: the newest matched set ('latest', what the
 * operator just ran) or the harness's strongest comparison ('strongest' —
 * more arms, more questions). Pure.
 */
export const seriesFor = (suite, mode = 'latest') => {
  const all = suite?.series ?? [];
  if (!all.length) return null;
  if (mode === 'strongest') return all[0];
  return [...all].sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))[0];
};

/**
 * THE ROWS — one per benchmark taken, grouped by tier (T0→T3, then any
 * other), newest-run order within a tier kept stable by suite id. Pure.
 * @param {{suites?: Array}} summary the /summary answer
 * @param {'latest'|'strongest'} mode
 * @param {?string} tier only this tier ('all' / null for every tier)
 */
export const atlasRows = (summary, mode = 'latest', tier = null) => (summary?.suites ?? [])
  .map((suite) => {
    const series = seriesFor(suite, mode);
    if (!series) return null;
    const points = ATLAS_ARMS
      .map((arm) => series.arms.find((a) => a.arm === arm))
      .filter((a) => a && typeof a.value === 'number')
      .map((a) => ({ arm: a.arm, name: armName(a.arm), value: a.value, display: pct(a.value) }));
    const bare = points.find((p) => p.arm === 'bare') ?? null;
    const values = points.map((p) => p.value);
    const best = points.reduce((b, p) => (!b || p.value > b.value ? p : b), null);
    return {
      suiteId: suite.suiteId,
      tier: suite.tier ?? null,
      meaning: benchMeaning(suite.suiteId),
      seriesId: series.id,
      n: series.n ?? null,
      finishedAt: series.finishedAt ?? null,
      sets: suite.series.length,
      points,
      low: values.length ? Math.min(...values) : null,
      high: values.length ? Math.max(...values) : null,
      best,
      bestDelta: best && bare && best.arm !== 'bare' ? pointsText(best.value - bare.value) : null,
      series,
    };
  })
  .filter(Boolean)
  .filter((r) => !tier || tier === 'all' || r.tier === tier)
  .sort((a, b) => {
    const ta = TIER_ORDER.indexOf(a.tier);
    const tb = TIER_ORDER.indexOf(b.tier);
    return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb) || a.suiteId.localeCompare(b.suiteId);
  });

/** pure — the tiers present among the rows, T0→T3 order, with counts. */
export const atlasTiers = (summary, mode = 'latest') => {
  const counts = new Map();
  for (const r of atlasRows(summary, mode)) counts.set(r.tier, (counts.get(r.tier) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b))
    .map(([tier, count]) => ({ tier, label: String(tier ?? '—').toUpperCase(), count }));
};

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * THE INFLUENCE — per headline layer (HARNESS, FULL BEING): for every
 * benchmark (T0 smoke excluded — it proves the road, never the model), the
 * NEWEST comparison in which that layer and the bare model answered the same
 * questions together; across them, the mean change in points, wins / losses
 * / ties (a tie is within half a point), and the median cost against bare
 * (prompt tokens, time) where the receipts measured it. Independent of the
 * rows' mode: a layer is only ever judged against the bare run it shared
 * questions with. Pure.
 * @param {{suites?: Array}} summary
 */
// A score is a rate in 0–1. One reported outside it (SciCode's bare arm sealed
// "20" for 20%, 2026-10-15) read as a 2,000-point loss and flipped the whole
// mean from +5.0 to −35.1 — such a pair is left out, and named, never averaged.
const isRate = (v) => typeof v === 'number' && v >= 0 && v <= 1;

export const influence = (summary) => LAYER_ARMS.map((arm) => {
  const found = (summary?.suites ?? [])
    .filter((suite) => suite.tier !== 't0')
    .map((suite) => [...suite.series]
      .sort((x, y) => String(y.finishedAt).localeCompare(String(x.finishedAt)))
      .map((series) => ({
        suiteId: suite.suiteId,
        bare: series.arms.find((a) => a.arm === 'bare'),
        layer: series.arms.find((a) => a.arm === arm),
      }))
      .find((p) => typeof p.bare?.value === 'number' && typeof p.layer?.value === 'number'))
    .filter(Boolean);
  const pairs = found.filter((p) => isRate(p.bare.value) && isRate(p.layer.value));
  const deltas = pairs.map((p) => p.layer.value - p.bare.value);
  const ratio = (key) => median(pairs
    .filter((p) => p.bare[key] > 0 && p.layer[key] > 0)
    .map((p) => p.layer[key] / p.bare[key]));
  const mean = deltas.length ? deltas.reduce((t, d) => t + d, 0) / deltas.length : null;
  return {
    arm,
    name: armName(arm),
    count: pairs.length,
    mean,
    meanText: mean === null ? '—' : pointsText(mean),
    // the reading in words — a sign alone never says which way is good
    verdict: mean === null ? null : mean > 0.005 ? 'better than' : mean < -0.005 ? 'worse than' : 'level with',
    excluded: found.filter((p) => !pairs.includes(p)).map((p) => p.suiteId),
    wins: deltas.filter((d) => d > 0.005).length,
    losses: deltas.filter((d) => d < -0.005).length,
    ties: deltas.filter((d) => Math.abs(d) <= 0.005).length,
    tokenRatio: ratio('promptTokens'),
    timeRatio: ratio('durationMs'),
  };
});

/** pure — a cost ratio as the card prints it: "×10.5 prompt tokens". */
export const ratioText = (r, what) => (Number.isFinite(r) ? `×${r >= 10 ? Math.round(r) : r.toFixed(1)} ${what}` : null);

/** pure — the keyboard's walk over the rows: ↑/↓ by one, Home/End to the ends. */
export const stepRow = (rows, currentId, key) => {
  if (!rows.length) return null;
  const at = rows.findIndex((r) => r.suiteId === currentId);
  if (key === 'Home') return rows[0].suiteId;
  if (key === 'End') return rows[rows.length - 1].suiteId;
  if (key === 'ArrowDown') return rows[Math.min(rows.length - 1, at + 1)].suiteId;
  if (key === 'ArrowUp') return rows[Math.max(0, at < 0 ? 0 : at - 1)].suiteId;
  return currentId;
};

/** pure — the focused row's one-line reading under the chart. */
export const rowReading = (row) => {
  if (!row) return null;
  const parts = row.points.map((p) => `${p.name.toLowerCase()} ${p.display}`);
  return `${row.suiteId.toUpperCase()} · ${parts.join(' · ')}${row.bestDelta ? ` · best ${row.bestDelta} pts vs bare` : ''}${row.n ? ` · n=${row.n}` : ''}`;
};
