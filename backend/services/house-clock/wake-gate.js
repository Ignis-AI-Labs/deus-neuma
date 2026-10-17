/**
 * THE WAKE GATE — whether a seat may wake now, decided from the charter alone.
 * Pure: the queue (wake-queue.js) hands in the charter, the clock and the day's
 * counts, and acts on the answer.
 *
 * Two questions, asked at two moments:
 *   - TAKE it? (at the signal) No charter, an unapproved or paused one, a seat
 *     the charter does not name, or a chain of wakes past its limit: the
 *     signal is dropped. The work itself is never lost — the post still waits
 *     in the inbox for the seat's next turn — only the wake is.
 *   - RUN it now? (each time the queue moves) The charter may have been paused
 *     since, the house may be in its quiet hours, the seat may have spent its
 *     daily cap: the wake HOLDS in the queue, in view, until it may run.
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

/**
 * May this signal become a queued wake? Pure.
 * @param {{charter: ?Object, seat: string, depth?: number}} args
 * @returns {{ok: true} | {ok: false, why: string}}
 */
export const takeGate = ({ charter, seat, depth = 0 }) => {
  const standing = charterStanding(charter);
  if (standing !== 'active') return { ok: false, why: `the charter is ${standing}` };
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

/** The dedupe key of one wake: the same work never queues twice. Pure. */
export const wakeKey = ({ seat, reason, ref }) => `${seat}|${reason}|${ref}`;
