/**
 * MEETING REMINDERS — a meeting on the operator's calendars is announced so it cannot be missed (Design note, 2026-11-20:
 * […]), and a call with
 * someone on the lead ledger is written onto that lead.
 *
 * Once a minute, for each house — its calendars (when added, and the "Your calendars" connection is on) and every
 * call standing on a lead (booked-calls.js leadCalls: those need no calendar and no connection):
 *   NEW      a meeting that was not there at the last look is said once ([…]). The first look at
 *            a house says nothing: it marks what is already there.
 *   IN 1 H   said once, 60 minutes before it starts.
 *   IN 10    said once, 10 minutes before, with its link.
 * Each goes to the notification tray and the desk's own notice (the same road every other notice takes).
 *
 * A meeting with a lead is noted on the lead, once (sales/booked-calls.js): it reads CALL BOOKED in the pipeline, and
 * the sales member is told to prepare for it. What was said is kept in the house's files, so a restart repeats nothing.
 * impure (timers, the house's files, the network through calendar-feeds).
 */
import path from 'path';
import { servedHouses } from '../house-served.js';
import { walletDir } from '../user-realm.js';
import { readJson, writePrivate, ABSENT } from '../house-office-legacy.js';
import { readFeedEvents } from './calendar-feeds.js';
import { meetingWith } from '../house-agenda/agenda-calendar.js';
import { noteBookedCalls, leadCalls } from '../sales/booked-calls.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { createLogger } from '../logger.js';

const log = createLogger('MeetingReminders');
export const REMINDER_TICK_MS = 60_000;
const AHEAD_MS = 30 * 86_400_000;
const MIN = 60_000;
const stateFile = (house) => path.join(walletDir(house), 'meeting-reminders.json');

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayWords = (ms) => new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * What is to be said now for one meeting, given what was already said about it. Pure.
 * @param {{key: string, startMs: number, allDay: boolean}} event
 * @param {{seen?: boolean, hour?: boolean, ten?: boolean}} said
 * @param {number} now
 * @param {boolean} firstLook - the house's first look: what is already there is marked, never announced
 * @returns {Array<'new'|'hour'|'ten'>}
 */
export const dueReminders = (event, said, now, firstLook) => {
  const left = event.startMs - now;
  if (left <= 0) return [];
  return [
    ...(!said?.seen && !firstLook ? ['new'] : []),
    ...(!event.allDay && !said?.ten && left <= 10 * MIN ? ['ten'] : []),
    // The hour's notice is not said for a meeting already inside its last ten minutes: that one notice is enough.
    ...(!event.allDay && !said?.hour && left <= 60 * MIN && left > 10 * MIN ? ['hour'] : []),
  ];
};

/** One reminder's words. Pure. */
export const reminderWords = (stage, event, who) => {
  const withWho = who.length ? ` with ${who.map((w) => w.name).slice(0, 3).join(', ')}${who.length > 3 ? ` and ${who.length - 3} more` : ''}` : '';
  const when = event.allDay ? dayWords(event.startMs) : `${dayWords(event.startMs)}, ${clock(event.startMs)}`;
  const title = stage === 'ten' ? `In 10 minutes: ${event.title}${withWho}` : stage === 'hour' ? `In an hour (${clock(event.startMs)}): ${event.title}${withWho}` : `On your calendar: ${event.title}${withWho} — ${when}`;
  const where = /^https:\/\/\S+$/.test(String(event.place ?? '')) ? event.place : event.link;
  return { title: title.slice(0, 200), detail: [where ? `Join: ${where}` : event.place ? `Where: ${event.place}` : null, String(event.key ?? '').startsWith('lead-call:') ? 'From the sales pipeline (CALLS).' : `From the calendar "${event.feed}".`].filter(Boolean).join(' ') };
};

/** One look at one house. Never throws. impure. */
export const remindHouse = async (house, { now = Date.now() } = {}) => {
  const read = await readFeedEvents(house, { fromMs: now, toMs: now + AHEAD_MS }, { now });
  const leads = await leadLedgerFor(house).then((l) => l.load()).catch(() => []);
  const events = [...read.events, ...leadCalls(leads, { fromMs: now, toMs: now + AHEAD_MS }, read.events)].sort((a, b) => a.startMs - b.startMs);
  if (!events.length && (read.off || !read.feeds)) return { house, meetings: 0, said: 0 };
  const doc = await readJson(stateFile(house));
  const firstLook = doc === ABSENT || !doc?.said;
  const said = firstLook ? {} : { ...doc.said };
  let count = 0;
  for (const event of events) {
    const prior = said[event.key] ?? {};
    const who = meetingWith(event, leads);
    for (const stage of dueReminders(event, prior, now, firstLook)) {
      const words = reminderWords(stage, event, who);
      await notifyOperator({ wallet: house, kind: KIND.meeting, standing: STANDING.system, actor: { id: 'calendar', name: 'calendar' }, ref: { meeting: event.key, stage }, ...words })
        .catch((err) => log.warn('A meeting could not be announced — the calendar still shows it', { err: err.message }));
      count += 1;
    }
    const left = event.startMs - now;
    said[event.key] = { seen: true, hour: prior.hour || (!event.allDay && left <= 60 * MIN), ten: prior.ten || (!event.allDay && left <= 10 * MIN), startMs: event.startMs };
  }
  // What has started is forgotten: the file stays as small as the month ahead.
  for (const [key, entry] of Object.entries(said)) if ((entry.startMs ?? 0) < now - 86_400_000) delete said[key];
  await writePrivate(stateFile(house), { said, lookedAt: new Date(now).toISOString() });
  const booked = await noteBookedCalls(house, read.events, { now, complete: !read.off && read.feeds > 0 && !read.gaps.length, untilMs: now + AHEAD_MS - 86_400_000 }).catch((err) => { log.warn('Booked calls could not be noted on their leads', { err: err.message }); return 0; });
  return { house, meetings: events.length, said: count, booked };
};

let running = false;

/** One pass over every served house. Never throws. impure. */
export const meetingReminderTick = async () => {
  if (running) return { skipped: 'previous look still running' };
  running = true;
  try {
    const looks = [];
    for (const house of await servedHouses()) looks.push(await remindHouse(house).catch((err) => ({ house, error: err.message })));
    for (const l of looks.filter((x) => x.error)) log.warn('a house\'s meetings could not be looked at', { house: l.house, error: l.error });
    return { looks };
  } finally {
    running = false;
  }
};

/** Start the reminders. The interval is unref'd so it never holds the process open. impure. */
export const startMeetingReminders = ({ intervalMs = REMINDER_TICK_MS } = {}) => {
  const timer = setInterval(() => {
    meetingReminderTick().catch((err) => log.error('meeting reminder tick failed', { error: err.message }));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};
