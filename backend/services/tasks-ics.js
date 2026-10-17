// tasks-ics.js — the operator's deadlines as an RFC 5545 calendar, for any
// calendar app to SUBSCRIBE to. Pure throughout: deadline records in, ICS
// text out; the route (task-routes.js) owns auth and IO.
//
// One-way by law: the feed carries nothing the operator could edit back into
// the stores, so there is no conflict discipline to get wrong and no vendor
// API to hold custody. The house is one machine on one operator's calendar —
// local time is the truth, so timed entries are written as FLOATING local
// times (no TZID, no UTC conversion): "by 18:00" means the operator's 18:00
// on whatever device renders it, exactly as the task lines mean it.

import { dueStateOf } from '../../core/tasks/deadline.js';

// RFC 5545 §3.3.11 TEXT escaping: backslash first, then the specials, and a
// literal newline becomes the two-character sequence. Pure.
export const icsEscape = (text) => String(text ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

// The feed's VEVENT UID for one deadline record — stable across fetches so a
// calendar app updates the entry in place instead of duplicating it. Pure.
export const icsUidFor = ({ id }) => `neuma-task-${id}@neuma.local`;

// 'YYYY-MM-DD' → 'YYYYMMDD' (ICS all-day DATE form). Pure.
const _icsDay = (dayKey) => String(dayKey).replaceAll('-', '');

/**
 * One deadline record → its VEVENT block lines (no wrapping: every line
 * stays under 75 octets at the lengths this store can hold). A record with
 * a dueDate is an all-day or timed event on that day; a bare dueTime on a
 * recurring task is a timed event on TODAY (the recurrence roll's open state
 * IS today's instance). Settled work is skipped by the caller. Pure.
 * @param {{id: string, source: string, title: string, dueDate?: string,
 *   dueTime?: string, done?: boolean, overdue?: boolean}} record
 * @param {Date} [now]
 * @returns {string[]}
 */
export const icsEventLines = (record, now = new Date()) => {
  if (!record?.dueDate && !record?.dueTime) return [];
  const stamp = `${now.toISOString().replaceAll('-', '').replaceAll(':', '').slice(0, 15)}Z`;
  const summary = `${record.overdue ? 'OVERDUE — ' : ''}${record.title}`
    + (record.source ? ` [${record.source}]` : '');
  const lines = [
    'BEGIN:VEVENT',
    `UID:${icsUidFor(record)}`,
    `DTSTAMP:${stamp}`,
  ];
  if (record.dueDate) {
    const day = _icsDay(record.dueDate);
    if (record.dueTime) {
      lines.push(`DTSTART:${day}T${record.dueTime.replace(':', '')}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${day}`);
    }
  } else {
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    lines.push(`DTSTART:${today}T${record.dueTime.replace(':', '')}00`);
  }
  lines.push(
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(record.source ? `Source: ${record.source}` : record.title)}`,
    'END:VEVENT',
  );
  return lines;
};

/**
 * The whole feed: the VCALENDAR wrapper over every live deadline record.
 * DONE-true records are skipped — a settled task owes the calendar nothing.
 * Pure.
 * @param {Array<{id: string, title: string, source: string, dueDate?: string,
 *   dueTime?: string, done?: boolean, overdue?: boolean}>} deadlines
 * @param {{now?: Date, name?: string}} [opts]
 * @returns {string} the full ICS body, CRLF line endings, trailing CRLF
 */
export const buildTasksIcs = (deadlines, { now = new Date(), name = 'NEUMA TASKS' } = {}) => {
  const records = (Array.isArray(deadlines) ? deadlines : []).filter((r) => !r?.done);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NEUMA//Task Deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`,
  ];
  for (const record of records) {
    lines.push(...icsEventLines(record, now));
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
};

// Convenience for the route: which records still owe the calendar something.
// Re-derives overdue from the deadline leaf so the route never stamps a
// stale boolean. Pure.
export const liveDeadlines = (records, now = new Date()) =>
  (Array.isArray(records) ? records : [])
    .filter((r) => !r?.done && (r?.dueDate || r?.dueTime))
    .map((r) => ({ ...r, overdue: dueStateOf(r, now)?.state === 'overdue' }));
