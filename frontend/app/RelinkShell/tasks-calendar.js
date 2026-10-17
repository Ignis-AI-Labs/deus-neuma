// tasks-calendar.js — the TASKS calendar's read model: deadline records in
// (GET /api/v1/tasks/deadlines), month counts and day views out. Pure
// throughout — the impure caller (TasksCalendarApp.jsx) fetches.
//
// The desk's third adapter over the shared month-grid leaf (queue, vessel,
// now tasks): this module brings only its own day-join and count taxonomy.
//
// The day-join law: an EXPLICIT dueDate pins the record to that day — that
// is what a deadline means. A bare dueTime on recurring work (a daily owed
// "by 18:00") is due TODAY by the deadline leaf's own law, so it joins
// TODAY's cell and today's day view only — putting a daily on every future
// day would turn the month grid into noise.

import { dayKeyOf } from './month-grid.js';
import { dueInstantOf } from '../../../core/tasks/deadline.js';

/**
 * The local day a deadline record belongs to, or null. Pure.
 * @param {{dueDate?: string, dueTime?: string}} record
 * @param {Date} [now]
 */
export const taskDayOfEntry = (record, now = new Date()) => {
  if (!record) return null;
  if (record.dueDate) return record.dueDate;
  if (record.dueTime) return dayKeyOf(now);
  return null;
};

/**
 * The count taxonomy for buildMonthGrid: T tasks due, O overdue. Pure.
 */
export const taskCountSpec = Object.freeze({
  empty: Object.freeze({ T: 0, O: 0 }),
  count: (counts, entry) => {
    counts.T += 1;
    if (entry.overdue) counts.O += 1;
  },
});

/**
 * The cell's count lanes, in render order: O speaks first — the overdue mark
 * is the one thing a scanning month must not hide. Pure.
 */
export const taskCountLanes = Object.freeze([
  { key: 'O', letter: 'O', tone: 'missed', label: (n) => `${n} overdue` },
  { key: 'T', letter: 'T', tone: 'live', label: (n) => `${n} due` },
]);

/**
 * One day's due list, overdue first, then by moment. Pure.
 * @param {Array<{id: string, source: string, title: string, dueDate?: string,
 *   dueTime?: string}>} deadlines
 * @param {string} dayKey 'YYYY-MM-DD'
 * @param {Date} [now]
 */
export const taskDayView = (deadlines, dayKey, now = new Date()) =>
  (deadlines || [])
    .filter((r) => taskDayOfEntry(r, now) === dayKey)
    .map((r) => {
      const at = dueInstantOf(r, now);
      const overdue = Boolean(at) && now.getTime() > at.getTime();
      return { ...r, overdue, at: at ? at.getTime() : Number.MAX_SAFE_INTEGER };
    })
    .sort((a, b) => (a.overdue === b.overdue ? a.at - b.at : a.overdue ? -1 : 1));

/**
 * The house total the header shows: how much is due, how much overdue. Pure.
 */
export const taskTotals = (deadlines, now = new Date()) => {
  const today = dayKeyOf(now);
  const dueToday = taskDayView(deadlines, today, now);
  const overdue = (deadlines || []).filter((r) => {
    const at = dueInstantOf(r, now);
    return at && now.getTime() > at.getTime() && (r.dueDate || '') <= today;
  });
  return { dueToday: dueToday.length, overdue: overdue.length };
};

/**
 * The lane filter rail over the house's records: the three standings (ME,
 * HOUSE, WITNESSES) with counts, plus one entry per lane. Pure.
 * @param {Array<{laneId: string, kind: 'operator'|'neuma'|'witness',
 *   laneName?: string}>} records
 * @returns {{me: number, house: number, witnesses: number,
 *   lanes: Array<{laneId: string, kind: string, name: string, count: number}>}}
 */
export const calendarLaneOptions = (records) => {
  let me = 0; let house = 0; let witnesses = 0;
  const lanes = new Map();
  for (const r of records || []) {
    if (r.kind === 'operator') { me += 1; continue; }
    const entry = lanes.get(r.laneId)
      || { laneId: r.laneId, kind: r.kind, name: r.laneName || r.laneId, count: 0 };
    entry.count += 1;
    if (r.kind === 'neuma') house += 1;
    else witnesses += 1;
    lanes.set(r.laneId, entry);
  }
  return { me, house, witnesses, lanes: [...lanes.values()] };
};

/**
 * The records one filter admits: 'all' | 'me' | 'house' | 'witnesses' | a
 * laneId. Unknown filters read as ALL — never as an empty lie. Pure.
 * @param {Array<object>} records
 * @param {string} [filter]
 */
export const filterByLane = (records, filter) => {
  const all = records || [];
  if (!filter || filter === 'all') return all;
  if (filter === 'me') return all.filter((r) => r.kind === 'operator');
  if (filter === 'house') return all.filter((r) => r.kind === 'neuma');
  if (filter === 'witnesses') return all.filter((r) => r.kind === 'witness');
  // A laneId only if some record carries it; an unknown filter is ALL,
  // never an empty lie.
  const known = all.some((r) => r.laneId === filter);
  return known ? all.filter((r) => r.laneId === filter) : all;
};
