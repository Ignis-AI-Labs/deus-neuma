// queue-when.js — a queued post's moment, in the data register: the compact
// absolute time (12-hour, Design note, 2026-07-27: […]), the compact distance, and the post card's WHEN as a
// countdown mark's parts (show-dont-tell-audit.md finding 8: the time as a
// countdown mark plus the time; the lock's moment and id on hover; a settled
// post's moment alone — its StatusMark already says what happened).
//
// Every function here is pure.

const DAYS = Object.freeze(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
const MONTHS = Object.freeze(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']);

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Compact absolute time: within the week 'TUE 9:12 PM', further out
 * 'JUL 27 · 9:30 AM'. Noon and midnight stay honest ('12:00 PM' / '12:05 AM').
 * @param {Date} date
 * @param {number} now - ms
 */
export const absWhen = (date, now) => {
  const h = date.getHours();
  const hhmm = `${h % 12 === 0 ? 12 : h % 12}:${pad2(date.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
  return Math.abs(now - date.getTime()) < 7 * 864e5
    ? `${DAYS[date.getDay()]} ${hhmm}`
    : `${MONTHS[date.getMonth()]} ${date.getDate()} · ${hhmm}`;
};

/**
 * Compact distance: '45M', '3H 12M', '2D 3H'. NOW under a minute — a slot
 * firing reads live, never '0M'.
 * @param {number} ms
 */
export const relWhen = (ms) => {
  const mins = Math.round(Math.abs(ms) / 60000);
  if (mins < 1) return 'NOW';
  if (mins < 60) return `${mins}M`;
  const h = Math.floor(mins / 60);
  if (h < 48) return mins % 60 ? `${h}H ${mins % 60}M` : `${h}H`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}D ${h % 24}H` : `${d}D`;
};

const at = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? null : new Date(t);
};

/**
 * A moment still ahead, as a countdown's parts — or null when it has passed
 * or is no moment at all.
 * @param {?string} iso
 * @param {number} now - ms
 * @returns {?{rel: string, at: string}}
 */
export const aheadOf = (iso, now) => {
  const d = at(iso);
  return d && d.getTime() > now ? { rel: relWhen(d.getTime() - now), at: absWhen(d, now) } : null;
};

// The moment a settled post's record carries for what happened to it.
const SETTLED_AT = Object.freeze({
  sent: (e) => at(e.sentAt) || at(e.decidedAt),
  failed: (e) => at(e.decidedAt) || at(e.createdAt),
  rejected: (e) => at(e.decidedAt),
  withdrawn: (e) => at(e.decidedAt),
});

/**
 * The post card's WHEN. A slot still ahead (a draft's, or an approved post's)
 * is a countdown: `ahead` {rel, at}, an approved post's lock (its moment and
 * id) in `title`. A settled post is its moment alone (`at`). Anything else — a
 * reply's approval law, a missed slot, no slot — keeps its whole line
 * (`line`, from the board's own meta line), because there the words are the fact.
 * @param {object} entry
 * @param {number} now - ms
 * @param {(entry: object, now: number) => string} lineOf - the board's meta line (queueWhenLabel)
 * @returns {{ahead?: {rel: string, at: string}, at?: string, title?: string, line?: string}}
 */
export const cardWhen = (entry, now, lineOf) => {
  const status = String(entry?.status || '');
  if (entry?.kind !== 'reply' && (status === 'draft' || status === 'approved')) {
    const ahead = aheadOf(entry.scheduledFor, now);
    if (ahead) {
      const lock = status === 'approved' ? at(entry.decidedAt) : null;
      return { ahead, ...(lock ? { title: `locked ${absWhen(lock, now)}${entry.id ? ` · id ${entry.id}` : ''}` } : {}) };
    }
  }
  const settled = SETTLED_AT[status]?.(entry || {});
  if (settled) return { at: absWhen(settled, now) };
  if (SETTLED_AT[status] || status === 'sending') return {};
  return { line: lineOf(entry, now) };
};
