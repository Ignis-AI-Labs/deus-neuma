// deadline.js — THE DEADLINE, said one way everywhere.
//
// A task can owe itself by a day (dueDate) and, within that day, by a time
// (dueTime). One pure module normalizes the two fields and derives the one
// state every surface renders — the being's WORKING STATE line, the STANDING
// WORK and OPERATOR LIST lines, the desk's TASKS calendar, and the ICS feed
// — so no two surfaces can ever disagree about whether something is overdue.
// The leaf imports nothing from the plans: the plans import IT.
//
// Local time is the truth. The house is one machine on one operator's
// calendar; "by 18:00" means the operator's 18:00, never UTC's.

export const DUE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DUE_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// A day key that names a REAL calendar day — JS Date.parse quietly rolls
// 2026-02-30 into March, so the components are checked back out of the
// parsed instant. Same law the desk's calendars already hold. Pure.
const _realDayKey = (text) => {
  if (typeof text !== 'string') return null;
  const m = DUE_DATE_RE.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const parsed = new Date(Date.UTC(y, mo - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== mo - 1 || parsed.getUTCDate() !== d) {
    return null;
  }
  return m[0];
};

/**
 * A due date: strict YYYY-MM-DD naming a real day, or null to clear. Throws
 * a plain correction (the caller's error lane maps it). Pure.
 * @param {string|undefined|null} text
 * @returns {string|null|undefined} undefined = "leave it alone", null = clear
 */
export const normalizeDueDate = (text) => {
  if (text === undefined) return undefined;
  if (text === null) return null;
  const day = _realDayKey(text);
  if (!day) throw new Error('a due date must be a real calendar day — YYYY-MM-DD.');
  return day;
};

/**
 * A due time of day: strict HH:MM (00:00–23:59, local), or null to clear.
 * Pure.
 */
export const normalizeDueTime = (text) => {
  if (text === undefined) return undefined;
  if (text === null) return null;
  const t = typeof text === 'string' ? text.trim() : '';
  if (!DUE_TIME_RE.test(t)) throw new Error('a due time must be HH:MM — a time of day, 00:00 through 23:59.');
  return t;
};

// The local 'YYYY-MM-DD' an instant falls on. Pure.
const _dayKeyOf = (date) => {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
};

/**
 * The MOMENT a task is due, as a local Date — null when no deadline applies.
 * An explicit dueDate pins the day (end of day 23:59 when no time is given);
 * a bare dueTime on a recurring task (a daily owed "by 18:00") is due TODAY
 * at that time — the recurrence roll's open state IS today's instance. Pure.
 * @param {{dueDate?: string, dueTime?: string}} task
 * @param {Date} [now]
 * @returns {Date|null}
 */
export const dueInstantOf = (task, now = new Date()) => {
  if (!task?.dueDate && !task?.dueTime) return null;
  if (task.dueDate) {
    return new Date(`${task.dueDate}T${task.dueTime || '23:59'}:00`);
  }
  return new Date(`${_dayKeyOf(now)}T${task.dueTime}:00`);
};

/**
 * The one deadline state every surface renders. Live tasks only — the
 * callers filter settled work before asking. Pure.
 * @param {{dueDate?: string, dueTime?: string}} task
 * @param {Date} [now]
 * @returns {{state: 'overdue'|'due'|'upcoming', at: Date}|null} null = no deadline
 */
export const dueStateOf = (task, now = new Date()) => {
  const at = dueInstantOf(task, now);
  if (!at) return null;
  const overdue = now.getTime() > at.getTime();
  const today = !task.dueDate || task.dueDate === _dayKeyOf(now);
  if (overdue) return { state: 'overdue', at };
  return { state: today ? 'due' : 'upcoming', at };
};

/**
 * The line fragment every task line renders — '' when no deadline applies.
 * The overdue mark rides in CAPS: it is the one word a scanning eye needs.
 * Pure.
 */
export const dueLabel = (task, now = new Date()) => {
  const state = dueStateOf(task, now);
  if (!state) return '';
  const when = `${task.dueDate || _dayKeyOf(state.at)}${task.dueTime ? ` ${task.dueTime}` : ''}`;
  const mark = state.state === 'overdue' ? ' — OVERDUE' : state.state === 'due' ? ' — DUE TODAY' : '';
  return ` — DUE ${when}${mark}`;
};
