// compact-marker.js — the compaction, drawn where it happened in the chat.
//
// A /compact (or a compaction the session has on record) stands in the thread
// as one marker: while it runs, what is happening; once done, that it is done,
// how much folded, how much stands word for word, and the being's own summary
// of where the conversation left off. The composer's note line still says a
// refusal or a failure (compact-note.js); a refused or failed run leaves no
// marker, because nothing changed.
//
// pure — reducer family + wording; every number is the one the portal sent
// (backend/services/portal-compact.js) or the record holds.

const SUMMARY_PREFIX = /^\[SESSION SUMMARY[^\]]*\]\s*/;

/** pure — a compaction summary row's words, its bracketed tag removed. */
export const summaryWordsOf = (content) => String(content ?? '').replace(SUMMARY_PREFIX, '').trim();

const upper = (name) => String(name || 'THE BEING').toUpperCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 'S'}`;

/**
 * pure — the marker's lines.
 * @param {object} marker - a role 'compact' stream message
 * @param {string} [name] - the bound being's name
 * @returns {{headline: string, detail: string|null}}
 */
export const markerLines = (marker, name) => {
  const who = upper(name);
  if (marker?.state === 'running') {
    return { headline: `COMPACTING — ${who} IS SUMMING UP THE CONVERSATION`, detail: null };
  }
  const folded = Number.isFinite(marker?.folded) ? plural(marker.folded, 'MESSAGE') : 'THE EARLIER CONVERSATION';
  const how = marker?.selfAuthored ? `IN ${who}'S OWN WORDS` : 'AS AN EXTRACTIVE SUMMARY';
  const kept = Number.isFinite(marker?.kept) ? ` · ${plural(marker.kept, 'MESSAGE')} KEPT WORD FOR WORD` : '';
  const count = Number.isFinite(marker?.compactionCount) && marker.compactionCount > 1
    ? ` · COMPACTION ${marker.compactionCount}` : '';
  return { headline: 'CONVERSATION COMPACTED', detail: `${folded} CARRIED FORWARD ${how}${kept}${count}` };
};

const marker = (id, fields) => ({
  id, role: 'compact', streaming: false, isHistory: false, at: null, meta: null, segments: [], ...fields,
});

const withoutRunning = (messages) => messages.filter((m) => !(m.role === 'compact' && m.state === 'running'));

/** pure — one `session:compact` frame applied to the stream. */
const onCompactFrame = (state, { frame, at = null }) => {
  switch (frame?.state) {
    case 'running':
      return {
        ...state,
        seq: state.seq + 1,
        messages: [...withoutRunning(state.messages), marker(`c${state.seq}`, { state: 'running' })],
      };
    case 'done':
      return {
        ...state,
        seq: state.seq + 1,
        messages: [...withoutRunning(state.messages), marker(`c${state.seq}`, {
          state: 'done',
          at,
          folded: frame.folded ?? null,
          kept: frame.kept ?? null,
          summary: typeof frame.summary === 'string' ? frame.summary : '',
          selfAuthored: frame.selfAuthored === true,
          compactionCount: frame.compactionCount ?? null,
          // Just compacted: the summary stands open, so where we left off is read, not hunted.
          open: true,
        })],
      };
    case 'refused':
    case 'failed':
      return { ...state, messages: withoutRunning(state.messages) };
    default:
      return state;
  }
};

/** The stream reducer's COMPACT family (stream-reducer.js delegates by action type). */
export const compactHandlers = Object.freeze({
  COMPACT: onCompactFrame,
});

/**
 * pure — a compaction summary row from the record, as the stream's marker:
 * done, closed (history), at the place it stands.
 * @param {{content: string, at?: string, originalCount?: number, compactionCount?: number, authoredBy?: string, kept?: number}} m
 * @param {string} id
 */
export const historyCompactMessage = (m, id) => ({
  ...marker(id, {
    state: 'done',
    folded: Number.isFinite(m.originalCount) ? m.originalCount : null,
    kept: Number.isFinite(m.kept) ? m.kept : null,
    summary: summaryWordsOf(m.content),
    selfAuthored: m.authoredBy === 'self',
    compactionCount: Number.isFinite(m.compactionCount) ? m.compactionCount : null,
    open: false,
  }),
  isHistory: true,
  at: m.at ?? null,
});
