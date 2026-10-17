// month-grid.js — the generic 6×7 Mon-first month matrix, domain-free. Pure
// throughout. THE LEAF: it imports nothing from queue-calendar.js or
// campaigns-helpers.js — the dependency flows leaf ← family, and the queue
// calendar (queue-calendar.js) is one adapter over this grid; the vessel
// calendar (Wave-3) will be another. Split from queue-calendar.js for F4 so
// the grid math, the padding law, and the today mark are written once and
// every domain brings only its own day-join and count taxonomy.

// pure — the local calendar day a timestamp falls on, as a sortable key.
export const dayKeyOf = (iso) => {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

// pure — the day one step before or after, in the same 'YYYY-MM-DD' register.
// Local-midnight arithmetic: the grid's days ARE local days, so the walk must
// never round-trip through UTC (a toISOString hop can land on the wrong day).
export const shiftDayKey = (dayKey, delta) => {
  const d = new Date(`${dayKey}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return dayKeyOf(d);
};

/**
 * The 6-week Mon-first matrix for one month, over ANY entry domain. Every
 * cell is `{ date, key, today, counts }`; `date`/`key` are null on the
 * padding cells that belong to the neighbouring months, so the grid is
 * always 6×7 and never shifts height between months. `counts` sums each
 * day-bound entry exactly once per the domain's own taxonomy; an entry
 * `dayKeyOfEntry` names no day for appears nowhere in the grid.
 *
 * @param {number} year full year (2026)
 * @param {number} monthIndex 0-based month (0 = January)
 * @param {Array<object>} entries the domain's entries (already scoped)
 * @param {object} options
 * @param {number} [options.now] injectable clock (ms) for `today`
 * @param {(entry: object) => string|null} options.dayKeyOfEntry the domain's
 *   day-join: the 'YYYY-MM-DD' local day an entry belongs to, or null when
 *   it belongs to no day (the grid must never guess a day it cannot name)
 * @param {{empty: object, count: (counts: object, entry: object) => void}} options.countSpec
 *   the count taxonomy: `empty` is the frozen quiet-day counts object (every
 *   empty cell shares the one; each counted day starts from a spread of it),
 *   `count` folds one entry into a day's counts
 * @returns {Array<Array<{date: number|null, key: string|null, today: boolean, counts: object}>>} 6 rows of 7
 */
// pure
export const buildMonthGrid = (year, monthIndex, entries, { now = Date.now(), dayKeyOfEntry, countSpec } = {}) => {
  if (typeof dayKeyOfEntry !== 'function' || !countSpec || typeof countSpec.count !== 'function') {
    throw new TypeError('buildMonthGrid requires dayKeyOfEntry(entry) and countSpec { empty, count }');
  }
  const countsByDay = new Map();
  for (const entry of entries || []) {
    const key = dayKeyOfEntry(entry);
    if (!key) continue;
    if (!countsByDay.has(key)) {
      countsByDay.set(key, { ...countSpec.empty });
    }
    countSpec.count(countsByDay.get(key), entry);
  }
  const todayKey = dayKeyOf(new Date(now));
  // Mon-first: Date.getDay() is Sun-first, so Monday folds to column 0.
  const offset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const row = [];
    for (let d = 0; d < 7; d += 1) {
      const date = w * 7 + d - offset + 1;
      if (date < 1 || date > daysInMonth) {
        row.push({ date: null, key: null, today: false, counts: countSpec.empty });
        continue;
      }
      const key = dayKeyOf(new Date(year, monthIndex, date));
      row.push({
        date,
        key,
        today: key === todayKey,
        counts: countsByDay.get(key) || countSpec.empty,
      });
    }
    weeks.push(row);
  }
  return weeks;
};
