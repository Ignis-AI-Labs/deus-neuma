// token-rows.js — the ACTIVITY panel's token sections, as rows, from one
// telemetry snapshot's `tokens` block (backend reply-meter.js and
// token-throughput.js). Every row carries a measured number or '—', never a
// drawn zero (SHINKEI): a reply still streaming has no server account yet, so
// its prompt, cache and draft rows read '—' until it ends.
//
// pure — data in, rows out.

const DASH = '—';
const PHASES = Object.freeze(['thinking', 'answer', 'tool']);
export const PHASE_LABEL = Object.freeze({ thinking: 'THINKING', answer: 'ANSWER', tool: 'TOOL CALL' });

const rate = (v) => (!Number.isFinite(v) ? DASH : v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1));
const count = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : DASH);
const pct = (v) => (Number.isFinite(v) ? String(Math.round(v * 100)) : DASH);
const per = (part, whole) => (Number.isFinite(part) && Number.isFinite(whole) && whole > 0 ? part / whole : null);
const waitRow = (k, ms) => (Number.isFinite(ms) && ms >= 10_000
  ? { k, v: (ms / 1000).toFixed(1), unit: 's' }
  : { k, v: Number.isFinite(ms) ? String(Math.round(ms)) : DASH, unit: 'ms' });

/**
 * The reply the panel shows: the newest one streaming, else the last that ended.
 * @returns {{reply: Object, live: boolean, streaming: number}|null}
 */
export const replyInView = (tokens) => {
  const live = tokens?.live ?? [];
  if (live.length) return { reply: [...live].sort((a, b) => a.sinceMs - b.sinceMs)[0], live: true, streaming: live.length };
  const last = tokens?.recent?.[0];
  return last ? { reply: last, live: false, streaming: 0 } : null;
};

/** One reply's split of its tokens, for the StackBar (hud-instruments.jsx). */
export const phaseParts = (reply) => PHASES
  .map((p, i) => ({ key: p, label: PHASE_LABEL[p], value: reply?.[p]?.tokens ?? 0, tone: ['live', 'dim', 'muted'][i], text: count(reply?.[p]?.tokens) }));

/** One reply: each phase's speed and size, its wait, and the server's own account; `live` lights the phase it is in now. */
export const replyRows = (reply, live = false) => {
  const s = reply?.server;
  const promptPerMs = per(s?.promptTokens, s?.promptMs);
  return [
    ...PHASES.map((p) => ({ k: PHASE_LABEL[p], v: rate(reply?.[p]?.tokPerSec), unit: 'tok/s', sub: `${count(reply?.[p]?.tokens)} tok`, active: live && reply?.phase === p })),
    waitRow('FIRST TOKEN', reply?.ttftMs),
    { k: 'PROMPT', v: rate(promptPerMs === null ? null : promptPerMs * 1000), unit: 'tok/s', sub: `${count(s?.promptTokens)} tok read` },
    { k: 'PROMPT CACHE', v: pct(per(s?.cachedTokens, (s?.cachedTokens ?? 0) + (s?.promptTokens ?? 0))), unit: '%', sub: `${count(s?.cachedTokens)} tok reused` },
    { k: 'DRAFTS ACCEPTED', v: pct(per(s?.draftAccepted, s?.draftTokens)), unit: '%', sub: `${count(s?.draftAccepted)} of ${count(s?.draftTokens)}` },
  ];
};

/** The last replies together (reply-meter.js recentSummary): rates weighted by tokens, the median wait. */
export const recentRows = (summary) => [
  ...PHASES.map((p) => ({ k: PHASE_LABEL[p], v: rate(summary?.[p]), unit: 'tok/s' })),
  waitRow('FIRST TOKEN', summary?.ttftMs),
  { k: 'GENERATION', v: rate(summary?.genTokPerSec), unit: 'tok/s' },
  { k: 'PROMPT', v: rate(summary?.promptTokPerSec), unit: 'tok/s' },
  { k: 'PROMPT CACHE', v: pct(summary?.cacheReuse), unit: '%' },
  { k: 'DRAFTS ACCEPTED', v: pct(summary?.draftAcceptance), unit: '%' },
];

/** Since the server started, from its cumulative counters (token-throughput.js lifetimeRates). */
export const lifetimeRows = (life) => [
  { k: 'GENERATION', v: rate(life?.genTokPerSec), unit: 'tok/s' },
  { k: 'PROMPT', v: rate(life?.promptTokPerSec), unit: 'tok/s' },
  { k: 'GENERATED', v: count(life?.generatedTokens), unit: 'tok' },
  { k: 'PROMPT READ', v: count(life?.promptTokens), unit: 'tok' },
  { k: 'PROMPT CACHE', v: pct(life?.cacheReuse), unit: '%', sub: `${count(life?.cachedTokens)} tok reused` },
  { k: 'DRAFTS ACCEPTED', v: pct(life?.draftAcceptance), unit: '%' },
  { k: 'PER DRAFT', v: Number.isFinite(life?.acceptedPerDraft) ? life.acceptedPerDraft.toFixed(2) : DASH, unit: 'tok' },
];
