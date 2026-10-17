// bench-explorer-view.js — REPORTS' EXPLORER display law, PURE. The
// operator (2026-09-26): […]
//
// A searchable list on the left (every benchmark taken, by tier), the
// selected benchmark's depth on the right: its comparisons to step through,
// the chart, a stats table per arm (score, change against bare, every
// metric, time, tokens, requests, tool calls) and each arm's history.

import { armName } from './bench-launch-view.js';
import { benchMeaning, variantLine } from './bench-glossary.js';
import { pointsText, EVERY_ARM } from './bench-atlas-view.js';

const TIER_ORDER = ['t0', 't1', 't2', 't3'];
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 1000) / 10}%` : '—');

/**
 * The list: every suite taken, matching the query (id, meaning, or label)
 * and the tier, in tier order then id. Each row carries a four-dot preview
 * of its newest comparison. Pure.
 */
export const explorerList = (summary, query = '', tier = 'all') => {
  const q = String(query).trim().toLowerCase();
  return (summary?.suites ?? [])
    .filter((s) => tier === 'all' || s.tier === tier)
    .filter((s) => !q || [s.suiteId, s.label, benchMeaning(s.suiteId)].some((t) => String(t ?? '').toLowerCase().includes(q)))
    .map((s) => {
      const newest = [...s.series].sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))[0];
      return {
        suiteId: s.suiteId,
        tier: s.tier ?? null,
        sets: s.series.length,
        finishedAt: newest?.finishedAt ?? null,
        dots: EVERY_ARM.map((arm) => {
          const a = newest?.arms.find((x) => x.arm === arm);
          return { arm, value: typeof a?.value === 'number' ? a.value : null };
        }),
      };
    })
    .sort((a, b) => {
      const ta = TIER_ORDER.indexOf(a.tier);
      const tb = TIER_ORDER.indexOf(b.tier);
      return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb) || a.suiteId.localeCompare(b.suiteId);
    });
};

/**
 * A suite's comparisons, newest first, each as a chip the navigator steps
 * through: date, question count, which arms stand in it. Pure.
 */
export const setChips = (suite) => [...(suite?.series ?? [])]
  .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))
  .map((x) => ({
    id: x.id,
    date: String(x.finishedAt ?? '').slice(0, 10) || '—',
    n: x.n ?? null,
    arms: x.arms.map((a) => a.label),
    line: `${String(x.finishedAt ?? '').slice(0, 10) || '—'} · n=${x.n ?? '?'} · ${x.arms.length} arm${x.arms.length === 1 ? '' : 's'}`,
    series: x,
  }));

const secs = (ms) => {
  if (!Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};
const count = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US') : '—');
const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? `×${(a / b).toFixed(a / b >= 10 ? 0 : 1)}` : null);

/**
 * THE STATS — one row per arm of the selected comparison, ladder order:
 * the score and its change against bare, then what the run cost and did
 * (time, prompt/completion tokens, requests, tool calls — each also as a
 * multiple of bare's where both were measured), every metric it scored, and
 * its run id for the ledger. Pure.
 */
export const armStats = (series) => {
  const arms = EVERY_ARM.map((arm) => series?.arms.find((a) => a.arm === arm)).filter(Boolean);
  const bare = arms.find((a) => a.arm === 'bare');
  return arms.map((a) => ({
    arm: a.arm,
    name: armName(a.arm),
    score: pct(a.value),
    value: a.value,
    delta: bare && a.arm !== 'bare' && typeof a.value === 'number' ? pointsText(a.value - bare.value) : null,
    time: secs(a.durationMs),
    timeVsBare: a.arm !== 'bare' ? ratio(a.durationMs, bare?.durationMs) : null,
    prompt: count(a.promptTokens),
    promptVsBare: a.arm !== 'bare' ? ratio(a.promptTokens, bare?.promptTokens) : null,
    completion: count(a.completionTokens),
    requests: count(a.requests),
    toolCalls: count(a.toolCalls),
    identity: a.identityPinned === true,
    metrics: (a.metrics ?? []).map((m) => ({ id: m.id, value: m.unit === 'ratio' ? pct(m.value) : String(m.value), primary: m.primary })),
    runId: a.runId ?? null,
    finishedAt: String(a.finishedAt ?? '').slice(0, 16).replace('T', ' ') || '—',
  }));
};

/**
 * THE HISTORY — each arm's scores across every run of this comparison,
 * oldest first, as points for a small chart: x is the run's place in time
 * (0..1 over the span), y the score. Pure.
 */
export const historyTracks = (series) => {
  const h = series?.history ?? [];
  if (!h.length) return { tracks: [], span: null };
  const t = h.map((p) => Date.parse(p.finishedAt));
  const t0 = Math.min(...t);
  const t1 = Math.max(...t);
  const x = (iso) => (t1 > t0 ? (Date.parse(iso) - t0) / (t1 - t0) : 0.5);
  const tracks = EVERY_ARM
    .map((arm) => ({ arm, name: armName(arm), points: h.filter((p) => p.arm === arm).map((p) => ({ x: x(p.finishedAt), y: p.value, at: p.finishedAt, runId: p.runId })) }))
    .filter((tr) => tr.points.length);
  return {
    tracks,
    span: { from: new Date(t0).toISOString().slice(0, 10), to: new Date(t1).toISOString().slice(0, 10), runs: h.length },
  };
};

/** pure — the detail header's two plain lines: what it tests, and this variant. */
export const suiteHeader = (suite) => ({
  meaning: benchMeaning(suite?.suiteId),
  variant: variantLine(suite?.label),
  tier: suite?.tier ? String(suite.tier).toUpperCase() : null,
});

/** pure — the note a comparison owes when its identity arms carry a silo pin. */
export const identityNote = (series) => (series?.protocolKeys > 1
  ? 'The identity arms carry the being’s silo pin, so their protocol fingerprint differs from the floor arms’ by exactly that — same questions, same sampling.'
  : null);
