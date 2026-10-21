// agenda-tasks.js — the house agenda's task and vessel sources. A dated task
// lands on every day its rhythm reaches inside the window (a daily each day, a
// custom rhythm on its weekdays, anything else on its due date). A repeating
// task has no occurrence before today (its past is not on record), and days
// after today are PROJECTED — the occurrence that will open then.
import { houseTaskRecords } from '../house-deadlines.js';
import { readVitals } from '../user-vitals.js';
import { taskDays } from './agenda-time.js';

const RECURRING = Object.freeze(['daily', 'custom']);

/**
 * Agenda items for a house's dated tasks. Pure.
 * @param {Array<object>} records - houseTaskRecords
 * @param {{days: string[]}} win
 * @param {string} today - today's day key
 */
export const taskItems = (records, win, today) => records.flatMap((r) => {
  const repeats = RECURRING.includes(r.cadence);
  return taskDays(r, win.days, today)
    .filter((day) => !repeats || day >= today)
    .map((day) => ({
      id: `task:${r.id}:${day}`, source: 'task', lane: r.laneId, title: r.title, day,
      // a block runs start → end; a deadline sits at its time
      ...(r.startTime ? { time: r.startTime, endTime: r.dueTime } : r.dueTime ? { time: r.dueTime } : {}),
      status: repeats && day > today ? 'open' : r.status,
      list: r.list,
      ...(repeats && day > today ? { projected: true } : {}),
    }));
});

/**
 * Agenda items for the operator's planned vessel work. Pure.
 * @param {Array<object>} vitals - readVitals entries
 * @param {{days: string[]}} win
 */
export const vesselItems = (vitals, win) => vitals
  .filter((v) => v?.kind === 'planned' && typeof v.scheduledFor === 'string' && win.days.includes(v.scheduledFor))
  .map((v, i) => ({ id: `vessel:${v.scheduledFor}:${i}`, source: 'vessel', lane: 'me', title: v.title || 'planned', day: v.scheduledFor }));

/** impure — the task and vessel sources for one house. */
export const taskSource = async ({ wallet, win, now, today }) => ({
  items: [
    ...taskItems(await houseTaskRecords(wallet, now), win, today),
    ...vesselItems(await readVitals(wallet).catch(() => []), win),
  ],
});
