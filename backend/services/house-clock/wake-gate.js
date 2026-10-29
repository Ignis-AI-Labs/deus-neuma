/**
 * THE WAKE GATE — whether a seat may wake now, decided from the charter alone.
 * Pure: the queue (wake-queue.js) hands in the charter, the clock and the day's
 * counts, and acts on the answer.
 *
 * Two questions, asked at two moments:
 *   - TAKE it? (at the signal) No charter at all, a seat the charter does not
 *     name, or a chain of wakes past its limit: the signal is dropped. The
 *     work itself is never lost — the post still waits in the inbox for the
 *     seat's next turn — only the wake is. A charter that is PAUSED, or waits
 *     for approval (as it does after every edit), takes the signal: the work
 *     is held in view and runs on RESUME / APPROVE (2026-10-18 audit: work
 *     landing in the gap after an edit was silently dropped).
 *   - RUN it now? (each time the queue moves) The charter may be paused or
 *     unapproved, the house may be in its quiet hours, the seat may have spent
 *     its daily cap: the wake HOLDS in the queue, in view, until it may run.
 */
import { charterStanding, charterSeat, clockMinutes } from './charter-shape.js';

/** How many wakes deep one chain of wakes may run (wake-signal.js THE CHAIN). */
export const WAKE_CHAIN_MAX = 6;

/** The local day a wake is counted against. Pure. */
export const localDay = (now) => {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Is this local instant inside the quiet hours? Pure. A window may cross
 * midnight (22:00 → 07:00); its start is quiet, its end is not.
 * @param {?{start: string, end: string}} quiet
 * @param {number} now - epoch ms
 * @returns {boolean}
 */
export const inQuietHours = (quiet, now) => {
  if (!quiet) return false;
  const start = clockMinutes(quiet.start);
  const end = clockMinutes(quiet.end);
  const d = new Date(now);
  const at = d.getHours() * 60 + d.getMinutes();
  return start < end ? at >= start && at < end : at >= start || at < end;
};

// pure — how far local time runs ahead of UTC at this instant, in ms
const localOffsetMs = (now) => -new Date(now).getTimezoneOffset() * 60_000;

/**
 * The Optio's cadence window an instant falls in, counted from LOCAL midnight
 * like the quiet hours and the daily cap: a daily review rolls over at the
 * operator's midnight, never at UTC's. Pure.
 * @param {number} now - epoch ms
 * @param {number} windowMs
 * @returns {number} the window's index
 */
export const cadenceSlot = (now, windowMs) => Math.floor((now + localOffsetMs(now)) / windowMs);

/** When the first cadence window at or after `from` begins, in epoch ms (the calendar's projection). Pure. */
export const nextCadenceStart = (from, windowMs) => {
  const offset = localOffsetMs(from);
  return Math.ceil((from + offset) / windowMs) * windowMs - offset;
};

/**
 * May this signal become a queued wake? Pure.
 * @param {{charter: ?Object, seat: string, depth?: number}} args
 * @returns {{ok: true} | {ok: false, why: string}}
 */
export const takeGate = ({ charter, seat, depth = 0 }) => {
  if (charterStanding(charter) === 'none') return { ok: false, why: 'the charter is none' };
  if (!charterSeat(charter, seat)) return { ok: false, why: `${seat} is not a seat the charter lets wake` };
  if (depth > WAKE_CHAIN_MAX) return { ok: false, why: `a chain of wakes ${depth} deep — past the limit of ${WAKE_CHAIN_MAX}` };
  return { ok: true };
};

/**
 * May this seat's queued wake run now? Pure.
 * @param {{charter: ?Object, seat: string, now: number, count: number}} args - count = the seat's wakes today
 * @returns {{ok: true} | {ok: false, why: string}}
 */
export const runGate = ({ charter, seat, now, count }) => {
  const standing = charterStanding(charter);
  if (standing !== 'active') return { ok: false, why: `the charter is ${standing}` };
  const row = charterSeat(charter, seat);
  if (!row) return { ok: false, why: `${seat} is no longer a seat the charter lets wake` };
  if (inQuietHours(charter.quietHours, now)) return { ok: false, why: `quiet hours (${charter.quietHours.start}–${charter.quietHours.end})` };
  if (count >= row.dailyCap) return { ok: false, why: `${seat} has spent its ${row.dailyCap} wakes for today` };
  return { ok: true };
};

/**
 * Whether a wake is only the operator's answers (ask-answer.js). Such a wake
 * is the operator's own act, so it never spends the seat's daily cap (the cap
 * bounds a house waking itself) — pause, quiet hours and the seat law still
 * hold it. Pure.
 * @param {Array<{reason: string}>} items - the wake's queued items
 * @returns {boolean}
 */
export const answersOnly = (items) => items.length > 0 && items.every((i) => i.reason === 'operator-answer');

/** How many times one piece of work is tried before the operator is told its wake failed. */
export const WAKE_ATTEMPTS_MAX = 3;

/**
 * May this seat's queued work run now, after a failed wake? A failed wake's
 * work waits out its backoff (wake-queue.js), so a dead model is not hammered
 * — in view, with when it is tried again. Pure.
 * @param {Array<{attempts?: number, retryAt?: string}>} items - the seat's queued items
 * @param {number} now - epoch ms
 * @returns {{ok: true} | {ok: false, why: string}}
 */
export const retryGate = (items, now) => {
  const due = Math.max(0, ...items.map((i) => Date.parse(i.retryAt ?? '') || 0));
  if (due <= now) return { ok: true };
  const failures = Math.max(0, ...items.map((i) => i.attempts ?? 0));
  return { ok: false, why: `its last wake failed — tried again at ${new Date(due).toTimeString().slice(0, 5)} (attempt ${failures + 1} of ${WAKE_ATTEMPTS_MAX})` };
};

/** The dedupe key of one wake: the same work never queues twice. Pure. */
export const wakeKey = ({ seat, reason, ref }) => `${seat}|${reason}|${ref}`;
