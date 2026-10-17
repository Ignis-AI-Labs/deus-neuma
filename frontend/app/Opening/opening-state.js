// opening-state.js — the one opening's shared state. // impure (module state)
//
// 2026-09-25 audit: on desk entry TWO openings played at once — the boot
// (the construct, four self-test rows, four ticks) and, mounted beneath it,
// the desk's Arrival veil (its own seal, line flash, stage rows and ticks)
// at a HIGHER z than the boot. The witness saw a seal, a second seal, then
// the construct already mid-descent, and heard two tick machines
// interleave. Now there is one opening: while the boot plays, the Arrival
// DEFERS — silent and unseen, it still runs its real machine on the real
// portal events and publishes each stage here; the boot shows those stages
// as its own rows (BEING, SESSION). Only a HOLDING — a real failure with
// real actions — ever shows the veil over the boot.

import { OPENING_EVENTS } from './opening-events.js';

let bootActive = false;
let arrival = null; // { stage, resumeExpected } — the last stage the Arrival published

/** impure — the boot owns the opening (set before any child renders) */
export const setBootActive = (on) => {
  bootActive = Boolean(on);
  if (!bootActive) window.dispatchEvent(new CustomEvent(OPENING_EVENTS.BOOT_DONE));
};

/** @returns {boolean} whether the boot is playing now */
export const isBootActive = () => bootActive;

/** impure — the deferred Arrival publishes a stage (kept for late listeners) */
export const publishArrival = (stage, resumeExpected) => {
  arrival = { stage, resumeExpected };
  window.dispatchEvent(new CustomEvent(OPENING_EVENTS.ARRIVAL, { detail: arrival }));
};

/** @returns {?{stage: string, resumeExpected: ?boolean}} the last published stage */
export const lastArrival = () => arrival;
