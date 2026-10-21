// team-part-clock.js — one attempt's watch over its part's clock (#577), and
// the part's WORKING time.
//
// Working time runs while the attempt holds its place to work — from the
// member slot until the attempt ends — and PAUSES while the member waits in
// the substrate line (its line says 'waiting', then 'running'). A part held by
// its run's width and the pause before a continuation lie outside every
// attempt: never counted. The total lives on the entry (entry.worked) and the
// run record keeps it, so a resumed part continues its count.
//
// impure — timers; writes the entry; sends the clock frame.

import { markStepClock } from './team-run-live.js';

// The longest delay setTimeout holds; a longer one overflows and fires at once.
const TIMER_MAX_MS = 2 ** 31 - 1;

/**
 * @param {Object} args
 * @param {Object} args.entry - the live registry entry
 * @param {string} args.stepId
 * @param {{limitMs: ?number, dueMs: ?number}} args.limits - the part's whole working
 *   budget (ms, across attempts) and its calendar due (epoch ms); null = none
 * @param {(by: 'work'|'due') => void} args.onPass - called once, when either passes
 * @param {?Function} [args.keep] - (stepId, workedMs) — the record keeps the total
 * @returns {{work: Function, pause: Function, end: Function, retarget: Function}}
 */
export const createAttemptClock = ({ entry, stepId, limits, onPass, keep = null }) => {
  let since = null; // working since (epoch ms); null while not working
  let current = limits;
  let fired = false;
  let ended = false;
  const timers = [];
  const clear = () => { while (timers.length) clearTimeout(timers.pop()); };
  const total = () => (entry.worked[stepId] || 0) + (since == null ? 0 : Date.now() - since);
  const later = (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    timers.push(timer);
  };
  const fire = (by) => {
    if (fired || ended) return;
    fired = true;
    clear();
    onPass(by);
  };
  const arm = () => {
    clear();
    if (fired || ended) return;
    if (current.dueMs != null) {
      const left = current.dueMs - Date.now();
      if (left <= 0) { fire('due'); return; }
      // A due further out than one timer holds re-arms when that timer ends.
      later(() => (Date.now() >= current.dueMs ? fire('due') : arm()), Math.min(left, TIMER_MAX_MS));
    }
    if (current.limitMs != null && since != null) {
      const left = current.limitMs - total();
      if (left <= 0) { fire('work'); return; }
      later(() => fire('work'), left);
    }
  };
  // Fold the running stretch into the part's total.
  const fold = () => {
    if (since == null) return false;
    entry.worked[stepId] = (entry.worked[stepId] || 0) + (Date.now() - since);
    since = null;
    delete entry.workingSince[stepId];
    return true;
  };
  // A calendar due runs from the attempt's first moment — held, waiting or
  // working; one already past acts at once.
  arm();
  return {
    // The member works: its slot is held, or the line just let it in.
    work: () => {
      if (ended || since != null) return;
      since = Date.now();
      entry.workingSince[stepId] = since;
      markStepClock(entry, stepId);
      arm();
    },
    // The member waits its turn in the line: the count stops.
    pause: () => {
      if (ended || !fold()) return;
      markStepClock(entry, stepId);
      arm();
    },
    // The attempt is over, however it ended. Idempotent.
    end: () => {
      if (ended) return;
      const folded = fold();
      ended = true;
      clear();
      if (folded) {
        keep?.(stepId, entry.worked[stepId]);
        markStepClock(entry, stepId);
      }
    },
    // The clock was changed while the part works (team-run-tune.js).
    retarget: (next) => {
      current = next;
      fired = false;
      arm();
    },
  };
};
