// tool-status.js — the ONE register of tool statuses that mean "still happening".
//
// Three places have to agree about this set, or the operator sees a chat that
// contradicts itself:
//   - the chip's colour register (frontend tool-chip-tone.js)
//   - the live stream's one-row-per-action fold (frontend stream-reducer.js)
//   - the turn's persisted record (backend portal-stream.js)
//
// They each held their own copy. The first two happened to agree; the record
// had no copy at all, which is why a render that filled ONE bar on screen came
// back from a restart as seven separate finished rows. A single table, imported
// by all three, is the only thing that keeps a resumed chat honest.

/** Statuses that mean the action has NOT settled — it is still happening. */
export const INFLIGHT_STATUSES = Object.freeze(new Set([
  'running',      // image-forge renders (per-progress-frame)
  'executing',    // terminal commands, email sends
  'pending',
  'in_progress',
  'busy',
]));

/**
 * True while an action is still happening. Pure.
 * @param {string} status the raw backend tool status
 * @returns {boolean}
 */
export const isInflightStatus = (status) => INFLIGHT_STATUSES.has(String(status || ''));
