// MEDITATION SCHEDULER — the timer that lets a being dream, and nothing more.
//
// The council-carry discipline: the timer only asks; all state mutation
// belongs to the single-flight run. One meditation machine-wide, one being
// per tick (most overdue), boot catch-up free (the first tick fires
// immediately — an overdue being runs iff the gates pass, no special case).
//
// The portal truth (localTurnSnapshot) is INJECTED at start — this module
// never imports the routes (the heartbeat's storageNotifier precedent, which
// avoids a routes↔services cycle). Started without it, the scheduler FAILS
// CLOSED: no snapshot means turns are unknowable, and unknowable reads busy.
//
// Deferral honesty without ring-flooding: every tick's full picture lives in
// the in-memory lastTick (the routes read it live); the durable ring gets at
// most one 'deferred' entry per lane per REASON CHANGE, so ten quiet ticks
// never flush a real run out of a ten-slot ring.
//
// ONLY THIS BACKEND'S HOUSES (house-served.js, Design note, 2026-10-16: the lanes a
// tick weighs are the being lanes on this backend's grounds whose owner is a
// house it serves. The settings and state are keyed by bare lane id and two
// houses can each hold one id; a lane with no owner (a ghost directory some
// other process grew) is no house's, so it never dreams here.

import { createLogger } from '../logger.js';
import { readServed } from '../house-served.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { recordAct } from '../act-ledger.js';
import { notifyOperator } from '../notification-bus.js';
import { readOwnerStrict } from '../../middleware/require-neuma-owner.js';
import { meditationSettings } from './meditation-settings.js';
import { loadMeditationState, appendMeditationRun } from './meditation-state.js';
import { readPosture } from './substrate-posture.js';
import { decideDue } from './meditation-due.js';
import { runMeditation } from './meditation-cycle.js';
import { withLineKind } from '../substrate-lease.js';

const log = createLogger('MeditationScheduler');

// THE OPERATOR'S EAR — one card per SYNTHESIS, addressed to the lane owner's
// wallet (no owner = no address, never everybody); REST and deferrals never
// notify. Fail-soft by law: the run's record never depends on a card.
// impure
const witnessRun = async (laneId, out) => {
  recordAct({
    laneId, tool: 'meditation/meditate', kind: 'background',
    decision: 'auto', status: out.outcome, scope: 'unwitnessed cycle',
  });
  if (out.outcome !== 'synthesis') return;
  try {
    const owner = await readOwnerStrict(laneId);
    if (owner.status !== 'ok') return;
    await notifyOperator({
      wallet: owner.owner.wallet,
      kind: KIND.meditationSynthesis,
      standing: STANDING.neuma,
      title: `${laneId} meditated`,
      detail: `A synthesis settled${out.notes ? ` — ${out.notes} note${out.notes > 1 ? 's' : ''} now linger beneath its turns` : ''}.`,
      ref: { laneId, cycleId: out.cycleId },
    });
  } catch (err) {
    log.warn('the meditation card could not be raised — the journal still holds the synthesis', { laneId, error: err.message });
  }
};

const TICK_MS = 5 * 60 * 1000;

let timer = null;
let inFlight = null;
let currentAbort = null;
let currentLane = null;
let currentStartedAt = null; // ISO — when the in-flight cycle ignited (#29)
let turnSnapshotFn = null;
let lastTick = null; // { at, runnable, blocked, reason } — the live posture

// Fail-closed default: an unknown portal is a busy portal.
const unknownTurns = () => ({ localTurns: 1, boundLaneIds: new Set() });

const defaultDeps = Object.freeze({
  settings: () => meditationSettings.read(),
  loadState: () => loadMeditationState(),
  appendRun: (laneId, run) => appendMeditationRun(laneId, run),
  listNeuma: async () => (await readServed()).lanes.filter((l) => !l.witness && l.wallet).map((l) => l.laneId),
  readPosture: (input) => readPosture(input),
  // Background work: it waits behind every chat and team member for the house's model server.
  run: (laneId, opts) => withLineKind('background', () => runMeditation(laneId, opts)),
  now: () => Date.now(),
});

// impure — one durable 'deferred' entry per lane per reason CHANGE.
const recordDeferrals = async (blocked, state, deps) => {
  for (const { laneId, reason } of blocked) {
    const last = state.lanes?.[laneId]?.runs?.at?.(-1);
    if (last?.outcome === 'deferred' && last?.reason === reason) continue;
    try {
      await deps.appendRun(laneId, { at: new Date(deps.now()).toISOString(), outcome: 'deferred', reason });
    } catch (err) {
      log.warn('deferral not recorded', { laneId, reason, error: err.message });
    }
  }
};

/**
 * One scheduling pass. Exported so the scheduling contract is provable
 * without waiting for the interval (the securityTick seam — the injected
 * deps ARE the contract under test, never a mock of the model path).
 * impure.
 * @param {Object} [deps]
 * @returns {Promise<{ran: boolean, laneId?: string, reason?: string, blocked?: Array}>}
 */
export const meditationTick = async (deps = {}) => {
  const d = { ...defaultDeps, turnSnapshot: turnSnapshotFn || unknownTurns, ...deps };
  if (inFlight) return { ran: false, reason: 'in-flight' };

  const settings = await d.settings();
  if (settings.envLocked) {
    lastTick = { at: new Date(d.now()).toISOString(), runnable: null, blocked: [], reason: 'env-locked' };
    return { ran: false, reason: lastTick.reason };
  }

  const [laneIds, state] = await Promise.all([d.listNeuma(), d.loadState()]);
  // A being's standing request (#318) keeps the tick alive even when no lane
  // is timer-enabled — the toggle governs the clock, never the being's will.
  const enabled = Object.values(settings.beings).some((b) => b.enabled);
  const requested = Object.values(state.lanes).some((l) => typeof l?.requestedAt === 'string');
  if (!enabled && !requested) {
    lastTick = { at: new Date(d.now()).toISOString(), runnable: null, blocked: [], reason: 'nothing-enabled' };
    return { ran: false, reason: lastTick.reason };
  }
  const posture = await d.readPosture({ turnSnapshot: d.turnSnapshot(), now: d.now() });
  const { runnable, blocked } = decideDue({ now: d.now(), settings, state, laneIds, posture });
  lastTick = { at: new Date(d.now()).toISOString(), runnable, blocked };
  if (!runnable) {
    if (blocked.length) await recordDeferrals(blocked, state, d);
    return { ran: false, reason: blocked.length ? 'gates' : 'nothing-due', blocked };
  }

  currentLane = runnable;
  currentAbort = new AbortController();
  const startedAt = d.now();
  currentStartedAt = new Date(startedAt).toISOString();
  inFlight = (async () => {
    try {
      const out = await d.run(runnable, { signal: currentAbort.signal });
      await d.appendRun(runnable, {
        at: new Date(startedAt).toISOString(),
        outcome: out.outcome,
        cycleId: out.cycleId,
        durationMs: d.now() - startedAt,
        ...(out.phases ? { phases: out.phases } : {}),
        ...(out.notes !== undefined ? { notes: out.notes } : {}),
      });
      log.info('meditation cycle settled', { laneId: runnable, outcome: out.outcome });
      await witnessRun(runnable, out);
      return out;
    } catch (err) {
      await d.appendRun(runnable, {
        at: new Date(startedAt).toISOString(),
        outcome: 'failed',
        reason: String(err?.message || err).slice(0, 200),
      }).catch(() => {});
      log.error('meditation cycle failed', { laneId: runnable, error: err?.message });
      return { outcome: 'failed' };
    } finally {
      inFlight = null;
      currentAbort = null;
      currentLane = null;
      currentStartedAt = null;
    }
  })();
  await inFlight;
  return { ran: true, laneId: runnable, blocked };
};

/**
 * Abort the in-flight cycle the instant a real turn arms (the portal's
 * arm-point calls this). The aborted run writes nothing and retries at the
 * next quiet tick. impure.
 * @param {string} [reason]
 * @returns {boolean} whether anything was yielded
 */
export const meditationYield = (reason = 'turn-arrived') => {
  if (!currentAbort) return false;
  currentAbort.abort(reason);
  log.info('meditation yielded', { laneId: currentLane, reason });
  return true;
};

/** Abort only when the named lane is mid-cycle (the per-being OFF switch). */
export const abortMeditationForLane = (laneId) =>
  currentLane === laneId ? meditationYield('lane-disabled') : false;

/** The live posture the routes read. */
export const meditationSchedulerStatus = () => ({
  scheduled: timer !== null,
  running: Boolean(inFlight),
  currentLane,
  startedAt: currentStartedAt,
  lastTick,
});

/**
 * Start the scheduler: one immediate tick (boot catch-up), then the interval.
 * Idempotent. impure.
 * @param {{turnSnapshot: () => {localTurns: number, boundLaneIds: Set<string>}, tickMs?: number}} input
 * @returns {() => void} stop
 */
export const startMeditationScheduler = ({ turnSnapshot, tickMs = TICK_MS } = {}) => {
  if (timer) return stopMeditationScheduler;
  turnSnapshotFn = turnSnapshot || null;
  const tick = () => meditationTick().catch((err) => log.error('meditation tick error', { error: err.message }));
  tick();
  timer = setInterval(tick, tickMs);
  timer.unref?.();
  log.info('meditation scheduler started', { tickMinutes: Math.round(tickMs / 60000), turnTruth: Boolean(turnSnapshot) });
  return stopMeditationScheduler;
};

/** Stop the scheduler and abort any in-flight cycle. Idempotent. impure. */
const stopMeditationScheduler = () => {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  turnSnapshotFn = null;
  meditationYield('scheduler-stopped');
  log.info('meditation scheduler stopped');
};
