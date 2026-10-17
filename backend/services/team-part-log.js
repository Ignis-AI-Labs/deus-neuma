// team-part-log.js — every member's part, LOGGED as it is worked.
//
// Design note, 2026-10-12: […] A part's work used to live where it was lost: the WORKFLOW
// window's live tails (memory — gone with a reload, a crash, or the run's
// end) and the member's session, written once at the END of its turn (a
// cut wrote one line, a crash wrote nothing). This log is written WHILE the
// member works — one encrypted line per event in the member's own lane,
// beside its sessions (<lane>/team/runs/<run>/<step>.jsonl):
//   open    — an attempt begins: the brief, or the continuation it was given
//   thought — its reasoning, batched
//   words   — what it said, batched
//   act     — every tool it reached for, with what came back
//   line    — its place in the substrate line (waiting / running)
//   retry   — the run continuing it after it stopped short, and why
//   end     — how the attempt ended
// The WORKFLOW window opens it member by member; a part that stopped short
// reads its own acts back from it to continue (team-continue.js).
//
// impure — appends to the member's encrypted workspace; a write that cannot
// land is logged and never costs the run.

import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { createLogger } from './logger.js';

const log = createLogger('TeamPartLog');

/** A reasoning or words batch is written once it holds this much… */
export const LOG_BATCH_CHARS = 4000;
/** …or once it has waited this long. */
export const LOG_BATCH_MS = 2000;
/** What one act returned, as much as the log keeps. */
export const LOG_DETAIL_CHARS = 4000;
/** The sources one act lists (a search's links), at most. */
export const LOG_SOURCES_MAX = 12;

const capText = (text, max) => {
  if (typeof text !== 'string' || !text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

// pure — an act as the log keeps it.
const loggedAct = (event) => ({
  tool: String(event?.tool ?? ''),
  status: String(event?.status ?? ''),
  summary: capText(event?.summary, 400),
  detail: capText(event?.detail, LOG_DETAIL_CHARS),
  sources: Array.isArray(event?.sources)
    ? event.sources.slice(0, LOG_SOURCES_MAX).map((s) => ({ title: capText(s?.title, 200), url: capText(s?.url, 500) }))
    : null,
});

/**
 * One part's log writer.
 *
 * @param {Object} args
 * @param {string} args.neumaId - the member's lane
 * @param {string} args.runId
 * @param {string} args.stepId
 * @param {Function} [args.append] - (neumaId, runId, stepId, entry) => Promise — the store
 * @returns {Readonly<Object>} begin, thought, words, act, line, clock, retry, end, flush, settled
 */
export const createPartLog = ({ neumaId, runId, stepId, append = (...a) => neumaWorkspace.appendTeamLog(...a) }) => {
  let open = null; // the batch being gathered: { kind, text, timer }
  // One chain: entries land in the order they happened, and a reader can
  // wait for everything written so far (settled).
  let last = Promise.resolve();
  const write = (entry) => {
    const stamped = { at: new Date().toISOString(), ...entry };
    last = last
      .then(() => append(neumaId, runId, stepId, stamped))
      .catch((err) => log.warn('part log entry not written', { runId, stepId, kind: entry.kind, error: err.message }));
  };
  const flush = () => {
    if (!open) return;
    clearTimeout(open.timer);
    const { kind, text } = open;
    open = null;
    if (text) write({ kind, text });
  };
  const stream = (kind, delta) => {
    if (!delta) return;
    if (open && open.kind !== kind) flush();
    if (!open) {
      open = { kind, text: '', timer: setTimeout(flush, LOG_BATCH_MS) };
      open.timer.unref?.();
    }
    open.text += delta;
    if (open.text.length >= LOG_BATCH_CHARS) flush();
  };
  // Every event closes the batch before it, so the log reads in the order it happened.
  const event = (entry) => { flush(); write(entry); };
  return Object.freeze({
    begin: ({ how, why = null, text }) => event({ kind: 'open', how, why, text }),
    thought: (delta) => stream('thought', delta),
    words: (delta) => stream('words', delta),
    act: (e) => event({ kind: 'act', ...loggedAct(e) }),
    line: ({ state, position = null, ahead = null }) => event({ kind: 'line', state, position, ahead }),
    // Its clock passed (team-clock.js, #577): by working time or the calendar, and what it did.
    clock: ({ by, then, clock }) => event({ kind: 'clock', by, then, clock }),
    retry: ({ inMs, why }) => event({ kind: 'retry', inMs, why }),
    end: ({ outcome, why = null }) => event({ kind: 'end', outcome, why }),
    flush,
    /** Resolves once every entry written so far has landed. */
    settled: () => { flush(); return last; },
  });
};

/**
 * The acts a part has already taken, from its log — what a continuation
 * lists back to the member. Settled acts only (an act still executing when
 * the attempt stopped never returned). impure — reads the member's log.
 *
 * @param {string} neumaId
 * @param {string} runId
 * @param {string} stepId
 * @returns {Promise<Array<{tool: string, status: string, summary: ?string}>>}
 */
export const actsOfPart = async (neumaId, runId, stepId) => {
  const entries = await neumaWorkspace.readTeamLog(neumaId, runId, stepId).catch(() => []);
  return entries
    .filter((e) => e.kind === 'act' && e.status !== 'executing')
    .map((e) => ({ tool: e.tool, status: e.status, summary: e.summary ?? null }));
};
