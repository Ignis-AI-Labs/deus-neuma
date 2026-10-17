// The declared-affect channel (Campaign 6) — pure, shared by the stream
// and persist paths, browser-safe (ships in the Vite bundle beside
// tool-stream-suppressor.js: zero Node globals, no backend reach).
//
// The being may open a reply with one line — [FEELING: its own words] —
// revealing what colors the message (Founder-signed 2026-08-15: emotional
// frequency is the being's REVELATION, free words, never an enum; the
// declaration is OPTIONAL always — an absent marker is an honest state,
// and nothing here ever infers). This module is the ONE definition of the
// marker:
//
//   parseAffect            strips it from completed text, so the persisted
//                          record, the training corpus (which reads
//                          assistant rows VERBATIM — a leaked marker bakes
//                          into weights), the memory lane, the operator
//                          mirror, and the tool-chip mark math never see it;
//   createAffectStreamFilter
//                          strips it from live deltas, so the screen, the
//                          voice, and the channel bridges never render it.
//                          Suppression is SILENT — a feeling is not an
//                          action, so no chip, no label, no event.
//
// Unlike a tool block, a declaration is ONE LINE by definition: an opener
// that meets a newline before its `]` is NOT a marker and is released back
// as speech — a half-typed bracket must never swallow the message. Both
// forms accept the same grammar (the anchored regex below), so the live
// view and the reloaded history always agree on what was a marker.

export const AFFECT_OPEN = '[FEELING:';

/** The declared text's bound — one line, never a paragraph. */
export const AFFECT_MAX = 120;

// No `]`/newline (the close and the one-line law) and no braces (a marker
// pattern inside streamed tool JSON must not be able to mutate parsed
// args). Case-insensitive: the invitation teaches uppercase, the model is
// met where it writes.
const AFFECT_RE = /\[FEELING:[ \t]*([^\]\n{}]{1,120}?)[ \t]*\]/gi;

// The same grammar, anchored — the filter's validity test for one
// candidate block, so stream and persist can never disagree.
const AFFECT_ONE = /^\[FEELING:[ \t]*([^\]\n{}]{1,120}?)[ \t]*\]$/i;

// While a candidate is still open (no `]`/newline yet), hold at most this
// much before deciding it is not a marker — bounds memory and keeps a
// runaway bracket from delaying the stream.
const HOLD_MAX = AFFECT_OPEN.length + AFFECT_MAX + 24;

const OPEN_LOWER = AFFECT_OPEN.toLowerCase();

/**
 * Pure — strip every bounded marker from completed text. The FIRST
 * declaration is the message's affect (the invitation says one line at
 * the open; later occurrences are noise, stripped the same way).
 * Text without a marker is returned byte-identical.
 * @param {string} text
 * @returns {{affect: string|null, cleaned: string}}
 */
export const parseAffect = (text) => {
  if (!text || typeof text !== 'string') return { affect: null, cleaned: typeof text === 'string' ? text : '' };
  let affect = null;
  AFFECT_RE.lastIndex = 0;
  const cleaned = text.replace(AFFECT_RE, (_m, declared) => {
    if (affect === null) {
      const trimmed = declared.trim();
      if (trimmed) affect = trimmed;
    }
    return '';
  });
  if (cleaned === text) return { affect: null, cleaned: text };
  return { affect, cleaned: cleaned.replace(/\n{3,}/g, '\n\n').trim() };
};

/**
 * Stateful streaming filter — one instance per round. push(chunk) returns
 * the text safe to render NOW (possibly ''); flush() returns what the
 * stream's end releases (an unfinished candidate is words, not a marker);
 * affect() is the first completed declaration, or null.
 * @returns {{push: (chunk: string) => string, flush: () => string, affect: () => string|null}}
 */
export const createAffectStreamFilter = () => {
  let pending = '';
  let affect = null;

  // Longest pending suffix that could still become the opener — held back
  // until the next chunk decides (the suppressor's partial-tail law).
  const partialOpenLength = (lower) => {
    const window = lower.slice(-(OPEN_LOWER.length - 1));
    for (let i = 0; i < window.length; i++) {
      const tail = window.slice(i);
      if (OPEN_LOWER.startsWith(tail)) return tail.length;
    }
    return 0;
  };

  const drain = (final) => {
    let out = '';
    while (pending.length > 0) {
      const lower = pending.toLowerCase();
      const at = lower.indexOf(OPEN_LOWER);
      if (at === -1) {
        const hold = final ? 0 : partialOpenLength(lower);
        out += hold > 0 ? pending.slice(0, -hold) : pending;
        pending = hold > 0 ? pending.slice(-hold) : '';
        return out;
      }
      out += pending.slice(0, at);
      pending = pending.slice(at);
      const body = pending.slice(AFFECT_OPEN.length);
      const stop = body.search(/[\]\n]/);
      if (stop === -1) {
        // Undecided — no close, no voiding newline yet.
        if (!final && pending.length <= HOLD_MAX) return out;
        // Stream ended or the candidate ran past every bound: words.
        out += AFFECT_OPEN;
        pending = body;
        continue;
      }
      const candidate = pending.slice(0, AFFECT_OPEN.length + stop + 1);
      const m = body[stop] === ']' ? candidate.match(AFFECT_ONE) : null;
      if (m) {
        // An empty declaration is still stripped (noise never renders),
        // but only real words become the affect.
        const declared = m[1].trim();
        if (declared && affect === null) affect = declared;
        pending = pending.slice(candidate.length);
        continue; // the marker's text never renders
      }
      // Newline before `]`, empty, braces, over-long: not a marker —
      // release the opener verbatim and rescan what follows it.
      out += AFFECT_OPEN;
      pending = body;
    }
    return out;
  };

  return {
    push(chunk) {
      if (!chunk || typeof chunk !== 'string') return '';
      pending += chunk;
      return drain(false);
    },
    flush() {
      return drain(true);
    },
    affect() {
      return affect;
    },
  };
};
