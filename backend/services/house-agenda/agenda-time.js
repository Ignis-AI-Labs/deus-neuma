// agenda-time.js — the house agenda's clock arithmetic. Pure.
//
// Times are read on the operator's own machine, where the server runs (the
// same basis as task deadlines and recurrence, core/time/day-key.js): an item
// carries a local `day` (YYYY-MM-DD) and, when it has one, a local `time`
// (HH:MM) — the same keys the desk's month grid groups by. A window is at
// most AGENDA_MAX_DAYS long.

export const AGENDA_MAX_DAYS = 62;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');

/** A local YYYY-MM-DD for a Date. */
const dayKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The local midnight a day key names, in ms. */
const midnightOf = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

/**
 * A validated window: from/to day keys (inclusive), as local ms bounds.
 * @returns {{from: string, to: string, fromMs: number, toMs: number, days: string[]} | {error: string}}
 */
export const agendaWindow = (from, to) => {
  if (!DAY_KEY.test(String(from)) || !DAY_KEY.test(String(to))) return { error: 'from and to must be YYYY-MM-DD' };
  const fromMs = midnightOf(from);
  const endMs = midnightOf(to);
  if (!(endMs >= fromMs)) return { error: 'to must not come before from' };
  const days = [];
  for (let d = new Date(fromMs); d.getTime() <= endMs; d.setDate(d.getDate() + 1)) {
    days.push(dayKeyOf(d));
    if (days.length > AGENDA_MAX_DAYS) return { error: `a window is at most ${AGENDA_MAX_DAYS} days` };
  }
  const last = new Date(endMs);
  last.setDate(last.getDate() + 1);
  return { from, to, fromMs, toMs: last.getTime() - 1, days };
};

/** A local instant as {day, time}. */
export const stampOf = (ms) => {
  const d = new Date(ms);
  return { day: dayKeyOf(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};

/**
 * Every run of a fixed rhythm inside [fromMs, toMs]: `firstMs`, then every
 * `everyMs` after it. Bounded by `max` so a mis-set rhythm cannot flood.
 * @returns {number[]}
 */
export const runsBetween = ({ firstMs, everyMs, fromMs, toMs, max = 120 }) => {
  if (!Number.isFinite(firstMs) || !(everyMs > 0)) return [];
  const skip = firstMs < fromMs ? Math.ceil((fromMs - firstMs) / everyMs) : 0;
  const out = [];
  for (let at = firstMs + skip * everyMs; at <= toMs && out.length < max; at += everyMs) out.push(at);
  return out;
};

/**
 * The days of the window a task's rhythm puts it on: a daily every day, a
 * custom rhythm on its weekdays (0 = Sunday), anything else on its own due
 * date — or, carrying only a time, on today.
 * @param {{cadence?: string, days?: number[], dueDate?: string}} task
 * @param {string[]} days - the window's day keys
 * @param {string} today - today's day key
 */
export const taskDays = (task, days, today) => {
  if (task.cadence === 'daily') return days;
  if (task.cadence === 'custom' && Array.isArray(task.days)) {
    return days.filter((key) => task.days.includes(new Date(midnightOf(key)).getDay()));
  }
  const on = task.dueDate || today;
  return days.includes(on) ? [on] : [];
};

/** How a standing rhythm reads: "every minute", "every 10 min", "every 6 h". */
export const everyLabel = (ms) => {
  const min = Math.round(ms / 60_000);
  if (min <= 1) return 'every minute';
  if (min < 60) return `every ${min} min`;
  const h = min / 60;
  return `every ${Number.isInteger(h) ? h : h.toFixed(1)} h`;
};
