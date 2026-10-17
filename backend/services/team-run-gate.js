// team-run-gate.js — how many of ONE run's parts work at once (#577).
//
// Design note, 2026-10-13: […] A run used to take every member slot the rig allowed; deep
// parts at full width each crawl (Zezebur's audit: five deep steps sharing
// one GPU each ran at about a fifth of their solo speed). The plan names its
// own width, the operator, the CoS and the lead change it while it runs, and
// the rig stays the ceiling — the substrate line and the process's member
// slots (team-part.js) still hold every run in this house together.
// Narrowing never cuts a working part: it holds the next one.
//
// impure — the gate's waiters (createRunGate); the rest is pure.

/** The widest a plan may ask — a plan holds at most this many steps. */
export const CONCURRENCY_MAX = 16;

/**
 * A run's width as given — a whole number of parts at once, or null when
 * none was named. Throws the correction. Pure.
 * @param {*} raw
 * @param {string} [where]
 * @returns {?number}
 */
export const normalizeConcurrency = (raw, where = 'concurrency') => {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (!Number.isInteger(n) || n < 1 || n > CONCURRENCY_MAX) {
    throw new Error(`${where} is how many parts work at once — a whole number from 1 to ${CONCURRENCY_MAX}.`);
  }
  return n;
};

/**
 * The width a run works at: what was asked, never past the rig. Pure.
 * @param {?number} asked - the plan's or a hand's ask (null = as wide as the rig allows)
 * @param {number} ceiling - the rig's member slots for this run
 * @returns {number}
 */
export const runWidth = (asked, ceiling) => {
  const top = Number.isInteger(ceiling) && ceiling >= 1 ? ceiling : 1;
  return Math.max(1, Math.min(Number.isInteger(asked) ? asked : top, top));
};

/**
 * The run's own gate: at most `entry.concurrency` of its parts past it at
 * once, first come first served. A part stopped while it is held leaves the
 * queue.
 *
 * @param {Object} entry - the live registry entry; `concurrency` is read every time the gate moves
 * @param {{onHeld?: (stepId: string, at: {position: number, of: number}) => void}} [opts]
 * @returns {{enter: (stepId: string, signal: AbortSignal) => Promise<void>, leave: () => void, widen: () => void, busy: () => number}}
 */
export const createRunGate = (entry, { onHeld = () => {} } = {}) => {
  let inside = 0;
  const held = [];
  const width = () => entry.concurrency ?? Infinity; // a run with no width of its own holds nothing
  const tell = () => held.forEach((w, i) => onHeld(w.stepId, { position: i + 1, of: entry.concurrency }));
  const admit = () => {
    while (held.length > 0 && inside < width()) {
      const w = held.shift();
      w.signal.removeEventListener('abort', w.onAbort);
      inside += 1;
      w.resolve();
    }
    tell();
  };
  return {
    enter: (stepId, signal) => {
      if (signal.aborted) return Promise.reject(new Error(signal.reason?.message || 'stopped by the operator'));
      if (held.length === 0 && inside < width()) {
        inside += 1;
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const w = { stepId, signal, resolve };
        w.onAbort = () => {
          const at = held.indexOf(w);
          if (at !== -1) held.splice(at, 1);
          tell();
          reject(new Error(signal.reason?.message || 'stopped by the operator'));
        };
        signal.addEventListener('abort', w.onAbort, { once: true });
        held.push(w);
        tell();
      });
    },
    leave: () => {
      inside -= 1;
      admit();
    },
    // The width was raised: the next held parts go now.
    widen: admit,
    busy: () => inside,
  };
};
