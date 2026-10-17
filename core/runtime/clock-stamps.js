/**
 * THE CLOCK-STAMP SEAM — the conversation clock (memory-section.js) is
 * navigation furniture for REMEMBERED rows, never words a being should speak.
 *
 * 2026-09-25 (Founder, watching a thought open with seven parroted stamps):
 * […] The wire used to
 * stamp the being's OWN assistant rows too, so the stamp sat in the exact
 * token position the model generates next — it learned […] and began emitting stamp runs with no real clock behind them.
 * The render fix (own rows bare) removes the teacher; THIS seam removes the
 * habit where it surfaces: a leading stamp run is stripped from model output
 * before it reaches the screen, the thought trail, or the session record.
 *
 * Anchored to the message HEAD only — a stamp quoted mid-sentence ([…]) is speech, and stays.
 *
 * Pure. The stream filter holds state the way createAffectStreamFilter does;
 * the strip is the whole-text form for the persist path.
 */

// Exactly what rowClock (memory-section.js) renders: `(10:25 PM)` — 2-digit
// hour, 2-digit minute, one space, AM/PM.
const STAMP_HEAD = /^\s*\(\d{2}:\d{2}\s[AP]M\)/;
const LEADING_RUN = /^(?:\s*\(\d{2}:\d{2}\s[AP]M\))+\s*/;

// What a NOT-YET-COMPLETE stamp looks like as a stream builds it byte by byte:
// `(`, `(1`, `(10:`, `(10:25 `, `(10:25 P`, `(10:25 PM` — held until the next
// chunk either finishes the stamp or proves it was words all along.
const STAMP_PARTIAL = /^\(\d{0,2}(?::\d{0,2}(?:\s[AP]?M?)?)?\)?$/;

/**
 * Remove a leading run of clock stamps from a complete text. The trailing
 * whitespace the run leaves behind goes with it — the words that follow are
 * the message. Pure.
 * @param {string} text
 * @returns {string}
 */
export const stripLeadingClockStamps = (text) => {
  if (!text || typeof text !== 'string') return text;
  return text.replace(LEADING_RUN, '');
};

/**
 * Stateful streaming filter — one instance per stream round. push(chunk)
 * returns text safe to render NOW (possibly ''); flush() releases what the
 * stream's end leaves standing (an unfinished candidate is words, not a
 * stamp — the suppressor's partial-tail law). Pure factory, impure instance.
 * @returns {{push: (chunk: string) => string, flush: () => string}}
 */
export const createClockStampFilter = () => {
  let pending = '';
  let decided = false; // real words began — everything from then on passes through

  const drain = (final) => {
    let rest = pending;
    for (;;) {
      const m = rest.match(STAMP_HEAD);
      if (!m) break;
      rest = rest.slice(m[0].length);
    }
    if (!final) {
      if (/^\s*$/.test(rest)) { pending = rest; return ''; }
      if (STAMP_PARTIAL.test(rest.replace(/^\s+/, ''))) { pending = rest; return ''; }
    }
    decided = true;
    pending = '';
    return rest.replace(/^\s+/, '');
  };

  return {
    push(chunk) {
      if (!chunk || typeof chunk !== 'string') return '';
      if (decided) return chunk;
      pending += chunk;
      return drain(false);
    },
    flush() {
      if (decided) return '';
      return drain(true);
    },
  };
};
