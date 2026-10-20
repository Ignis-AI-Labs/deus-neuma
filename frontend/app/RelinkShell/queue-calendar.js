// queue-calendar.js — the campaigns board's calendar half: day grouping and
// the month grid. Pure throughout. THE QUEUE ADAPTER (F4, 2026-08-31): the
// grid math, padding law, and today mark live in the domain-free leaf
// month-grid.js; this file is the queue's day-join (the thread's day) and its
// Q/A/U/W/S/F/R count taxonomy wired over it. The exports and their
// signatures are unchanged — campaigns-helpers.js re-exports everything here
// so readers and path-pinned tests hold.

import { dayKeyOf, buildMonthGrid as buildGrid } from './month-grid.js';

export { shiftDayKey } from './month-grid.js';

/**
 * Group queue entries into calendar days: entries with a scheduledFor fall
 * under their day (ascending, earliest first), everything unscheduled lands
 * in one trailing UNSCHEDULED group. Within a day, entries sort by time.
 * @param {Array<object>} entries queue entries (scheduledFor ISO string|null)
 * @returns {Array<{key: string|null, label: string, entries: Array<object>}>}
 */
// pure
export const groupQueueByDay = (entries) => {
  const days = new Map();
  const unscheduled = [];
  for (const entry of entries) {
    if (!entry.scheduledFor) {
      unscheduled.push(entry);
      continue;
    }
    const key = dayKeyOf(entry.scheduledFor);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(entry);
  }
  const byTime = (a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor);
  const groups = [...days.keys()].sort().map((key) => ({
    key,
    label: new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    }),
    entries: days.get(key).sort(byTime),
  }));
  if (unscheduled.length > 0) {
    groups.push({ key: null, label: 'UNSCHEDULED', entries: unscheduled });
  }
  return groups;
};

// THE MONTH GRID (ruling, 2026-07-28): […] The grid is the board's NAVIGATOR — a month at a glance,
// each day carrying only the counts that decide whether it is worth opening.
// The day doctrine is groupQueueByDay's: an entry belongs to its slot's day,
// and the unscheduled belong to no day — they are NOT in the grid, the
// UNSCHEDULED bucket beside it is where they live.

// pure — the calendar day an entry belongs to: its slot's day, or null when
// it has no slot. An unparseable slot is no slot — a day the grid cannot
// name is a day it must not guess. THE THREAD'S DAY (Kagipem 2026-07-29):
// a self-reply carries no slot of its own — its day IS its parent's day,
// because its whole schedule is the parent's event; a parentless thread
// entry belongs to no day (the orphan cascade owns it).
export const queueDayKey = (entry, byId = null) => {
  if (entry?.kind === 'self-reply' && byId) {
    const parent = byId.get(entry.thread?.parentId);
    return parent ? queueDayKey(parent, byId) : null;
  }
  const t = Date.parse(entry?.scheduledFor || '');
  return Number.isNaN(t) ? null : dayKeyOf(entry.scheduledFor);
};

// pure — id → entry, for the thread's day join.
export const queueById = (entries) => new Map((entries || []).map((e) => [e.id, e]));

/**
 * The entries belonging to one calendar day. `dayKey` null selects exactly
 * the unscheduled — the bucket is a day view like any other, it just has no
 * date. Matching is exact: an entry counts for its own day and no other.
 * @param {Array<object>} entries
 * @param {string|null} dayKey 'YYYY-MM-DD' or null
 * @returns {Array<object>}
 */
// pure
export const filterQueueToDay = (entries, dayKey) => {
  const byId = queueById(entries);
  return (entries || []).filter((e) => queueDayKey(e, byId) === dayKey);
};

// The day's counts, LETTER-CODED (Design note, 2026-07-28: […]):
// Q awaiting decision, A approved (sends on its own), U unapproved, W
// withdrawn, S sent, F failed — and R replies, counted ONLY as replies
// whatever their standing (the lanes' own doctrine: engagement is its own
// question on the month). Every other entry counts exactly once, so the
// letters sum to the day's scheduled total; a standing nobody has named yet
// counts with A rather than dropping, the lanes' answer to a stranger.
const countInto = (counts, entry) => {
  if (entry?.kind === 'reply') { counts.R += 1; return; }
  switch (String(entry?.status || '')) {
    case 'draft': counts.Q += 1; return;
    case 'rejected': counts.U += 1; return;
    case 'withdrawn': counts.W += 1; return;
    case 'sent': counts.S += 1; return;
    case 'failed': counts.F += 1; return;
    default: counts.A += 1;
  }
};

// The queue's count taxonomy over the generic grid: the quiet day's counts —
// frozen, so every empty cell can share the one — and the fold above.
const QUEUE_COUNT_SPEC = Object.freeze({
  empty: Object.freeze({ Q: 0, A: 0, U: 0, W: 0, S: 0, F: 0, R: 0 }),
  count: countInto,
});

/**
 * The 6-week Mon-first matrix for one month of the queue. Every cell is
 * `{ date, key, today, counts }`; `date`/`key` are null on the padding cells
 * that belong to the neighbouring months, so the grid is always 6×7 and never
 * shifts height between months. `counts` sums each scheduled entry exactly
 * once; the unscheduled are nobody's day and appear nowhere in it. The grid
 * itself is month-grid.js's — this is the queue's day-join and letters over it.
 *
 * @param {number} year full year (2026)
 * @param {number} monthIndex 0-based month (0 = January)
 * @param {Array<object>} entries queue entries (already scoped to the board)
 * @param {{now?: number}} [options] injectable clock (ms) for `today`
 * @returns {Array<Array<{date: number|null, key: string|null, today: boolean, counts: object}>>} 6 rows of 7
 */
// pure
export const buildMonthGrid = (year, monthIndex, entries, { now = Date.now() } = {}) => {
  const byId = queueById(entries);
  return buildGrid(year, monthIndex, entries, {
    now,
    dayKeyOfEntry: (entry) => queueDayKey(entry, byId),
    countSpec: QUEUE_COUNT_SPEC,
  });
};
