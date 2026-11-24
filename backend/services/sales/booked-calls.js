// BOOKED CALLS — a meeting on the operator's calendar with someone on the lead ledger is a call the pipeline won
// (Design note, 2026-11-20: […]). It is written
// onto the lead once: the lead reads as qualified with […], the REPLIES row shows when, and the
// sales member's briefing lists it so it prepares the operator for the call with what the house knows of them.
//
// Read from the calendars the operator added (calendar/calendar-feeds.js): a booking page puts the person it was
// booked by on the event as an attendee, and that address is matched to the lead's. Nothing is guessed from a title.
//
// A call is also BOOKED BY HAND (Design note, 2026-11-20: the sales member verified a call from the mailbox and […]): the sales member who verified one files it with sales/call, the operator adds one under CALLS.
// Either way it is the same record on the lead, and every call on a lead stands on the house calendar and is
// announced like any meeting (leadCalls) — whether or not a calendar was ever added.
// PURE but for noteBookedCalls and bookCall (the lead ledger).

import { leadLedgerFor } from '../leads/lead-ledger.js';
import { normalizeEmail } from './suppress-shape.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';

const OPEN = new Set(['cold', 'contacted', 'replied']);
const MEETING_HOSTS = Object.freeze(['zoom.us', 'zoom.com', 'meet.google.com', 'teams.microsoft.com', 'teams.live.com', 'webex.com', 'webex.meetings.com', 'calendly.com', 'whereby.com', 'meet.jit.si']);

/** The verified meeting host of a join link, or null for a non-meeting/unsafe URL. Pure. */
export const meetingHost = (link) => {
  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return MEETING_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)) ? host : null;
  } catch {
    return null;
  }
};
const mark = (key) => `[call ${key}]`;
const whenWords = (ms) => `${new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

/**
 * The calls among a list of calendar events: each event with a lead among its invited people. Pure.
 * @param {Array<object>} events - calendar occurrences (ics-read.js occurrencesIn)
 * @param {Array<object>} leads
 * @returns {Array<{key: string, leadId: string, leadName: string, address: string, startMs: number, endMs: number, title: string, link: ?string}>}
 */
export const callsAmong = (events, leads) => {
  const byAddress = new Map(leads.map((l) => [normalizeEmail(l.contact), l]).filter(([a]) => a));
  return events.flatMap((e) => (e.attendees ?? []).filter((a) => !a.declined && byAddress.has(normalizeEmail(a.email))).map((a) => {
    const lead = byAddress.get(normalizeEmail(a.email));
    return { key: e.key, leadId: lead.id, leadName: lead.name || lead.contact, address: normalizeEmail(a.email), startMs: e.startMs, endMs: e.endMs, title: e.title, link: /^https:\/\/\S+$/.test(String(e.place ?? '')) ? e.place : e.link ?? null };
  }));
};

// Every note on a lead that booked a call or called one off, oldest first.
const callNotes = (lead) => (lead?.touches ?? []).filter((t) => typeof t.callAt === 'string' || t.callOff === true);

/**
 * The call a lead has coming (or its latest), from the notes on the lead: null when it was called off. A call that
 * moved says the time it was moved from. Pure.
 * @returns {?{at: string, title: ?string, link: ?string, movedFrom?: string, from: 'calendar'|'hand'}}
 */
export const callOf = (lead) => {
  const notes = callNotes(lead);
  const touch = notes.at(-1);
  if (!touch || touch.callOff) return null;
  const prior = notes.at(-2);
  return { at: touch.callAt, title: touch.callTitle ?? null, link: touch.callLink ?? null, ...(prior && !prior.callOff && prior.callAt !== touch.callAt ? { movedFrom: prior.callAt } : {}), ...(touch.callShow ? { show: touch.callShow } : {}) };
};

/** The call a lead HAD, when the last word on it is that it was called off: when it was for, when it was called off, by whom. Pure. */
export const callOffOf = (lead) => {
  const notes = callNotes(lead);
  const off = notes.at(-1);
  const was = notes.at(-2);
  return off?.callOff && was?.callAt ? { at: was.callAt, title: was.callTitle ?? null, offAt: off.at ?? null, by: off.by ?? null } : null;
};
// Whether the call standing on a lead was read off a calendar (so the calendar is what moves or removes it).
const fromCalendar = (lead) => callNotes(lead).at(-1)?.by === 'calendar';

// impure — a call moved or called off by someone other than the operator is said to the operator at once. Never throws.
const tell = (house, lead, title, detail, ref) => notifyOperator({ wallet: house, kind: KIND.meeting, standing: STANDING.system, actor: { id: 'calendar', name: 'calendar' }, ref: { lead: lead.id, ...ref }, title: title.slice(0, 200), detail })
  .catch(() => null);

export const CALL_MINUTES = 30;

/**
 * Read a call as it is filed by hand. `at` must say its own time zone (…Z or ±hh:mm): a bare time would be read in
 * whatever zone this machine keeps, and the call would stand an hour or eight off. Pure.
 * @returns {{ok: true, call: {at: string, title: string, link: ?string}}|{ok: false, reason: string}}
 */
export const readCall = ({ at, title, link } = {}, now = Date.now()) => {
  const when = String(at ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(when) || Number.isNaN(Date.parse(when))) return { ok: false, reason: 'at: the call\'s start with its time zone, e.g. "2026-11-23T19:00:00-07:00" or "2026-11-24T02:00:00Z"' };
  const ms = Date.parse(when);
  if (ms < now - 86_400_000) return { ok: false, reason: 'at: that time is more than a day ago — a call is booked for when it will be held' };
  if (ms > now + 366 * 86_400_000) return { ok: false, reason: 'at: that is more than a year away' };
  const where = String(link ?? '').trim();
  if (where && !meetingHost(where)) return { ok: false, reason: 'link: a Zoom, Google Meet, Teams, Webex, Calendly, Whereby or Jitsi meeting address, or leave it out' };
  return { ok: true, call: { at: new Date(ms).toISOString(), title: String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Call', link: where || null } };
};

/**
 * Write a call onto a lead by hand. A lead still open reads as qualified. The same time filed twice is written once. impure.
 * @param {string} house
 * @param {{leadId: string, call: {at: string, title: string, link: ?string}, by: string, source?: string}} booking
 * @returns {Promise<{ok: true, lead: object, again: boolean}|{ok: false, reason: string}>}
 */
export const bookCall = async (house, { leadId, call, by, source = '' }, { now = Date.now() } = {}) => {
  const ledger = await leadLedgerFor(house);
  const lead = (await ledger.load()).find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: 'no lead with that id' };
  const key = `hand:${Date.parse(call.at)}`;
  const prior = callOf(lead);
  if (prior?.at === call.at) return { ok: true, lead, again: true, moved: false };
  // A call still to come that gets another time has MOVED: said as one, with the time it was at.
  const moved = Boolean(prior && Date.parse(prior.at) > now - 3_600_000);
  const done = await ledger.touch(lead.id, {
    ...(OPEN.has(lead.status) ? { status: 'qualified' } : {}), call,
    note: `call ${moved ? `MOVED to ${whenWords(Date.parse(call.at))} (was ${whenWords(Date.parse(prior.at))})` : `booked for ${whenWords(Date.parse(call.at))}`}: "${call.title}"${source ? ` — verified from ${String(source).slice(0, 160)}` : ''} ${mark(key)}`, by,
  });
  if (!done.ok) return { ok: false, reason: done.reason ?? 'the lead could not be written to' };
  if (by !== 'operator') await tell(house, lead, moved ? `Call moved: ${lead.name || lead.contact} — now ${whenWords(Date.parse(call.at))} (was ${whenWords(Date.parse(prior.at))})` : `Call booked: ${lead.name || lead.contact} — ${whenWords(Date.parse(call.at))}`, `"${call.title}". It is under CALLS in the sales pipeline and on your house calendar.${source ? ` Verified from ${String(source).slice(0, 160)}.` : ''}`, { call: call.at, moved });
  return { ok: true, lead: done.lead, again: false, moved, ...(moved ? { from: prior.at } : {}) };
};

/**
 * Call a lead's call off. It leaves CALLS and the house calendar, is never announced again, and stays on the lead's
 * record as a call that was called off. The lead is not closed: a call that fell through is not a no. impure.
 * @param {string} house
 * @param {{leadId: string, by: string, why?: string}} off
 * @returns {Promise<{ok: true, lead: object, was: object}|{ok: false, reason: string}>}
 */
export const cancelCall = async (house, { leadId, by, why = '' }) => {
  const ledger = await leadLedgerFor(house);
  const lead = (await ledger.load()).find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: 'no lead with that id' };
  const was = callOf(lead);
  if (!was) return { ok: false, reason: 'no call is booked with them' };
  const said = String(why).replace(/\s+/g, ' ').trim().slice(0, 160);
  const done = await ledger.touch(lead.id, { callOff: true, note: `call called off (was ${whenWords(Date.parse(was.at))}: "${was.title ?? 'Call'}")${said ? ` — ${said}` : ''}`, by });
  if (!done.ok) return { ok: false, reason: done.reason ?? 'the lead could not be written to' };
  if (by !== 'operator' && Date.parse(was.at) > Date.now() - 3_600_000) await tell(house, lead, `Call called off: ${lead.name || lead.contact} — was ${whenWords(Date.parse(was.at))}`, `"${was.title ?? 'Call'}"${said ? ` — ${said}` : ''}. It has left CALLS and your house calendar; the lead stays open.`, { call: was.at, off: true });
  return { ok: true, lead: done.lead, was };
};

// WHO SHOWED. Design note, 2026-11-24: […]
// A call whose time has passed is HELD until someone says otherwise. The operator marks it: held, I did not show, or
// they did not show. Nothing is assumed about why, the lead stays open either way, and the note stands on the lead so
// the sales member reads it before it writes to them again (a call the operator missed is owed an apology and a new
// time; one they missed is asked about, never blamed).
export const SHOWS = Object.freeze({ held: 'the call was held', me: 'the operator did not show', them: 'they did not show' });

/**
 * Say who showed for a lead's call. impure.
 * @param {string} house
 * @param {{leadId: string, show: 'held'|'me'|'them', by: string}} said
 * @returns {Promise<{ok: true, lead: object}|{ok: false, reason: string}>}
 */
export const markCallShow = async (house, { leadId, show, by }, { now = Date.now() } = {}) => {
  if (!Object.hasOwn(SHOWS, show)) return { ok: false, reason: 'show: held, me (you did not show) or them (they did not show)' };
  const ledger = await leadLedgerFor(house);
  const lead = (await ledger.load()).find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: 'no lead with that id' };
  const was = callOf(lead);
  if (!was) return { ok: false, reason: 'no call is booked with them' };
  if (Date.parse(was.at) > now) return { ok: false, reason: 'that call has not happened yet — move it or call it off instead' };
  const done = await ledger.touch(lead.id, { call: { at: was.at, title: was.title ?? '', link: was.link ?? '' }, callShow: show, note: `call of ${whenWords(Date.parse(was.at))} ("${was.title ?? 'Call'}"): ${SHOWS[show]}`, by });
  if (!done.ok) return { ok: false, reason: done.reason ?? 'the lead could not be written to' };
  return { ok: true, lead: done.lead };
};

/**
 * The calls standing on the leads, as calendar events in a window — so a call is on the house calendar and is
 * announced whether or not it came from a calendar. One already among `feedEvents` (the same person invited, the same
 * start) is left to the calendar it came from. Pure.
 * @param {Array<object>} leads
 * @param {{fromMs: number, toMs: number}} win
 * @param {Array<object>} [feedEvents]
 */
export const leadCalls = (leads, { fromMs, toMs }, feedEvents = []) => leads.flatMap((lead) => {
  const call = callOf(lead);
  const startMs = call ? Date.parse(call.at) : NaN;
  const address = normalizeEmail(lead.contact);
  if (!(startMs >= fromMs && startMs < toMs) || ['lost'].includes(lead.status)) return [];
  if (feedEvents.some((e) => Math.abs(e.startMs - startMs) < 60_000 && (e.attendees ?? []).some((a) => normalizeEmail(a.email) === address))) return [];
  return [{ key: `lead-call:${lead.id}:${startMs}`, startMs, endMs: startMs + CALL_MINUTES * 60_000, allDay: false, title: call.title || `Call with ${lead.name || lead.contact}`, feed: 'the sales pipeline',
    attendees: address ? [{ email: address, name: lead.name || null }] : [], organizer: null, place: null, link: call.link }];
});

/**
 * Write each call onto its lead, once a call. A RESCHEDULED call is a new time, so it is written again — as MOVED,
 * and the operator is told. A call that was read off a calendar and is NO LONGER ON IT is called off, and the operator
 * is told — only when every calendar was read whole (`complete`) and the call lies inside the window read (`untilMs`):
 * a calendar that could not be read never cancels anything. impure.
 * @param {string} house
 * @param {Array<object>} events
 * @param {{now?: number, complete?: boolean, untilMs?: number}} [look]
 * @returns {Promise<number>} how many leads were written to
 */
export const noteBookedCalls = async (house, events, { now = Date.now(), complete = false, untilMs = 0 } = {}) => {
  const ledger = await leadLedgerFor(house);
  const leads = await ledger.load();
  let noted = 0;
  for (const call of callsAmong(events.filter((e) => e.startMs > now - 3_600_000), leads)) {
    const lead = leads.find((l) => l.id === call.leadId);
    if ((lead.touches ?? []).some((t) => String(t.note ?? '').includes(mark(call.key)))) continue;
    const prior = callOf(lead);
    if (prior?.at === new Date(call.startMs).toISOString()) continue; // already standing at this time (booked by hand first)
    const moved = Boolean(prior && Date.parse(prior.at) > now - 3_600_000);
    const done = await ledger.touch(lead.id, {
      ...(OPEN.has(lead.status) ? { status: 'qualified' } : {}),
      call: { at: new Date(call.startMs).toISOString(), title: call.title, link: call.link },
      note: `call ${moved ? `MOVED to ${whenWords(call.startMs)} (was ${whenWords(Date.parse(prior.at))})` : `booked for ${whenWords(call.startMs)}`}: "${call.title.slice(0, 120)}" ${mark(call.key)}`, by: 'calendar',
    });
    if (!done.ok) continue;
    noted += 1;
    Object.assign(lead, done.lead);
    if (moved) await tell(house, lead, `Call moved: ${lead.name || lead.contact} — now ${whenWords(call.startMs)} (was ${whenWords(Date.parse(prior.at))})`, `"${call.title.slice(0, 120)}". Your calendar shows the new time; CALLS and the reminders follow it.`, { call: new Date(call.startMs).toISOString(), moved: true });
  }
  if (!complete) return noted;
  // What a calendar booked and no calendar holds any more was called off there.
  for (const lead of leads) {
    const call = callOf(lead);
    const startMs = call ? Date.parse(call.at) : NaN;
    if (!fromCalendar(lead) || !(startMs > now + 5 * 60_000 && startMs < untilMs)) continue;
    const address = normalizeEmail(lead.contact);
    if (events.some((e) => Math.abs(e.startMs - startMs) < 60_000 && (e.attendees ?? []).some((a) => !a.declined && normalizeEmail(a.email) === address))) continue;
    if ((await cancelCall(house, { leadId: lead.id, by: 'calendar', why: 'it is no longer on your calendar, or they declined it' })).ok) noted += 1;
  }
  return noted;
};
