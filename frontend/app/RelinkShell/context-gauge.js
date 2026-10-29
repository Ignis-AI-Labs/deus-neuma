// context-gauge.js — the stream header's context readout.
//
// The one ambient read: grouped digits follow the desk's active UI language
// through the active-locale leaf (frontend/i18n/active-locale.js) — the
// gauge's numbers switch with the language like every other formatter.

import { currentLocale } from '../../i18n/active-locale.js';
//
// Turns the latest context:composition event into the compact gauge the
// composer wears: a ring's percentage, the used/total label, tone and hover
// detail. The honest-stats ladder applies here too: a measured total reads
// bare, an estimated one wears ≈, and a missing context window never invents
// a percentage (the label falls back to the raw token count).
//
// Redesign (ruling, 2026-08-15): the full-width rail is gone — a small ring
// carries the percentage, and the window TOTAL (the active model's real
// capacity, per-route) is stated in the label rather than implied.
//
// FACTS ONLY (Founder, same day: […]): compaction keys on CONTEXT, so the gauge never
// predicts it in messages. It shows what is MEASURED — COMPACTION ARMED when
// this turn's prompt met the boundary, ×N for compactions that actually
// happened — and the hover states the exact mechanic.

/**
 * @param {number} n
 * @returns {string} grouped digits (12,431)
 */
const fmt = (n) => Number(n).toLocaleString(currentLocale());
const compact = (n) => new Intl.NumberFormat(currentLocale(), {
  notation: 'compact',
  maximumFractionDigits: 1,
}).format(n);

/**
 * Derive the gauge from the latest composition event.
 * @param {object|null|undefined} event the latest context:composition event
 * @returns {null|{
 *   label: string, tone: 'ok'|'warn'|'alert', title: string,
 *   pct: number|null, approx: boolean,
 *   used: number|null, remaining: number|null,
 *   compactionLabel: string|null,
 * }}   null when there is nothing honest to show yet (no turn has emitted).
 *   pct drives the ring, clamped 0–100 (null when the window is unknown — the
 *   label then carries the raw count, never an invented percentage).
 */
// pure
export const gaugeFor = (event) => {
  if (!event || typeof event !== 'object') return null;
  const legacyTokens = Number.isFinite(event.totals?.tokens) ? event.totals.tokens : null;
  const tokens = Number.isFinite(event.usage?.usedTokens) ? event.usage.usedTokens : legacyTokens;
  const windowTokens = Number.isFinite(event.budget?.contextTokens) && event.budget.contextTokens > 0
    ? event.budget.contextTokens
    : null;
  const approx = (event.usage?.source || event.totals?.tokenSource) !== 'measured';
  const remaining = tokens !== null && windowTokens !== null
    ? Math.max(0, windowTokens - tokens)
    : null;
  const pct = tokens !== null && windowTokens !== null
    ? Math.min(100, Math.max(0, Math.round((tokens / windowTokens) * 100)))
    : null;

  const session = event.session
    && Number.isInteger(event.session.compactionCount)
    && event.session.compactionCount >= 0
    ? event.session
    : null;
  const armed = session?.atBoundary === true;

  // Tone: context pressure alone (≥75% warn, ≥90% alert) — the one axis this
  // instrument measures. An armed compaction lives inside that zone already.
  let tone = 'ok';
  if (pct !== null && pct >= 90) tone = 'alert';
  else if (pct !== null && pct >= 75) tone = 'warn';

  const mark = approx ? '≈' : '';
  // The limit has its own honesty ladder: a window inferred from the model's
  // NAME is a guess and wears ≈ like any other estimate; runtime, registry and
  // catalog sources render as fact (Design note, 2026-07-27 — the global context
  // system must be consistent about what it actually knows). The label's
  // second figure is the window TOTAL — a stated capacity, not a remainder —
  // so it wears ≈ only when the limit itself is the guess.
  const budgetSource = typeof event.budget?.source === 'string' ? event.budget.source : 'unknown';
  const limitMark = windowTokens !== null && budgetSource === 'model-name' ? '≈' : '';
  const label = windowTokens !== null && tokens !== null
    ? `CTX ${mark}${compact(tokens)} / ${limitMark}${compact(windowTokens)}`
    : tokens !== null
      ? `CTX ${mark}${compact(tokens)} USED · LIMIT UNKNOWN`
      : 'CTX —';

  // Visible only when it is a FACT: ARMED when this turn's measured prompt
  // met the boundary (compaction runs at settle), ×N once one has happened.
  // Never a message-count prediction — we cannot know the next message's size.
  const compactionParts = [];
  if (armed) compactionParts.push('COMPACTION ARMED');
  if (session && session.compactionCount > 0) compactionParts.push(`×${session.compactionCount}`);
  const compactionLabel = compactionParts.length ? compactionParts.join(' · ') : null;

  const parts = [];
  if (tokens !== null) {
    parts.push(windowTokens !== null
      ? `${fmt(tokens)} used · ${fmt(remaining)} left · ${fmt(windowTokens)} total (${approx ? 'estimated' : 'measured'} usage · limit per ${budgetSource})`
      : `${fmt(tokens)} used · context limit unknown (${approx ? 'estimated' : 'measured'})`);
    // The headline is STANDING context — what the next turn inherits. A
    // tool-heavy turn's working peak (ephemeral tool machinery, never
    // persisted) is detail, not the headline (Design note, 2026-08-31: the peak made a
    // healthy turn boundary read as a context loss).
    if (Number.isFinite(event.usage?.workingPeakTokens) && event.usage.workingPeakTokens > tokens) {
      parts.push(`working peak ${fmt(event.usage.workingPeakTokens)} this turn (tool machinery — released, not carried forward)`);
    }
    if (event.usage?.source === 'carried') {
      parts.push('carried from the last measured turn — the interrupted turn measured nothing');
    }
  }
  // Fail-soft collapse is no longer invisible (D4): a section whose read threw
  // simply did not render — name it.
  if (Array.isArray(event.degraded) && event.degraded.length > 0) {
    parts.push(`context degraded: ${event.degraded.join(', ')} unavailable this turn`);
  }
  // What the shed ladder cut this turn is named too — the window could not hold it.
  if (Array.isArray(event.shed) && event.shed.length > 0) {
    parts.push(`shed this turn (the window could not hold them): ${event.shed.map((s) => s.id).join(', ')}`);
  }
  if (event.route?.model) parts.push(`${event.route.model} via ${event.route.provider || 'unknown provider'}`);
  if (session) {
    // The exact mechanic, stated: compaction arms when the measured prompt
    // reaches boundaryRatio of the window — no schedule, no message counts.
    const ratioWord = Number.isFinite(session.boundaryRatio) && session.boundaryRatio > 0
      ? `${Math.round(session.boundaryRatio * 100)}% of the window`
      : 'the context boundary';
    parts.push(armed
      ? `self-compaction ARMED — this turn measured past ${ratioWord}`
      : `self-compaction arms at ${ratioWord}`);
    parts.push(`self-compacted ${session.compactionCount}×`);
  }
  return { label, tone, title: parts.join(' · '), pct, approx, used: tokens, remaining, compactionLabel };
};
