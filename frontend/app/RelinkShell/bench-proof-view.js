// bench-proof-view.js — the PROOF SUITE panel's progress display law, PURE.
// The operator, mid live run (2026-09-24): […]
//
// The clock is injected everywhere (the staff-view idiom); the strings are
// the panel's whole copy. bench-view.js does not grow (the 500-line law).

/** What a section MEANS, plainly — the watcher learns the suite while it runs. */
export const SECTION_MEANING = Object.freeze({
  arithmetic: '25 real grade-school math problems (GSM8K, verbatim) — the model must end with one exact number',
  instruction: '12 authored instruction checks — exact word counts, required keywords, format law',
  format: '6 strict JSON shapes — parse and schema must both hold',
});

/** pure — the section's plain meaning, or '' for an unknown section. */
export const sectionMeaning = (section) => SECTION_MEANING[section] ?? '';

const pad2 = (n) => String(n).padStart(2, '0');

/** pure — elapsed as M:SS (H:MM:SS past the hour). '—' for nonsense input. */
export const elapsedText = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
};

/** pure — a pace/ETA span in the register's compact form: ~23S/ITEM, ~15 MIN. */
const spanText = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 90000) return `~${Math.max(1, Math.round(ms / 1000))}S`;
  if (ms < 3600000) return `~${Math.round(ms / 60000)} MIN`;
  return `~${(ms / 3600000).toFixed(1)} H`;
};

/**
 * The pace line: ELAPSED · PACE · ETA. Pace is elapsed/done (measured, never
 * assumed); ETA is pace × remaining PLUS the current item's in-flight time.
 * Before the first verdict lands there is no pace to show — the line says
 * MEASURING THE PACE… instead of inventing one. Pure.
 * @param {{state: string, done?: number, total?: number, startedAt?: string,
 *   itemStartedAt?: string}} run the runner's state
 * @param {number} nowMs injected clock
 */
export const paceLine = (run, nowMs) => {
  if (run?.state !== 'running') return '';
  const startedMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startedMs)) return '';
  const elapsed = Math.max(0, nowMs - startedMs);
  if (!run.done) return `ELAPSED ${elapsedText(elapsed)} — MEASURING THE PACE…`;
  const pace = elapsed / run.done;
  const remaining = Math.max(0, (run.total ?? 0) - run.done);
  const itemStartMs = Date.parse(run.itemStartedAt);
  const inFlight = Number.isFinite(itemStartMs) ? Math.max(0, nowMs - itemStartMs) : 0;
  const eta = pace * remaining + inFlight;
  return `ELAPSED ${elapsedText(elapsed)} · PACE ${spanText(pace)}/ITEM · ETA ${spanText(eta)}`;
};

/**
 * The NOW ANSWERING line: the item id plus the prompt's substance — the
 * QUESTION portion when the arithmetic template's marker is present (the
 * boilerplate preamble teaches nothing), else the raw prompt — truncated at
 * ~140 chars. The runner ships the prompt (truncated server-side); the desk
 * never hardcodes an item. Empty when nothing is in flight. Pure.
 */
export const nowAnsweringLine = (run) => {
  if (run?.state !== 'running' || !run.itemId) return '';
  const body = String(run.itemPrompt ?? '');
  const qIdx = body.indexOf('\n\nQuestion: ');
  const text = qIdx >= 0 ? body.slice(qIdx + '\n\nQuestion: '.length) : body;
  const excerpt = text.slice(0, 140);
  return `NOW ANSWERING: ${run.itemId.toUpperCase()} — “${excerpt}${text.length > 140 ? '…' : ''}”`;
};

/**
 * The LAST line: the last verdict, plainly. Empty until the first item
 * settles. Pure.
 */
export const lastItemLine = (run) => {
  if (!run?.lastItem) return '';
  const item = run.lastItem;
  return `LAST: ${String(item.id).toUpperCase()} ${item.pass ? 'PASS' : 'FAIL'} (${elapsedText(item.durationMs)})`;
};
