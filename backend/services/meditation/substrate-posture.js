// SUBSTRATE POSTURE — everything the meditation gates can see, in one read.
//
// PIGGYBACK-ONLY LAW (Founder-signed decision #2, 2026-08-14): the meditation
// loop NEVER ignites the substrate. A cycle runs only on an already-lit,
// NEUMA-owned, idle server — and this module is the honest account of that
// posture. Fail-closed throughout: an unreadable busy probe reads busy, a
// lease that even looks occupied reads held.
//
// NAMED BLIND SPOTS — what these gates CANNOT see, stated rather than papered
// over: LM Studio holding the GPU, out-of-process benchmark or training runs
// (the benchmark harness boots its own supervised substrate in a separate
// process), and sibling agent instances on this box. The gates make the worst
// case […] — they do not make it zero.
//
// impure — reads the supervisor, the /slots probe, the activity clock, and
// the lease path. Writes nothing.

import { supervisorStatus, activeLaunchConfig } from '../llama-server-supervisor.js';
import { substrateBusy } from '../substrate-lifecycle.js';
import { lastActivity } from '../substrate-idle.js';
import { readRefinementGpuLeaseHeld } from '../refinement-gpu-lease-store.js';

/** Quiet time on the substrate before a background cycle may ride it. */
export const MEDITATION_IDLE_MS = 5 * 60 * 1000;

/**
 * @param {{turnSnapshot: {localTurns: number, boundLaneIds: Set<string>}, now?: number}} input
 * @returns {Promise<{serving: boolean, owned: boolean, busy: boolean, leaseHeld: boolean,
 *   idleMs: number|null, idleLongEnough: boolean,
 *   localTurns: number, boundLaneIds: Set<string>}>}
 */
export const readPosture = async ({ turnSnapshot, now = Date.now() }) => {
  const launch = activeLaunchConfig(process.env);
  const status = await supervisorStatus(launch).catch(() => ({ serving: false, owned: false }));
  // A server we are not riding is nobody's to probe; a probe that fails reads
  // busy (substrateBusy is fail-closed by construction).
  const busy = status.serving ? await substrateBusy(launch) : true;
  const leaseHeld = await readRefinementGpuLeaseHeld();
  const activityAt = lastActivity();
  const idleMs = activityAt ? now - activityAt : null;
  return Object.freeze({
    serving: status.serving === true,
    owned: status.owned === true,
    busy,
    leaseHeld,
    idleMs,
    // A substrate with NO recorded activity is one this process never spoke
    // through — idle by definition (it is lit and unclaimed since boot).
    idleLongEnough: idleMs === null || idleMs >= MEDITATION_IDLE_MS,
    localTurns: turnSnapshot.localTurns,
    boundLaneIds: turnSnapshot.boundLaneIds,
  });
};
