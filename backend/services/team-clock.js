// team-clock.js — a part's CLOCK (#577): the promise about time a plan makes,
// measured on what is fair, with the consequence it chose.
//
// Design note, 2026-10-13: […]
//
// NO CLOCK is the default: a part works until it is done or someone stops it
// (#576 took the thirty-minute wall clock out). A clock, when one is set:
//   - work — minutes of the member's WORKING time: while its attempt holds
//     its place to work, never while it waits in the substrate line, never
//     the pause before a continuation. The 30:00 cut of 2026-10-12 ran while
//     five members waited behind each other on one GPU.
//   - dueDate / dueTime — the calendar's deadline, in the task grammar
//     (core/tasks/deadline.js): a real day, an optional local HH:MM.
//   - then — what the run does when either passes: 'notify' tells the
//     operator and the CoS and keeps working; 'wrap-up' asks the member to
//     hand in what it has (the part ends PARTIAL); 'stop' stops the part —
//     its sitting, log and files stand, and a resume continues it.
// A run carries a clock every part inherits; a part may carry its own, or
// opt out with 'none'.
//
// pure.

import { normalizeDueDate, normalizeDueTime, dueInstantOf } from '../../core/tasks/deadline.js';

/** What a clock may do when it passes. */
export const CLOCK_ACTIONS = Object.freeze(['notify', 'wrap-up', 'stop']);
/** What a clock does when its setter named nothing. */
export const DEFAULT_CLOCK_ACTION = 'wrap-up';
/** A part's explicit opt-out of its run's clock. */
export const NO_CLOCK = 'none';
/** The most working time one clock may promise — a week of the model's time. */
export const CLOCK_WORK_MAX_MINUTES = 7 * 24 * 60;
/** Working time a wrap-up has to hand in what it has, before the part is stopped. */
export const WRAP_UP_GRACE_MS = 15 * 60 * 1000;
/** The abort reason a clock's wrap-up cuts an attempt with — the part continues, handing in. */
export const CLOCK_WRAP_REASON = 'its clock ran out — wrap up';
/** The abort reason a clock's stop cuts an attempt with — the part ends, resumable. */
export const CLOCK_STOP_REASON = 'its clock ran out — stop';
/** Minutes between a working run's check-ins when nobody named a cadence (team-watch.js). */
export const DEFAULT_CHECK_IN_MINUTES = 60;
/** The closest check-ins may come: each one is a card, a post into the Optio's inbox and a queued wake. */
export const CHECK_IN_MIN_MINUTES = 1;

const NONE_WORDS = new Set([NO_CLOCK, 'off', 'no clock', 'no']);
const ACTION_WORDS = Object.freeze({
  notify: 'notify', 'wrap-up': 'wrap-up', 'wrap up': 'wrap-up', wrapup: 'wrap-up', wrap_up: 'wrap-up', stop: 'stop',
});
const SPAN = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?$/i;

/**
 * Minutes of working time from a number or text ("90", "90m", "2h", "1h30m",
 * "1.5h"). Throws the correction. Pure.
 * @param {number|string} value
 * @param {string} where - whose clock, for the correction
 * @returns {number}
 */
export const parseMinutes = (value, where = 'the clock') => {
  const text = typeof value === 'string' ? value.trim() : null;
  let minutes = typeof value === 'number' ? value : null;
  if (text && /^\d+(?:\.\d+)?$/.test(text)) minutes = Number(text);
  else if (text) {
    const m = SPAN.exec(text);
    if (m && (m[1] || m[2])) minutes = Number(m[1] || 0) * 60 + Number(m[2] || 0);
  }
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`${where}: work is minutes of WORKING time — a number, or text like "90m" or "2h".`);
  }
  if (minutes > CLOCK_WORK_MAX_MINUTES) {
    throw new Error(`${where}: work stays within ${CLOCK_WORK_MAX_MINUTES / 60} hours of working time — for work with no end, set no clock.`);
  }
  return minutes;
};

// pure — a structured value that arrived as TEXT (text tool dialects send every arg as a string).
const parsedObject = (text) => {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * A clock as a plan, a lead, the CoS or the operator gives it — normalized,
 * or a thrown correction that names the fix. Pure.
 * @param {*} raw - null/undefined (no clock set here), 'none' (opt out), a
 *   span ("2h", 90), or { work?, dueDate?, dueTime?, then? }
 * @param {string} [where] - whose clock, for the correction
 * @returns {null|'none'|Readonly<{work: ?number, dueDate: ?string, dueTime: ?string, then: string}>}
 */
export const normalizeClock = (raw, where = 'the clock') => {
  if (raw == null || raw === '') return null;
  let value = raw;
  if (typeof value === 'string') {
    const text = value.trim();
    if (NONE_WORDS.has(text.toLowerCase())) return NO_CLOCK;
    value = text.startsWith('{') ? parsedObject(text) : { work: text };
    if (!value) throw new Error(`${where}: a clock is "none", a span like "2h", or {"work": minutes, "dueDate": "YYYY-MM-DD", "dueTime": "HH:MM", "then": "notify"|"wrap-up"|"stop"}.`);
  } else if (typeof value === 'number') {
    value = { work: value };
  } else if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${where}: a clock is "none", a span like "2h", or an object {work?, dueDate?, dueTime?, then?}.`);
  }
  // The tool's declared shape is an object, so its opt-out is one too.
  if (value.none === true) return NO_CLOCK;
  const work = value.work == null || value.work === '' ? null : parseMinutes(value.work, where);
  let dueDate;
  let dueTime;
  try {
    dueDate = normalizeDueDate(value.dueDate ?? undefined) ?? null;
    dueTime = normalizeDueTime(value.dueTime ?? undefined) ?? null;
  } catch (err) {
    throw new Error(`${where}: ${err.message}`);
  }
  if (dueTime && !dueDate) throw new Error(`${where}: a dueTime needs its dueDate (YYYY-MM-DD).`);
  if (work == null && !dueDate) {
    throw new Error(`${where}: a clock needs work (minutes of working time) or a dueDate — or "none" for no clock.`);
  }
  const then = value.then == null ? DEFAULT_CLOCK_ACTION : ACTION_WORDS[String(value.then).trim().toLowerCase()];
  if (!then) throw new Error(`${where}: then is one of ${CLOCK_ACTIONS.map((a) => `"${a}"`).join(', ')}.`);
  return Object.freeze({ work, dueDate, dueTime, then });
};

/**
 * A run's check-in cadence as given: minutes between check-ins, 0 for none,
 * null when none was named (the default holds). Throws the correction. Pure.
 * @param {*} raw - a number, a span ("2h"), or "none"/"off"/0
 * @param {string} [where]
 * @returns {?number}
 */
export const normalizeCheckIn = (raw, where = 'checkIn') => {
  if (raw == null || raw === '') return null;
  if (raw === 0 || raw === '0' || (typeof raw === 'string' && NONE_WORDS.has(raw.trim().toLowerCase()))) return 0;
  const minutes = parseMinutes(raw, `${where} (minutes between check-ins, or "none")`);
  if (minutes < CHECK_IN_MIN_MINUTES) throw new Error(`${where}: check-ins come at most once every ${CHECK_IN_MIN_MINUTES} minute — name ${CHECK_IN_MIN_MINUTES} or more minutes, or "none".`);
  return minutes;
};

/**
 * The clock one part runs under: its own, else its run's, else none. Pure.
 * @param {{clock?: ?Object, clocks?: Object}} run - the run's default and its parts' own
 * @param {string} stepId
 * @returns {?Object}
 */
export const clockFor = ({ clock = null, clocks = {} } = {}, stepId) => {
  const own = clocks && Object.hasOwn(clocks, stepId) ? clocks[stepId] : undefined;
  if (own === NO_CLOCK) return null;
  return own ?? clock ?? null;
};

/** The working time a clock allows, in ms — null when it promises none. Pure. */
export const workLimitMs = (clock) => (clock?.work ? Math.round(clock.work * 60_000) : null);

/**
 * The calendar moment a clock falls due, epoch ms — null when it names no day. Pure.
 * @param {?Object} clock
 * @param {Date} [now]
 * @returns {?number}
 */
export const dueAtMs = (clock, now = new Date()) => {
  if (!clock?.dueDate) return null;
  const at = dueInstantOf({ dueDate: clock.dueDate, ...(clock.dueTime ? { dueTime: clock.dueTime } : {}) }, now);
  return at ? at.getTime() : null;
};

/** Minutes as the window and the notes say them: "45m", "2h", "1h 30m". Pure. */
export const formatMinutes = (minutes) => {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
};

const THEN_WORDS = Object.freeze({ notify: 'notify', 'wrap-up': 'wrap up', stop: 'stop' });

/**
 * A clock in words — the plan card, the window, the member's brief. Pure.
 * @param {?Object} clock
 * @returns {string}
 */
export const describeClock = (clock) => {
  if (!clock || clock === NO_CLOCK) return 'no clock — works until done or stopped';
  const limits = [
    clock.work ? `${formatMinutes(clock.work)} of work` : null,
    clock.dueDate ? `due ${clock.dueDate}${clock.dueTime ? ` ${clock.dueTime}` : ''}` : null,
  ].filter(Boolean);
  return `${limits.join(' or ')}, then ${THEN_WORDS[clock.then] || clock.then}`;
};

/**
 * What the member reads about its clock in its brief. Pure.
 * @param {?Object} clock
 * @returns {?string}
 */
export const clockBrief = (clock) => {
  if (!clock) return null;
  const end = {
    notify: 'your operator is told when it passes; you keep working',
    'wrap-up': 'when it runs out you will be asked to hand in what you have',
    stop: 'when it runs out your part is stopped where it stands (your files stay; it can be resumed)',
  }[clock.then];
  return `YOUR CLOCK: ${describeClock(clock)} — ${end}. Working time counts only while you work, never while you wait your turn. Pace the part to it: write your deliverable early and keep it current.`;
};

/** The first line of a part handed in at its clock's end — every reader downstream sees it. Pure. */
export const partialBanner = (why) => `[PARTIAL — this part's clock ran out (${why}); it handed in what it had.]`;

/**
 * What governs a run, as every desk shows it: its width against the rig, its
 * clock, and each part's clock (`partClocks` — never `parts`, the run's
 * finished work) — its own setting, in words, its working budget and its
 * due — so a window never re-derives a rule. Pure.
 * @param {{concurrency: ?number, ceiling: ?number, clock: ?Object, clocks: Object, board: Array}} entry
 * @returns {Object}
 */
export const governsOf = (entry) => ({
  concurrency: entry.concurrency ?? null,
  ceiling: entry.ceiling ?? null,
  clock: entry.clock ?? null,
  clockWords: describeClock(entry.clock),
  clocks: { ...(entry.clocks || {}) },
  checkIn: entry.checkIn ?? DEFAULT_CHECK_IN_MINUTES,
  partClocks: Object.fromEntries((entry.board || []).map((row) => {
    const clock = clockFor(entry, row.id);
    const own = entry.clocks && Object.hasOwn(entry.clocks, row.id) ? entry.clocks[row.id] : null;
    return [row.id, { own, words: describeClock(clock), limitMs: workLimitMs(clock), dueMs: dueAtMs(clock) }];
  })),
});
