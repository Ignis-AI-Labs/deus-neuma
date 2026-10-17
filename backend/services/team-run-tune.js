// team-run-tune.js — a hand on a WORKING run's width and clocks (#577).
//
// Design note, 2026-10-13: the concurrency cap […]; the deadline must be configurable — or absent. Three hands reach a
// live run: the operator (the WORKFLOW window), the house's CoS and the run's
// lead (the team/tune intent). Who may is the caller's to judge
// (team-live-routes.js, intents/team-tune.js); this is the change itself.
//
// impure — changes the live entry, re-arms working parts' clocks, keeps the
// record, tells every desk.

import { broadcastRun, markStepClock } from './team-run-live.js';
import { normalizeClock, normalizeCheckIn, governsOf, NO_CLOCK, DEFAULT_CHECK_IN_MINUTES } from './team-clock.js';
import { normalizeConcurrency, runWidth, CONCURRENCY_MAX } from './team-run-gate.js';

const SETTLED = new Set(['done', 'failed']);

/**
 * Change a working run's width, its clock, or one part's clock.
 *
 * @param {Object} entry - the live run (team-run-live.js)
 * @param {Object} change
 * @param {*} [change.concurrency] - parts at once; null = as wide as the rig allows
 * @param {*} [change.clock] - a clock (team-clock.js): the run's, or with stepId
 *   the part's own; 'none' = no clock; null clears a part's own (it inherits the run's)
 * @param {?string} [change.stepId] - the part a clock is for
 * @param {*} [change.checkIn] - minutes between the eye's check-ins (team-watch.js); 0 / "none" = none
 * @param {string} [change.by] - who changed it, in words — every desk is told
 * @returns {{ok: true, concurrency: number, clock: ?Object, clocks: Object, checkIn: number, note: ?string} | {ok: false, reason: string}}
 */
export const tuneRun = (entry, { concurrency, clock, checkIn, stepId = null, by = 'your operator' } = {}) => {
  let width;
  let next;
  let cadence;
  try {
    width = concurrency === undefined ? undefined : normalizeConcurrency(concurrency);
    next = clock === undefined ? undefined : normalizeClock(clock, stepId ? `step "${stepId}"` : 'the run');
    cadence = checkIn === undefined ? undefined : normalizeCheckIn(checkIn);
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  if (width === undefined && next === undefined && cadence === undefined) return { ok: false, reason: 'name a concurrency, a clock, a checkIn — or several' };
  if (stepId != null) {
    const row = (entry.board || []).find((e) => e.id === stepId);
    if (!row) return { ok: false, reason: `the run has no step ${stepId}` };
    if (width !== undefined || cadence !== undefined) return { ok: false, reason: 'concurrency and checkIn are the whole run\'s — name them without a step' };
    if (SETTLED.has(row.state)) return { ok: false, reason: `step ${stepId} is ${row.state} — its clock can no longer change` };
  }

  let note = null;
  if (width !== undefined) {
    const top = entry.ceiling ?? CONCURRENCY_MAX;
    const asked = width ?? top;
    entry.concurrency = runWidth(asked, top);
    if (asked > top) note = `the rig allows ${top} at once — the run works ${top} at a time`;
    entry.gate?.widen();
  }
  if (cadence !== undefined) {
    entry.checkIn = cadence ?? DEFAULT_CHECK_IN_MINUTES;
    entry.rewatch?.();
  }
  if (next !== undefined) {
    let touched;
    if (stepId != null) {
      if (next === null) delete entry.clocks[stepId];
      else entry.clocks[stepId] = next;
      touched = [stepId];
    } else {
      entry.clock = next === NO_CLOCK ? null : next;
      // Every part that inherits the run's clock — not one that carries its own.
      touched = (entry.board || []).map((e) => e.id).filter((id) => !Object.hasOwn(entry.clocks, id));
    }
    // A new clock is a new promise: what the old one already did never holds it back.
    for (const id of touched) {
      delete entry.clockState[id];
      entry.clockWatch.get(id)?.();
      markStepClock(entry, id);
    }
  }
  const governs = { concurrency: entry.concurrency, clock: entry.clock, clocks: { ...entry.clocks }, checkIn: entry.checkIn ?? DEFAULT_CHECK_IN_MINUTES };
  entry.onTune?.({ ...governs, clockState: { ...entry.clockState } });
  broadcastRun(entry, { type: 'operator:team_tune', id: entry.id, ...governsOf(entry), clockState: { ...entry.clockState }, by, ...(stepId ? { stepId } : {}) });
  return { ok: true, ...governs, note };
};
