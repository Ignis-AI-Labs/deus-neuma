/**
 * YOUR CALENDARS ON THE HOUSE CALENDAR — Design note, 2026-11-20, the day the CRM booked its first call: […]
 *
 * A real calendar served over HTTP on this machine, read through the real feed store (the web guard refuses this
 * machine by design, so the calendar's text is handed over by a plain request, as the company-reader tests do), the
 * real house agenda, the real lead ledger, the real reminders writing real notifications, and the real routes with
 * real auth. No mocks (RULE 0).
 */
/* global URL, fetch */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { parseIcs } from '../../core/calendar/ics-read.js';
import { addFeed, listFeeds, removeFeed, readFeedEvents, feedUrl, forgetFeedCache } from '../../backend/services/calendar/calendar-feeds.js';
import { houseAgenda } from '../../backend/services/house-agenda/house-agenda.js';
import { remindHouse, dueReminders, reminderWords } from '../../backend/services/calendar/meeting-reminders.js';
import { callOf, callOffOf } from '../../backend/services/sales/booked-calls.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import taskRouter from '../../backend/routes/task-routes.js';

const PRIOR = { key: process.env.DNA_ENCRYPTION_KEY, root: getWorkspacesRoot(), switches: process.env.NEUMA_CONNECTIONS_PATH };
const MIN = 60_000;
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

describe('a calendar kept elsewhere, read into the house', () => {
  let me; let server; let base; let switches; let app; let now; let callAt;
  const events = [];
  const serve = () => ['BEGIN:VCALENDAR', 'X-WR-CALNAME:Orrin (work)', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
  // The calendar's text, handed over by a plain request to the server on this machine.
  const fetchCal = async (url) => {
    const u = new URL(url);
    const res = await fetch(`${base}${u.pathname}`);
    if (res.status !== 200) return { ok: false, why: `it answered ${res.status}` };
    const parsed = parseIcs(await res.text());
    return parsed.ok ? { ok: true, ...parsed } : { ok: false, why: 'what is at that address is not a calendar (it must be the calendar\'s iCal address, ending in .ics)' };
  };
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const turn = (on) => fs.writeFileSync(switches, JSON.stringify({ 'calendar-feeds': on }));

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'calendar-feeds-test-key';
    useTempRealm();
    const tmp = await createTempDir('calendar-feeds');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    switches = path.join(os.tmpdir(), `calendar-feeds-switches-${process.pid}.json`);
    process.env.NEUMA_CONNECTIONS_PATH = switches;
    turn(true);
    me = await fullAuth();
    now = Date.now();
    callAt = Math.floor((now + 3 * 3600_000) / 1000) * 1000; // three hours from now, to the second (a calendar keeps no finer)
    events.push([
      'UID:booked-1@google.com', `DTSTART:${stamp(callAt)}`, `DTEND:${stamp(callAt + 15 * MIN)}`, 'SUMMARY:Dana Reyes and the founder',
      'LOCATION:https://meet.example/abc', 'ORGANIZER:mailto:orrin@house.example',
      'ATTENDEE;CN=Dana Reyes:mailto:dana@fundone.example', 'ATTENDEE;CN=Orrin:mailto:orrin@house.example',
    ]);
    server = http.createServer((req, res) => {
      if (req.url === '/private/basic.ics') { res.writeHead(200, { 'content-type': 'text/calendar' }); res.end(serve()); } else if (req.url === '/page.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>Sign in</html>'); } else { res.writeHead(404); res.end('gone'); }
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
    await (await leadLedgerFor(me.address)).add({ name: 'Dana Reyes, Partner at Fund One', contact: 'dana@fundone.example', channelId: 'email', kind: 'investor', status: 'replied', addedBy: 'merc' });
    app = express();
    app.use(express.json());
    app.use('/api/v1/tasks', taskRouter);
  }, 60000);
  afterAll(async () => {
    await new Promise((resolve) => { server.close(resolve); });
    fs.rmSync(switches, { force: true });
    setWorkspacesRoot(PRIOR.root);
    if (PRIOR.key === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = PRIOR.key;
    if (PRIOR.switches === undefined) delete process.env.NEUMA_CONNECTIONS_PATH; else process.env.NEUMA_CONNECTIONS_PATH = PRIOR.switches;
  });

  test('an address is https or it is refused; what is not a calendar is never kept; the address is never shown again', async () => {
    expect(feedUrl('webcal://calendar.example/x/basic.ics')).toBe('https://calendar.example/x/basic.ics');
    expect(feedUrl('http://calendar.example/basic.ics')).toBeNull();
    expect(feedUrl('not an address')).toBeNull();
    expect(await addFeed(me.address, { url: 'ftp://x' })).toMatchObject({ ok: false, reason: expect.stringContaining('private iCal address') });
    expect(await addFeed(me.address, { url: 'https://calendar.example/page.html' }, { fetch: fetchCal })).toMatchObject({ ok: false, reason: expect.stringContaining('is not a calendar') });
    expect(await addFeed(me.address, { url: 'https://calendar.example/nope.ics' }, { fetch: fetchCal })).toMatchObject({ ok: false, reason: 'That calendar could not be read: it answered 404.' });
    expect(await listFeeds(me.address)).toEqual([]);

    const added = await addFeed(me.address, { url: 'webcal://calendar.example/private/basic.ics' }, { fetch: fetchCal });
    expect(added).toMatchObject({ ok: true, feed: { label: 'Orrin (work)', host: 'calendar.example' }, events: 1 });
    expect(await addFeed(me.address, { url: 'https://calendar.example/private/basic.ics' }, { fetch: fetchCal })).toMatchObject({ ok: false, reason: 'that calendar is already here' });
    // The desk's own read: the calendar by name and host, never its address.
    const listed = await as(request(app).get('/api/v1/tasks/calendars'));
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ on: true, calendars: [{ label: 'Orrin (work)', host: 'calendar.example' }] });
    expect(JSON.stringify(listed.body)).not.toContain('/private/basic.ics');
    expect((await request(app).get('/api/v1/tasks/calendars')).status).toBe(401);
    expect((await as(request(app).post('/api/v1/tasks/calendars').send({ url: 'nope' }))).status).toBe(400);
  }, 30000);

  test('the booked call stands on the house calendar, on your own row, with who it is with — named from the lead list — and its link', async () => {
    const agenda = await houseAgenda(me.address, { from: dayKey(callAt), to: dayKey(callAt) });
    const meeting = agenda.items.find((i) => i.source === 'meeting');
    expect(meeting).toMatchObject({
      lane: 'me', title: 'Dana Reyes and the founder', day: dayKey(callAt), status: 'open', calendar: 'Orrin (work)',
      with: ['Dana Reyes, Partner at Fund One'], leadName: 'Dana Reyes, Partner at Fund One', link: 'https://meet.example/abc',
    });
    expect(meeting.time).toMatch(/^\d\d:\d\d$/);
    expect(agenda.gaps).toEqual([]);
  }, 30000);

  test('reminders: the first look says nothing; a meeting booked later is announced once; then an hour before, then ten minutes before — never twice', async () => {
    const titles = async () => (await readNotifications(me.address)).records.filter((n) => n.kind === 'meeting').map((n) => n.title);
    expect(await remindHouse(me.address, { now })).toMatchObject({ meetings: 1, said: 0, booked: 1 }); // what was already there is marked, not announced
    expect(await titles()).toEqual([]);

    // A second call is booked. The calendar is read again when its five minutes are up.
    const second = callAt + 24 * 3600_000;
    events.push(['UID:booked-2@google.com', `DTSTART:${stamp(second)}`, `DTEND:${stamp(second + 30 * MIN)}`, 'SUMMARY:Intro call', 'ATTENDEE;CN=Sam New:mailto:sam@elsewhere.example']);
    const later = now + 6 * MIN;
    const read = await readFeedEvents(me.address, { fromMs: later, toMs: later + 30 * 86_400_000 }, { fetch: fetchCal, now: later });
    expect(read.events.map((e) => e.title)).toEqual(['Dana Reyes and the founder', 'Intro call']);
    expect(await remindHouse(me.address, { now: later })).toMatchObject({ meetings: 2, said: 1 });
    expect((await titles()).filter((t) => t.startsWith('On your calendar: Intro call with Sam New'))).toHaveLength(1);
    expect(await remindHouse(me.address, { now: later + MIN })).toMatchObject({ said: 0 });

    // The cache holds the calendar; the clock moves to 50, then 9 minutes before the first call.
    forgetFeedCache();
    await readFeedEvents(me.address, { fromMs: callAt - 50 * MIN, toMs: callAt + 86_400_000 }, { fetch: fetchCal, now: callAt - 50 * MIN });
    expect(await remindHouse(me.address, { now: callAt - 50 * MIN })).toMatchObject({ said: 1 });
    expect(await remindHouse(me.address, { now: callAt - 49 * MIN })).toMatchObject({ said: 0 });
    expect(await remindHouse(me.address, { now: callAt - 9 * MIN })).toMatchObject({ said: 1 });
    expect(await remindHouse(me.address, { now: callAt - 8 * MIN })).toMatchObject({ said: 0 });
    const said = await titles();
    expect(said.filter((t) => t.startsWith('In an hour ('))).toHaveLength(1);
    expect(said.find((t) => t.startsWith('In 10 minutes: '))).toBe('In 10 minutes: Dana Reyes and the founder with Dana Reyes, Partner at Fund One');
    const ten = (await readNotifications(me.address)).records.find((n) => n.title.startsWith('In 10 minutes'));
    expect(ten.detail).toBe('Join: https://meet.example/abc From the calendar "Orrin (work)".');
  }, 30000);

  test('the call is written onto the lead once: it reads qualified, with when the call is', async () => {
    const [dana] = await (await leadLedgerFor(me.address)).load();
    expect(dana.status).toBe('qualified');
    expect(callOf(dana)).toEqual({ at: new Date(callAt).toISOString(), title: 'Dana Reyes and the founder', link: 'https://meet.example/abc' });
    expect(dana.touches.filter((t) => String(t.note ?? '').startsWith('call booked for'))).toHaveLength(1); // every later look wrote nothing more
  }, 30000);

  test('a call rescheduled on the calendar MOVES on the lead and the operator is told; one removed from it is called off; a calendar that cannot be read cancels nothing', async () => {
    const ledger = await leadLedgerFor(me.address);
    const rae = await ledger.add({ name: 'Rae Okafor', contact: 'rae@fundtwo.example', channelId: 'email', kind: 'investor', status: 'replied', addedBy: 'merc' });
    const find = async () => (await ledger.load()).find((l) => l.id === rae.id);
    const told = async () => (await readNotifications(me.address)).records.filter((n) => n.kind === 'meeting').map((n) => n.title);
    const first = callAt + 48 * 3600_000;
    const moved = first + 3 * 3600_000;
    const event = ['UID:booked-3@google.com', `DTSTART:${stamp(first)}`, `DTEND:${stamp(first + 30 * MIN)}`, 'SUMMARY:Rae Okafor and Orrin', 'ATTENDEE;CN=Rae Okafor:mailto:rae@fundtwo.example'];
    events.push(event);
    const look = async (at) => {
      forgetFeedCache();
      await readFeedEvents(me.address, { fromMs: at, toMs: at + 30 * 86_400_000 }, { fetch: fetchCal, now: at });
      return remindHouse(me.address, { now: at });
    };
    await look(now + 20 * MIN);
    expect(callOf(await find())).toEqual({ at: new Date(first).toISOString(), title: 'Rae Okafor and Orrin', link: null });

    // She reschedules: the same event, three hours later.
    event[1] = `DTSTART:${stamp(moved)}`; event[2] = `DTEND:${stamp(moved + 30 * MIN)}`;
    await look(now + 21 * MIN);
    expect(callOf(await find())).toEqual({ at: new Date(moved).toISOString(), title: 'Rae Okafor and Orrin', link: null, movedFrom: new Date(first).toISOString() });
    expect((await told()).filter((t) => t.startsWith('Call moved: Rae Okafor — now '))).toHaveLength(1);
    await look(now + 22 * MIN);
    expect((await told()).filter((t) => t.startsWith('Call moved: Rae Okafor'))).toHaveLength(1); // said once
    expect((await find()).touches.filter((t) => t.callAt)).toHaveLength(2);

    // The calendar cannot be read: nothing is called off on a gap.
    const whole = events.splice(0, events.length);
    forgetFeedCache();
    await readFeedEvents(me.address, { fromMs: now + 23 * MIN, toMs: now + 30 * 86_400_000 }, { fetch: async () => ({ ok: false, why: 'it answered 503' }), now: now + 23 * MIN });
    await remindHouse(me.address, { now: now + 23 * MIN });
    expect(callOf(await find())).not.toBeNull();

    // She cancels: the event is gone from a calendar that reads whole.
    events.push(...whole.filter((e) => e !== event));
    await look(now + 30 * MIN);
    const rested = await find();
    expect(callOf(rested)).toBeNull();
    expect(callOffOf(rested)).toMatchObject({ at: new Date(moved).toISOString(), by: 'calendar' });
    expect(rested.status).toBe('qualified');
    expect((await told()).filter((t) => t.startsWith('Call called off: Rae Okafor — was '))).toHaveLength(1);
    await look(now + 31 * MIN);
    expect((await told()).filter((t) => t.startsWith('Call called off: Rae Okafor'))).toHaveLength(1);
    expect(callOf((await ledger.load()).find((l) => l.contact === 'dana@fundone.example'))).not.toBeNull(); // hers is still on the calendar
  }, 30000);

  test('what is due for one meeting (pure): nothing after it starts; a whole-day entry is announced, never counted down', () => {
    const at = 1_000_000_000_000;
    expect(dueReminders({ startMs: at, allDay: false }, {}, at - 5 * MIN, false)).toEqual(['new', 'ten']);
    expect(dueReminders({ startMs: at, allDay: false }, { seen: true }, at - 30 * MIN, false)).toEqual(['hour']);
    expect(dueReminders({ startMs: at, allDay: false }, { seen: true, hour: true, ten: true }, at - 5 * MIN, false)).toEqual([]);
    expect(dueReminders({ startMs: at, allDay: false }, {}, at + MIN, false)).toEqual([]);
    expect(dueReminders({ startMs: at, allDay: true }, {}, at - 5 * MIN, false)).toEqual(['new']);
    expect(reminderWords('new', { title: 'Review', startMs: at, allDay: true, place: 'Room 2', feed: 'Work' }, []).detail).toBe('Where: Room 2 From the calendar "Work".');
  });

  test('with the connection off nothing is asked and the calendar says so; removed, its meetings are gone — the call written onto the lead still stands', async () => {
    // Only the call already written onto its lead is left: that one needs no calendar (booked-calls.js leadCalls).
    const kept = [expect.objectContaining({ title: 'Dana Reyes and the founder', calendar: 'the sales pipeline', leadName: 'Dana Reyes, Partner at Fund One', link: 'https://meet.example/abc' })];
    turn(false);
    const off = await houseAgenda(me.address, { from: dayKey(callAt), to: dayKey(callAt) });
    expect(off.items.filter((i) => i.source === 'meeting')).toEqual(kept);
    expect(off.standing.find((s) => s.source === 'meeting').title).toBe('1 calendar added, not read: turn on "Your calendars" under CONNECTIONS');
    turn(true);
    const [feed] = await listFeeds(me.address);
    expect((await as(request(app).delete(`/api/v1/tasks/calendars/${feed.id}`))).status).toBe(200);
    expect((await as(request(app).delete(`/api/v1/tasks/calendars/${feed.id}`))).status).toBe(404);
    expect(await removeFeed(me.address, 'cal-none')).toBe(false);
    expect((await houseAgenda(me.address, { from: dayKey(callAt), to: dayKey(callAt) })).items.filter((i) => i.source === 'meeting')).toEqual(kept);
  }, 30000);
});
