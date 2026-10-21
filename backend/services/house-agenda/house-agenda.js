// house-agenda.js — ONE house's calendar for a window of days: everything
// scheduled for the operator, for every member of the house, for the house
// itself and for the machine (Design note, 2026-10-17: every member treated like a
// person with a calendar of their own). Read-only over each source's own
// store — nothing is scheduled here; each thing stays scheduled where it lives.
//
// Rows: 'me' (the operator), each owned lane (neuma, witness), 'house'
// (house-wide schedules with no single member), 'machine'. Items carry a local
// day, an optional time, their row and status; a coming run computed from a
// rhythm is `projected`. A loop with no phase to project is a `standing` line.
// A lane the house charter lets wake carries `wakes` — its timed tasks wake it
// at their time (house-clock/schedule-tick.js), and the quick-add says so.
// A source that cannot be read is named in `gaps` — never a silent hole.
import { createLogger } from '../logger.js';
import { ownedLanes } from '../house-deadlines.js';
import { readCharter } from '../house-clock/charter-store.js';
import { charterStanding } from '../house-clock/charter-shape.js';
import { agendaWindow, stampOf } from './agenda-time.js';
import { taskSource } from './agenda-tasks.js';
import { workSource } from './agenda-work.js';
import { houseSource } from './agenda-house.js';
import { machineSource } from './agenda-machine.js';

const log = createLogger('HouseAgenda');
const SOURCES = Object.freeze({ tasks: taskSource, work: workSource, house: houseSource, machine: machineSource });

// impure — the lanes the charter names as seats: the only ones a scheduled moment wakes. A paused
// or unapproved charter still takes their moments, held in view (schedule-tick.js); none wakes no one.
const wakingLanes = async (wallet) => {
  const charter = await readCharter(wallet);
  return new Set(charterStanding(charter) === 'none' ? [] : charter.seats.map((s) => s.laneId));
};

// a day's untimed items first, then by time
const byWhen = (a, b) => (a.day === b.day ? (a.time || '').localeCompare(b.time || '') : a.day.localeCompare(b.day));

/**
 * @param {string} wallet - the asking operator; every source is read for this house only
 * @param {{from: string, to: string}} range - YYYY-MM-DD, inclusive
 * @param {Date} [now]
 * @returns {Promise<{from: string, to: string, lanes: Array<{id: string, kind: string, name?: string, wakes?: true}>,
 *   items: Array<object>, standing: Array<object>, gaps: Array<{source: string, error: string}>}>}
 *   impure — reads every source's store.
 */
export const houseAgenda = async (wallet, { from, to }, now = new Date()) => {
  const win = agendaWindow(from, to);
  if (win.error) throw Object.assign(new Error(win.error), { status: 400 });
  const owned = await ownedLanes(wallet);
  const charterGap = [];
  const waking = await wakingLanes(wallet).catch((error) => {
    log.warn('agenda could not read the charter', { error: error.message });
    charterGap.push({ source: 'charter', error: error.message });
    return new Set();
  });
  const ctx = { wallet, win, now, today: stampOf(now.getTime()).day, owned: new Set(owned.map((l) => l.laneId)) };
  const settled = await Promise.all(Object.entries(SOURCES).map(async ([name, read]) => {
    try {
      return { name, ...(await read(ctx)) };
    } catch (error) {
      log.warn('agenda source unreadable', { source: name, error: error.message });
      return { name, error: error.message };
    }
  }));
  return {
    from: win.from,
    to: win.to,
    lanes: [
      { id: 'me', kind: 'operator' },
      ...owned.map((l) => ({ id: l.laneId, kind: l.kind, ...(l.name ? { name: l.name } : {}), ...(waking.has(l.laneId) ? { wakes: true } : {}) })),
      { id: 'house', kind: 'house' },
      { id: 'machine', kind: 'machine' },
    ],
    items: settled.flatMap((s) => s.items || []).filter((i) => win.days.includes(i.day)).sort(byWhen),
    standing: settled.flatMap((s) => s.standing || []),
    gaps: [...settled.filter((s) => s.error).map((s) => ({ source: s.name, error: s.error })), ...charterGap],
  };
};
