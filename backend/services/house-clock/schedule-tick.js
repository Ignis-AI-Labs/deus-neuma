/**
 * THE CALENDAR WAKES THE HOUSE (Design note, 2026-10-17: once the calendar works,
 * […]). Each clock tick, two
 * kinds of scheduled moment wake the member they belong to:
 *   - a member's own timed task, still open — a time block at its start, a
 *     deadline at its time (the same items the house calendar shows);
 *   - a charge reaching its due time while still open — its holder.
 *
 * Nothing is scheduled here: the moments are read from the stores the house
 * agenda reads (house-agenda/), the agenda's own task projection included.
 * Only a chartered seat wakes, never the operator's own list. A moment wakes
 * once — its ref names the occurrence, and the queue keeps every recent key.
 * Each tick looks back to the clock's LAST look at this house (the queue's
 * lastTickAt), so a moment missed while the app was closed or the machine
 * asleep still wakes its member (2026-10-18 audit: it was dropped after 30
 * minutes) — never further back than SCHEDULE_CATCHUP_MAX_MS, so a backend
 * down for days does not wake a member for last week's block.
 *
 * impure — the task, charge and charter stores.
 */
import { houseTaskRecords } from '../house-deadlines.js';
import { taskItems } from '../house-agenda/agenda-tasks.js';
import { agendaWindow, stampOf } from '../house-agenda/agenda-time.js';
import { cosDesignation } from '../staff/cos-designation.js';
import { listDispatches, OPEN_DISPATCH_STATUSES } from '../staff/dispatch-store.js';
import { servesLane } from '../house-served.js';
import { readCharter } from './charter-store.js';
import { charterStanding, charterSeat } from './charter-shape.js';
import { enqueueWake, readLastTick, stampTick } from './wake-queue.js';

/** How long after its moment a scheduled item may still wake its member, whenever the clock last looked. */
export const SCHEDULE_LOOKBACK_MS = 30 * 60_000;
/** The furthest back a tick looks for moments it missed while the clock was not running. */
export const SCHEDULE_CATCHUP_MAX_MS = 12 * 3_600_000;

// the task statuses still owed (house-deadlines.js LIVE)
const OWED = Object.freeze(['open', 'active']);

// pure — the local instant a day key and an HH:MM name
const atOf = (day, time) => {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
};

/**
 * How far back one tick looks: to the clock's last look, never less than the
 * fresh window, never more than the catch-up cap. Pure.
 * @param {number} now - epoch ms
 * @param {?number} lastTickAt - epoch ms of the clock's last look, null before its first
 * @returns {number} ms
 */
export const lookbackFor = (now, lastTickAt) => Math.max(
  SCHEDULE_LOOKBACK_MS,
  Math.min(Number.isFinite(lastTickAt) ? now - lastTickAt : 0, SCHEDULE_CATCHUP_MAX_MS),
);

/**
 * The scheduled moments that fell due in (now - lookback, now], as wake
 * signals. Pure.
 * @param {{tasks: Object[], charges: Object[], charter: Object, now: number, lookbackMs?: number}} args -
 *   tasks: agenda task items (taskItems); charges: the Optio's drawer
 * @returns {Array<{seat: string, reason: 'scheduled'|'charge-due', ref: string, detail: Object}>}
 */
export const dueScheduled = ({ tasks, charges, charter, now, lookbackMs = SCHEDULE_LOOKBACK_MS }) => {
  const fresh = (ms) => Number.isFinite(ms) && ms <= now && ms > now - lookbackMs;
  const seated = (lane) => Boolean(lane && charterSeat(charter, lane));
  const wakes = [];
  for (const t of tasks) {
    if (!t.time || t.projected || !OWED.includes(t.status) || !seated(t.lane) || !fresh(atOf(t.day, t.time))) continue;
    wakes.push({
      seat: t.lane, reason: 'scheduled', ref: `${t.id}@${t.time}`,
      detail: { title: t.title, day: t.day, time: t.time, endTime: t.endTime ?? null },
    });
  }
  for (const c of charges) {
    if (!OPEN_DISPATCH_STATUSES.includes(c.status) || !seated(c.to) || !fresh(Date.parse(c.dueAt))) continue;
    wakes.push({ seat: c.to, reason: 'charge-due', ref: `${c.id}@${c.dueAt}`, detail: { id: c.id, title: c.title, from: c.from, dueAt: c.dueAt } });
  }
  return wakes;
};

/**
 * One house's scheduled moments, offered to its queue. impure.
 * @param {string} wallet
 * @param {number} now - epoch ms
 */
export const scheduleTick = async (wallet, now) => {
  const charter = await readCharter(wallet);
  // A paused or unapproved charter still takes its moments, held in view until RESUME / APPROVE (wake-gate.js).
  if (charterStanding(charter) === 'none') return [];
  const lookbackMs = lookbackFor(now, await readLastTick(wallet));
  const today = stampOf(now).day;
  const win = agendaWindow(stampOf(now - lookbackMs).day, today);
  const tasks = taskItems(await houseTaskRecords(wallet, new Date(now)), win, today);
  const officer = await cosDesignation.getOfficer(wallet).catch(() => null);
  const charges = officer?.laneId ? await listDispatches(officer.laneId).catch(() => []) : [];
  const taken = [];
  for (const wake of dueScheduled({ tasks, charges, charter, now, lookbackMs })) {
    if (await servesLane(wake.seat, wallet)) taken.push(await enqueueWake(wallet, wake));
  }
  // stamped once its moments are taken: a tick that failed partway is looked over again by the next
  await stampTick(wallet, now);
  return taken;
};
