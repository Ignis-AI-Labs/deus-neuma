/**
 * Day key — the OPERATOR-LOCAL calendar day as a comparable integer.
 *
 * The law (ruling, 2026-08-31): the vessel streak is judged by the operator's
 * own calendar days, not UTC's. The backend runs on the operator's machine,
 * so server-local time IS operator-local time — that is the design basis of
 * this module. (UTC epoch days silently moved anything logged 00:00–06:59
 * local onto the previous day in UTC+N, and broke a standing streak.)
 *
 * This is a READ-TIME law change only: the append-only log is never
 * rewritten; only the day-boundary judgment over it moved to local days.
 *
 * The contract matches the old UTC `dayKey` (`core/tasks/assigned-plan.js`):
 * a numeric epoch-day integer, so `<=` comparisons and `cursor - 1`
 * arithmetic in the streak folds keep working untouched. Two timestamps
 * share a key if and only if they fall on the same local calendar day, and
 * adjacent local days differ by exactly 1.
 *
 * The week/biweek/month keys extend the same law to the task recurrence
 * roll (core/tasks/assigned-plan.js): every period boundary is the
 * operator-local calendar boundary — the local Monday, the fortnight of
 * local Mondays, the local calendar month. A weekly settled Sunday evening
 * reopens at local midnight into Monday, not at 07:00 local (midnight UTC).
 * The fortnight boundaries land on the same calendar Mondays the UTC scheme
 * used — the local day key of a calendar Monday IS its UTC epoch-day
 * number — so a standing biweekly rhythm keeps its phase across the move.
 *
 * This module is the NEUTRAL LEAF for the law: core/vessel and core/tasks
 * both import from here, never from each other (direction law). The old
 * core/vessel/day-key.js path is a re-export barrel over this file.
 *
 * Pure module: timestamp in, integer out; no clock, no IO.
 */

const DAY_MS = 86400000;

/** Epoch ms from an ISO string or a number through unchanged; NaN-safe. */
const _ms = (isoOrMs) => (typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs));

/**
 * The operator-local calendar day of a timestamp as an epoch-day integer.
 * Computed from LOCAL date components, then counted exactly via Date.UTC —
 * month/year boundaries and leap days land correctly by construction, and
 * DST never enters (the count is taken in UTC over the local components).
 * @param {string|number} isoOrMs - ISO string or epoch milliseconds
 * @returns {number|null} null on an unparseable input (the dayKey contract)
 */
export const localDayKey = (isoOrMs) => {
  const t = _ms(isoOrMs);
  if (typeof t !== 'number' || Number.isNaN(t)) return null;
  const d = new Date(t);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
};

/**
 * Monday-start week key: the local day key of the week's Monday. Pure
 * integer math off the day key — day 0 (1970-01-01) was a Thursday, so
 * `(k + 4) % 7` is the local weekday (0 = Sunday). Same numeric contract
 * as the old UTC weekKey.
 */
export const localWeekKey = (isoOrMs) => {
  const k = localDayKey(isoOrMs);
  if (k === null) return null;
  const mondayOffset = (((k + 4) % 7) + 6) % 7;
  return k - mondayOffset;
};

/** Fortnight key: two Monday-start local weeks per period (epoch-aligned). */
export const localBiweekKey = (isoOrMs) => {
  const w = localWeekKey(isoOrMs);
  return w === null ? null : Math.floor(w / 14);
};

/** Calendar-month key (local): year × 12 + month. */
export const localMonthKey = (isoOrMs) => {
  const t = _ms(isoOrMs);
  if (typeof t !== 'number' || Number.isNaN(t)) return null;
  const d = new Date(t);
  return d.getFullYear() * 12 + d.getMonth();
};
