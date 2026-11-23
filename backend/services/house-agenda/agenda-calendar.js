// agenda-calendar.js — the house agenda's MEETINGS: everything on the calendars the operator keeps elsewhere
// (calendar/calendar-feeds.js), on the operator's own row, each at its real time. A meeting with someone on the
// lead ledger names them, so a call the CRM booked reads as […], not as one more busy block.
import { readFeedEvents } from '../calendar/calendar-feeds.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { stampOf } from './agenda-time.js';
import { leadCalls } from '../sales/booked-calls.js';

const dayOfUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const isLink = (v) => /^https:\/\/\S+$/.test(String(v ?? ''));
const low = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Who a meeting is with, from the house's side: every invited person who is not the organizer's own address and did
 * not decline, each named when the lead ledger knows them. Pure.
 * @param {{attendees: Array<{email: string, name: ?string, declined?: boolean}>, organizer: ?{email: string}}} event
 * @param {Array<{id: string, name: string, contact: string}>} leads
 * @param {Set<string>} [own] - the operator's own addresses, left out
 */
export const meetingWith = (event, leads, own = new Set()) => {
  const mine = new Set([low(event.organizer?.email), ...own].filter(Boolean));
  const byAddress = new Map(leads.map((l) => [low(l.contact), l]));
  return (event.attendees ?? [])
    .filter((a) => a.email && !mine.has(a.email) && !a.declined)
    .map((a) => { const lead = byAddress.get(a.email) ?? null; return { email: a.email, name: lead?.name || a.name || a.email, ...(lead ? { leadId: lead.id } : {}) }; });
};

/**
 * Agenda items for the events in a window. An all-day event sits on its own date, with no time. Pure.
 * @param {Array<object>} events - readFeedEvents events
 * @param {Array<object>} leads
 * @param {{days: string[]}} win
 */
export const meetingItems = (events, leads, win) => events.flatMap((e) => {
  const who = meetingWith(e, leads);
  const at = e.allDay ? { day: dayOfUtc(e.startMs) } : { ...stampOf(e.startMs), endTime: stampOf(e.endMs).time };
  if (!win.days.includes(at.day)) return [];
  const lead = who.find((w) => w.leadId) ?? null;
  return [{
    id: `meeting:${e.key}`, source: 'meeting', lane: 'me', ...at,
    title: e.title, status: 'open', calendar: e.feed,
    ...(who.length ? { with: who.map((w) => w.name) } : {}),
    ...(lead ? { leadId: lead.leadId, leadName: lead.name } : {}),
    ...(isLink(e.place) ? { link: e.place } : e.link ? { link: e.link } : {}),
    ...(e.place && !isLink(e.place) ? { place: e.place } : {}),
    ...(e.ruleUnread ? { note: 'repeats in a way this calendar does not read: only its first time is shown' } : {}),
  }];
});

/** impure — the meeting source for one house. A calendar that could not be read is a gap, said by name. */
export const calendarSource = async ({ wallet, win }) => {
  const read = await readFeedEvents(wallet, { fromMs: win.fromMs, toMs: win.toMs });
  const leads = await leadLedgerFor(wallet).then((l) => l.load()).catch(() => []);
  // A call standing on a lead is on the calendar whether or not any calendar was added (booked-calls.js leadCalls).
  const calls = meetingItems(leadCalls(leads, win, read.events), leads, win);
  if (read.off) return { items: calls, standing: [{ id: 'calendars-off', source: 'meeting', lane: 'me', title: `${read.feeds} calendar${read.feeds === 1 ? '' : 's'} added, not read: turn on "Your calendars" under CONNECTIONS`, every: 'off' }] };
  if (!read.feeds) return { items: calls };
  const items = [...meetingItems(read.events, leads, win), ...calls].sort((a, b) => `${a.day} ${a.time ?? ''}`.localeCompare(`${b.day} ${b.time ?? ''}`));
  if (read.gaps.length) throw Object.assign(new Error(read.gaps.map((g) => `${g.feed}: ${g.why}`).join('; ')), { items });
  return { items };
};
