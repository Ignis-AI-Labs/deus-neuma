// platform-pulse.js — a platform's queue read as the operator's questions: what
// is waiting on me, what goes out next, how this month has gone, and the four
// weeks around today. The count taxonomy is the queue's own (queue-calendar.js
// countInto), so the console, the strip and the calendar can never disagree.
//
// pure — queue entries and a clock in, counts out.

import { QUEUE_COUNT_SPEC, countInto, queueById, queueDayKey } from './queue-calendar.js';
import { dayKeyOf } from './month-grid.js';

const DAY_MS = 86_400_000;
/** Days the strip shows before today, and after it (today included in the after). */
export const STRIP_BEFORE = 14;
export const STRIP_AFTER = 14;

const empty = () => ({ ...QUEUE_COUNT_SPEC.empty });

/** pure — every entry of one platform (all platforms when channelId is null). */
export const scopeQueue = (queue, channelId = null) =>
  (Array.isArray(queue) ? queue : []).filter((e) => !channelId || e?.channelId === channelId);

/**
 * pure — the next APPROVED post that will go out, by its slot; null when none
 * is scheduled ahead of `now`.
 */
export const nextOut = (entries, now) => entries
  .filter((e) => e?.status === 'approved' && e.kind !== 'reply' && Date.parse(e.scheduledFor || '') >= now)
  .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor))[0] ?? null;

/**
 * pure — the pulse: the whole queue's standing counts (awaiting is every draft,
 * wherever it sits), this calendar month's counts by slot, the next post out,
 * and a day strip from STRIP_BEFORE days back to STRIP_AFTER ahead.
 * @param {Array<object>} entries - one platform's queue (scopeQueue)
 * @param {number} now - ms
 */
export const platformPulse = (entries, now) => {
  const byId = queueById(entries);
  const standing = empty();
  for (const e of entries) countInto(standing, e);
  const monthKey = dayKeyOf(new Date(now).toISOString()).slice(0, 7);
  const month = empty();
  const byDay = new Map();
  for (const e of entries) {
    const key = queueDayKey(e, byId);
    if (!key) continue;
    if (key.startsWith(monthKey)) countInto(month, e);
    if (!byDay.has(key)) byDay.set(key, empty());
    countInto(byDay.get(key), e);
  }
  const todayKey = dayKeyOf(new Date(now).toISOString());
  const strip = Array.from({ length: STRIP_BEFORE + STRIP_AFTER }, (_, i) => {
    const key = dayKeyOf(new Date(now + (i - STRIP_BEFORE) * DAY_MS).toISOString());
    return { key, today: key === todayKey, counts: byDay.get(key) ?? empty() };
  });
  return Object.freeze({
    awaiting: standing.Q,
    repliesAwaiting: entries.filter((e) => e?.kind === 'reply' && e.status === 'draft').length,
    unscheduled: entries.filter((e) => !queueDayKey(e, byId) && ['draft', 'approved'].includes(e?.status)).length,
    month,
    next: nextOut(entries, now),
    strip,
  });
};

/** pure — "in 3h 12m", "in 2 days", "now" — how far a time stands ahead. */
export const untilLabel = (iso, now) => {
  const ms = Date.parse(iso || '') - now;
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 60_000) return 'now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h}h ${m % 60}m`;
  return `in ${Math.round(h / 24)} days`;
};
