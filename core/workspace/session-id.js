// session-id.js — ONE minter for a sitting's id, unique within this process.
//
// Every seat minted `session-${Date.now()}` for itself, so two sittings begun
// in the same millisecond shared one name — and one file. Live, 2026-10-12: a
// lead's three parallel parts for ONE member began together and wrote three
// briefs and three answers, interleaved, into a single session. The id keeps
// its shape (`session-<ms>` — the desk reads it as the sitting's time); a
// second mint within the same millisecond takes the next one.
//
// impure — module state (the last id minted).

let last = 0;

/**
 * @param {number} [now] - the clock, in ms
 * @returns {string} a session id no other sitting of this process holds
 */
export const mintSessionId = (now = Date.now()) => {
  last = Math.max(now, last + 1);
  return `session-${last}`;
};
