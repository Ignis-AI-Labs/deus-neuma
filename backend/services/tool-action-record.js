// tool-action-record.js — the turn's record of what a being DID, kept so a
// resumed chat comes back in the shape the operator left it in.
//
// Both seats stream through their own path (portal-stream for a neuma,
// witness-stream for a sealed peer), but a chat that is re-opened after a
// close, a crash, or an app restart owes the operator the same thing either
// way: the acts sitting where they happened, one row per action, carrying what
// they carried. That law lives here, once, so the two seats cannot drift.
//
// Three things the record has to hold (Design note, 2026-08-05: […]):
//
//   WHERE — `mark`, how many characters of the turn's answer stood written when
//     the act happened. Without it the rebuild has no idea where a chip went,
//     and every act of the turn is hoisted into one block ahead of the words.
//
//   ONE ROW PER ACTION — a long act reports progress many times ([…]). The live view folds those into the single filling bar the
//     operator watched; the record kept every frame, so one image came back
//     from a restart as seven finished rows.
//
//   WHAT IT MADE — `images` refs (id, url, mime, path — never the bytes), so
//     the render is still in the conversation and not only in the gallery.
//
// The record is keyed by the socket and lives exactly as long as the turn does.

import { isInflightStatus } from '../../core/runtime/tool-status.js';

const records = new WeakMap(); // ws → Array<{tool,status,summary,detail,mark}>
const marks = new WeakMap(); // ws → chars of this turn's answer already written
// THE THOUGHT TRAIL lives in the same record: the turn's reasoning stretches,
// each marked with the speech written when it happened — the acts' own law,
// so a resumed chat rebuilds the bubbles where they streamed (Design note, 2026-08-27.
const thoughts = new WeakMap(); // ws → Array<{text, mark}>

/**
 * Index of the LAST unsettled row for `tool`, or -1. Last, not first: a being
 * may use the same tool twice in one turn, and a new report belongs to the most
 * recent invocation. Mirrors the live view's fold (stream-reducer's
 * lastLiveToolIndex) through the shared in-flight register. Pure.
 * @param {Array<Object>} actions
 * @param {string} tool
 * @returns {number}
 */
const lastLiveActionIndex = (actions, tool) => {
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    if (actions[i].tool === tool && isInflightStatus(actions[i].status)) return i;
  }
  return -1;
};

/**
 * Open the turn's record at position zero. Called BEFORE anything can emit —
 * an act that fires before the first word (an operator's slash-summon) belongs
 * ahead of the answer, not missing from it.
 * @param {Object} ws
 */
// impure — WeakMap write
export const openTurnRecord = (ws) => {
  records.set(ws, []);
  marks.set(ws, 0);
  thoughts.set(ws, []);
};

/**
 * The turn's answer now stands `chars` long; acts from here on sit after it.
 * A no-op outside an open turn.
 * @param {Object} ws
 * @param {number} chars
 */
// impure — WeakMap write
export const markTurnText = (ws, chars) => {
  if (records.has(ws)) marks.set(ws, chars);
};

/**
 * Record one tool event. `executing` opens are skipped — they are the chip
 * appearing, not an outcome — and a further report about an action already on
 * the record updates its row in place rather than adding one.
 * @param {Object} ws
 * @param {{tool?: string, status?: string, summary?: string, detail?: string,
 *          sources?: Array, images?: Array}} event
 */
// impure — WeakMap append
export const collectToolAction = (ws, event) => {
  const actions = records.get(ws);
  if (!actions || !event?.tool || event.status === 'executing') return;
  const action = {
    tool: event.tool,
    status: event.status || 'ok',
    summary: typeof event.summary === 'string' ? event.summary.toWellFormed() : (event.summary || ''),
    detail: typeof event.detail === 'string' ? event.detail.toWellFormed() : (event.detail || ''),
    // Sources and renders are omitted entirely when there are none, so every
    // other tool's persisted shape is byte-identical to what it always was.
    ...(event.sources?.length ? { sources: event.sources } : {}),
    ...(event.images?.length ? { images: event.images } : {}),
    // A findings list is the one payload here the operator was HANDED rather
    // than shown as evidence, so it persists for the same reason the others do
    // and none of its own: he will come back to it. `count` guards the empty
    // case without a second shape — a list with no items never reached here.
    ...(event.findings?.count ? { findings: event.findings } : {}),
    // A benchmark launched from the chat: its comparison, so the card watches
    // the run to its end — live, and again on a resumed chat.
    ...(event.bench?.comparisonId ? { bench: event.bench } : {}),
    mark: marks.get(ws) || 0,
  };
  const live = lastLiveActionIndex(actions, action.tool);
  if (live === -1) {
    actions.push(action);
    return;
  }
  // The bar fills in place and the terminal result replaces it — keeping the
  // position the act started at, and any detail the later report omits.
  actions[live] = {
    ...action,
    detail: action.detail || actions[live].detail,
    mark: actions[live].mark,
  };
};

/**
 * The turn's acts, oldest first. Empty outside an open turn.
 * @param {Object} ws
 * @returns {Array<Object>}
 */
// impure — WeakMap read
export const turnRecordFor = (ws) => records.get(ws) || [];

/**
 * Record one reasoning chunk at `mark` (the speech written when the thought
 * happened). Chunks of one contiguous stretch fold into ONE entry, exactly
 * as the live bubble accumulates — a no-op outside an open turn.
 * @param {Object} ws
 * @param {string} chunk
 * @param {number} mark
 */
// impure — WeakMap append
export const recordThoughtStretch = (ws, chunk, mark) => {
  const trail = thoughts.get(ws);
  if (!trail || !chunk) return;
  const last = trail[trail.length - 1];
  if (last && last.mark === mark) last.text += chunk;
  else trail.push({ text: chunk, mark });
};

/**
 * The turn's reasoning stretches, oldest first. Empty outside an open turn.
 * @param {Object} ws
 * @returns {Array<{text: string, mark: number}>}
 */
// impure — WeakMap read
export const thoughtRecordFor = (ws) => thoughts.get(ws) || [];

/**
 * Close the turn's record, however the turn ended.
 * @param {Object} ws
 */
// impure — WeakMap delete
export const closeTurnRecord = (ws) => {
  records.delete(ws);
  marks.delete(ws);
  thoughts.delete(ws);
};
