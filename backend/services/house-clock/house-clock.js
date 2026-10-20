/**
 * THE HOUSE CLOCK — the house wakes itself for its own work (ruling, 2026-10-16),
 * a scheduler leg beside the post, security and status schedulers.
 *
 * Until now […]
 * (staff/status-sweep.js): a post, a charge, a check-in or a finished run
 * waited for the operator to open a chat. The clock is event-first:
 *   - every producer's signal (wake-signal.js) is resolved to its house — the
 *     seat's owner wallet — and offered to that house's queue;
 *   - THE OPTIO'S CADENCE: each tick, a house whose charter sets a cadence
 *     wakes its seated Optio once per cadence window;
 *   - THE CALENDAR (schedule-tick.js): each tick, a member's own timed task
 *     and a charge reaching its due time wake the member they belong to;
 *   - AT BOOT, a team run LOST to the restart, led by a chartered seat, wakes
 *     its lead to decide whether to pick it up;
 *   - a paused or unapproved charter takes every signal and moment, held in
 *     view until RESUME / APPROVE; only the cadence waits for an active one;
 *   - each tick also moves every house's queue, so a wake held by quiet hours
 *     or a spent cap runs once it may.
 *
 * The meditation law is kept: reflection never wakes the model; only work does.
 *
 * ONLY THE HOUSES THIS BACKEND SERVES (house-served.js, Design note, 2026-10-16: two
 * houses on one machine are never confused). Two desks share one realm, so
 * every chartered house is visible to both; each ticks, recovers and wakes
 * only the houses whose lanes it holds, and a seat is resolved to its house
 * only on this backend's own grounds.
 *
 * impure — timers, the realm, the designation store, the run store.
 */
import fs from 'fs/promises';
import path from 'path';
import { getRealmRoot, walletDir } from '../user-realm.js';
import { cosDesignation } from '../staff/cos-designation.js';
import { listRuns } from '../team-run-store.js';
import { createLogger } from '../logger.js';
import { readCharter } from './charter-store.js';
import { charterStanding, charterSeat } from './charter-shape.js';
import { setWakeSink } from './wake-signal.js';
import { enqueueWake, pumpHouse, configureWakeQueue } from './wake-queue.js';
import { cadenceSlot } from './wake-gate.js';
import { readServed, servesLane, servesWallet } from '../house-served.js';
import { scheduleTick } from './schedule-tick.js';

const log = createLogger('HouseClock');

/** How often the clock looks: cadence, held wakes. */
export const CLOCK_TICK_MS = 60_000;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
// The span one hour of a charter's cadence lasts — an hour, save in a flight check.
let cadenceUnitMs = HOUR_MS;

// pure — an integer env value at or above `min`, else null
const knob = (raw, min) => {
  const n = /^\d+$/.test(String(raw ?? '').trim()) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n >= min ? n : null;
};

/**
 * THE FLIGHT CHECK'S KNOBS (the house flight check, ruling 2026-10-17:
 * […]):
 * time compressed for a flight, read once at boot, never set in production.
 * Unset, every value is the production one and the queue keeps its own settle.
 * Pure.
 * @param {Object} env - HOUSE_CLOCK_TICK_MS, HOUSE_WAKE_SETTLE_MS, HOUSE_WAKE_RETRY_MS, HOUSE_FLIGHT_CADENCE_UNIT ('minute')
 * @returns {{tickMs: number, settleMs: ?number, retryMs: ?number, cadenceUnitMs: number}}
 */
export const clockKnobs = (env = {}) => ({
  tickMs: knob(env.HOUSE_CLOCK_TICK_MS, 1) ?? CLOCK_TICK_MS,
  settleMs: knob(env.HOUSE_WAKE_SETTLE_MS, 0),
  retryMs: knob(env.HOUSE_WAKE_RETRY_MS, 0),
  cadenceUnitMs: env.HOUSE_FLIGHT_CADENCE_UNIT === 'minute' ? MINUTE_MS : HOUR_MS,
});

const WALLET = /^0x[a-f0-9]{40}$/;

/**
 * One signal, offered to its seat's house — the house that owns the seat on
 * THIS backend's grounds. impure.
 * @param {{seat: string, reason: string, ref: string, detail?: Object, depth?: number, cause?: ?string}} signal
 */
export const takeSignal = async (signal) => {
  const wallet = await servesLane(signal.seat);
  if (!wallet) return { queued: false, why: `${signal.seat} belongs to no house this backend serves` };
  return enqueueWake(wallet, signal);
};

// impure — every house this backend serves that has written a charter
const charteredHouses = async () => {
  let names;
  try {
    names = await fs.readdir(getRealmRoot());
  } catch {
    return [];
  }
  const { houses: served } = await readServed();
  const houses = [];
  for (const name of names.filter((n) => WALLET.test(n) && served.includes(n))) {
    const has = await fs.access(path.join(walletDir(name), 'house-charter.json')).then(() => true, () => false);
    if (has) houses.push(name);
  }
  return houses;
};

/**
 * THE OPTIO'S CADENCE for one house. impure. The window index is the ref, so
 * one window wakes the Optio once however often the clock looks.
 * @param {string} wallet
 * @param {number} now - epoch ms
 */
export const cadenceTick = async (wallet, now) => {
  const charter = await readCharter(wallet);
  if (charterStanding(charter) !== 'active' || !charter.cadence) return null;
  const officer = await cosDesignation.getOfficer(wallet).catch(() => null);
  if (!officer?.laneId || !charterSeat(charter, officer.laneId)) return null;
  if (!(await servesLane(officer.laneId, wallet))) return null;
  const windowMs = charter.cadence.everyHours * cadenceUnitMs;
  const slot = cadenceSlot(now, windowMs);
  return enqueueWake(wallet, {
    seat: officer.laneId,
    reason: 'cadence',
    ref: `every-${charter.cadence.everyHours}${cadenceUnitMs === HOUR_MS ? 'h' : 'm'}-${slot}`,
    detail: { everyHours: charter.cadence.everyHours },
  });
};

/**
 * AT BOOT: a team run lost to the restart wakes its lead to decide. impure.
 * @param {string} wallet
 */
export const lostRunsTick = async (wallet) => {
  if (!(await servesWallet(wallet))) return [];
  const charter = await readCharter(wallet);
  // A paused or unapproved charter still takes it, held in view until RESUME / APPROVE (wake-gate.js).
  if (charterStanding(charter) === 'none') return [];
  const lost = (await listRuns(wallet)).filter((r) => r.status === 'lost' && r.lane === 'lead'
    && r.lead?.neumaId && charterSeat(charter, r.lead.neumaId));
  const taken = [];
  for (const run of lost) {
    taken.push(await enqueueWake(wallet, {
      seat: run.lead.neumaId,
      reason: 'run-lost',
      ref: run.id,
      detail: { runId: run.id, name: run.name ?? null, completed: run.completed, steps: run.steps },
    }));
  }
  return taken;
};

/** One look over every chartered house this backend serves: its cadence, then its queue. impure, never throws. */
export const clockTick = async (now = Date.now()) => {
  for (const wallet of await charteredHouses()) {
    await cadenceTick(wallet, now).catch((err) => log.warn('cadence tick failed', { error: err.message }));
    await scheduleTick(wallet, now).catch((err) => log.warn('schedule tick failed', { error: err.message }));
    await pumpHouse(wallet, now).catch((err) => log.warn('the wake queue could not move', { error: err.message }));
  }
};

/**
 * Stand the clock up: take signals, recover lost runs once, look every tick.
 * The flight knobs are read here, once (clockKnobs). The interval is unref'd
 * so it cannot hold the process open. impure.
 * @returns {() => void} stop
 */
export const startHouseClock = ({ intervalMs } = {}) => {
  const knobs = clockKnobs(process.env);
  const everyMs = intervalMs ?? knobs.tickMs;
  cadenceUnitMs = knobs.cadenceUnitMs;
  configureWakeQueue({ settleMs: knobs.settleMs ?? undefined, retryMs: knobs.retryMs ?? undefined });
  setWakeSink(takeSignal);
  charteredHouses()
    .then(async (houses) => { for (const w of houses) await lostRunsTick(w); })
    .catch((err) => log.warn('lost-run recovery failed', { error: err.message }))
    .finally(() => clockTick().catch(() => {}));
  const timer = setInterval(() => {
    clockTick().catch((err) => log.error('house clock tick failed', { error: err.message }));
  }, everyMs);
  timer.unref?.();
  log.info('house clock standing', { everyMs });
  return () => {
    clearInterval(timer);
    setWakeSink(null);
  };
};
