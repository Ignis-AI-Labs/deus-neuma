/**
 * A CALL BOOKED BY HAND (sales/call, sales/booked-calls.js bookCall + leadCalls). Design note, 2026-11-20: the sales member
 * found a booking in the mailbox, verified it two ways, and […]: CALLS read 0 BOOKED,
 * because a call reached the pipeline only through a calendar the operator had added.
 *
 * The seat's real act through the real sweep, the real lead ledger, the real house agenda and the real reminders
 * writing real notifications — with NO calendar added and the calendar connection never turned on. No mocks (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import process from 'node:process';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { readCall, bookCall, cancelCall, callOf, callOffOf, leadCalls } from '../../backend/services/sales/booked-calls.js';
import { houseAgenda } from '../../backend/services/house-agenda/house-agenda.js';
import { remindHouse } from '../../backend/services/calendar/meeting-reminders.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { croDesignation } from '../../backend/services/revenue/cro-designation.js';
import { rigFor } from '../helpers/sales-mail-kit.js';
import { usePositionHouse, ownLane, POSITION_HOUSE } from '../helpers/position-house.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const MIN = 60_000;
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

describe('a call is read as it is filed (pure)', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  test('the time carries its own zone, or it is refused; the link is https or left out', () => {
    expect(readCall({ at: '2026-11-23T19:00:00-07:00', title: '  Intro   with Keith ', link: 'https://calendly.example/e/abc' }, now)).toEqual({ ok: true, call: { at: '2026-11-24T02:00:00.000Z', title: 'Intro with Keith', link: 'https://calendly.example/e/abc' } });
    expect(readCall({ at: '2026-11-24T02:00:00Z' }, now)).toMatchObject({ ok: true, call: { title: 'Call', link: null } });
    expect(readCall({ at: '2026-11-23T19:00:00' }, now).reason).toMatch(/with its time zone/);
    expect(readCall({ at: 'Monday 7pm' }, now).reason).toMatch(/with its time zone/);
    expect(readCall({ at: '2026-11-10T19:00:00Z' }, now).reason).toMatch(/more than a day ago/);
    expect(readCall({ at: '2026-11-24T02:00:00Z', link: 'http://plain.example' }, now).reason).toMatch(/^link:/);
  });

  test('the calls on the leads stand as calendar events; one a calendar already holds is left to it; a lost lead\'s is not shown', () => {
    const at = '2026-11-24T02:00:00.000Z';
    const lead = (id, extra = {}) => ({ id, name: `Lead ${id}`, contact: `${id}@x.example`, status: 'qualified', touches: [{ callAt: at, callTitle: 'Intro', callLink: 'https://meet.example/x' }], ...extra });
    const win = { fromMs: now, toMs: now + 30 * 86_400_000 };
    expect(leadCalls([lead('a'), lead('b', { status: 'lost' }), lead('c', { touches: [] })], win)).toEqual([{
      key: `lead-call:a:${Date.parse(at)}`, startMs: Date.parse(at), endMs: Date.parse(at) + 30 * MIN, allDay: false, title: 'Intro', feed: 'the sales pipeline',
      attendees: [{ email: 'a@x.example', name: 'Lead a' }], organizer: null, place: null, link: 'https://meet.example/x',
    }]);
    expect(leadCalls([lead('a')], win, [{ startMs: Date.parse(at), attendees: [{ email: 'A@x.example' }] }])).toEqual([]);
    expect(leadCalls([lead('a')], { fromMs: now, toMs: now + MIN })).toEqual([]);
  });
});

describe('the seat files a call it verified; the operator sees it everywhere, with no calendar added', () => {
  const LANE = 'merccall';
  let dir; let position; let keith; let filed = 0; let at;
  const priorRoot = process.env.WORKSPACES_ROOT;
  const actAs = async (type, payload) => {
    filed += 1;
    const intents = path.join(workspace.pathFor(LANE), 'intents');
    await fsp.mkdir(intents, { recursive: true });
    await fsp.writeFile(path.join(intents, `act-${filed}.json`), JSON.stringify({ type, ...payload }));
    return (await sweepIntents(rigFor(LANE, POSITION_HOUSE).connection, { mode: 'ask', lanePolicy: null, emit: () => {} }))[0];
  };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-call-'));
    process.env.WORKSPACES_ROOT = dir;
    position = usePositionHouse(dir);
    await workspace.create(LANE);
    await ownLane(LANE);
    await croDesignation.designate(POSITION_HOUSE, LANE);
    const ledger = await leadLedgerFor(POSITION_HOUSE);
    keith = (await ledger.add({ name: 'Keith Driver', contact: 'keith@driverprojects.example', channelId: 'email', kind: 'investor', status: 'replied', addedBy: LANE }));
    at = Math.floor((Date.now() + 70 * 3600_000) / MIN) * MIN; // about three days out, to the minute
  }, 60000);
  afterAll(() => {
    position?.restore();
    if (priorRoot === undefined) delete process.env.WORKSPACES_ROOT; else process.env.WORKSPACES_ROOT = priorRoot;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a call is filed onto a lead, with where it was verified — never onto a stranger, never on a bare time, never on expectation', async () => {
    const iso = new Date(at).toISOString();
    expect((await actAs('sales/call', { lead: 'nobody@elsewhere.example', at: iso, title: 'Intro', source: 'mail #412' })).error).toMatch(/is no lead on this house's ledger/);
    expect((await actAs('sales/call', { lead: keith.id, at: iso.slice(0, 19), title: 'Intro', source: 'mail #412' })).error).toMatch(/with its time zone/);
    expect((await actAs('sales/call', { lead: keith.id, at: iso, title: 'Intro' })).error).toMatch(/source: where you verified this/);

    const done = await actAs('sales/call', { lead: 'Keith@DriverProjects.example', at: iso, title: 'Keith Driver — New Event', link: 'https://calendly.example/events/abc', source: 'mail #412, Calendly "New Event", and he accepted the invitation' });
    expect(done.status, done.error).toBe('ok');
    expect(done.content).toMatch(/The call with Keith Driver is booked for .* It stands under CALLS in the pipeline and on your operator's calendar/);
    const lead = (await (await leadLedgerFor(POSITION_HOUSE)).load()).find((l) => l.id === keith.id);
    expect(lead.status).toBe('qualified');
    expect(callOf(lead)).toEqual({ at: iso, title: 'Keith Driver — New Event', link: 'https://calendly.example/events/abc' });
    expect(lead.touches.at(-1).note).toContain('verified from mail #412');
    // Filed twice, written once.
    expect((await actAs('sales/call', { lead: keith.id.slice(0, 8), at: iso, title: 'Keith Driver — New Event', source: 'mail #412' })).content).toMatch(/already on the record/);
    expect((await (await leadLedgerFor(POSITION_HOUSE)).load()).find((l) => l.id === keith.id).touches.filter((t) => t.callAt)).toHaveLength(1);
  }, 60000);

  test('it stands on the house calendar, on the operator\'s own row, at its real time, with who it is with and its link', async () => {
    const agenda = await houseAgenda(POSITION_HOUSE, { from: dayKey(at), to: dayKey(at) });
    const meeting = agenda.items.find((i) => i.source === 'meeting');
    expect(meeting).toMatchObject({ lane: 'me', title: 'Keith Driver — New Event', day: dayKey(at), calendar: 'the sales pipeline', with: ['Keith Driver'], leadId: keith.id, leadName: 'Keith Driver', link: 'https://calendly.example/events/abc' });
    expect(agenda.gaps).toEqual([]);
  }, 30000);

  test('it is announced an hour before and ten minutes before, once each; a call that moved is announced at its new time', async () => {
    const titles = async () => (await readNotifications(POSITION_HOUSE)).records.filter((n) => n.kind === 'meeting').map((n) => n.title);
    expect(await remindHouse(POSITION_HOUSE, { now: at - 3 * 3600_000 })).toMatchObject({ meetings: 1, said: 0 }); // the first look marks what is there
    expect(await remindHouse(POSITION_HOUSE, { now: at - 50 * MIN })).toMatchObject({ said: 1 });
    expect(await remindHouse(POSITION_HOUSE, { now: at - 49 * MIN })).toMatchObject({ said: 0 });
    expect(await remindHouse(POSITION_HOUSE, { now: at - 9 * MIN })).toMatchObject({ said: 1 });
    const said = await titles();
    expect(said.filter((t) => /^In an hour \(.*\): Keith Driver — New Event with Keith Driver$/.test(t))).toHaveLength(1);
    expect(said.filter((t) => t === 'In 10 minutes: Keith Driver — New Event with Keith Driver')).toHaveLength(1);
    const ten = (await readNotifications(POSITION_HOUSE)).records.find((n) => n.title.startsWith('In 10 minutes'));
    expect(ten.detail).toBe('Join: https://calendly.example/events/abc From the sales pipeline (CALLS).');

    // The operator moves it a day on, by hand: the lead carries the new time, and the old one is no longer on the calendar.
    const moved = readCall({ at: new Date(at + 24 * 3600_000).toISOString(), title: 'Keith Driver — moved' });
    expect(await bookCall(POSITION_HOUSE, { leadId: keith.id, call: moved.call, by: 'operator' }, { now: at - 9 * MIN })).toMatchObject({ ok: true, again: false, moved: true, from: new Date(at).toISOString() });
    const after = (await (await leadLedgerFor(POSITION_HOUSE)).load()).find((l) => l.id === keith.id);
    expect(callOf(after)).toMatchObject({ at: moved.call.at, movedFrom: new Date(at).toISOString() });
    expect(after.touches.at(-1).note).toMatch(/^call MOVED to .* \(was .*\): "Keith Driver — moved"/);
    const events = leadCalls(await (await leadLedgerFor(POSITION_HOUSE)).load(), { fromMs: at - 3600_000, toMs: at + 48 * 3600_000 });
    expect(events.map((e) => [e.title, e.startMs])).toEqual([['Keith Driver — moved', at + 24 * 3600_000]]);
    expect(await remindHouse(POSITION_HOUSE, { now: at + 24 * 3600_000 - 9 * MIN })).toMatchObject({ said: 2 }); // new to the calendar, and ten minutes off
  }, 60000);

  test('the seat files a reschedule and a cancellation it read: the operator is told each time; called off, the call leaves the calendar and the lead stays open', async () => {
    const told = async () => (await readNotifications(POSITION_HOUSE)).records.filter((n) => n.kind === 'meeting').map((n) => n.title);
    const next = new Date(Math.floor((Date.now() + 100 * 3600_000) / MIN) * MIN).toISOString();
    const again = await actAs('sales/call', { lead: keith.id, at: next, title: 'Keith Driver — rescheduled', source: 'mail #430, Calendly "Rescheduled"' });
    expect(again.status, again.error).toBe('ok');
    expect(again.content).toMatch(/^The call with Keith Driver MOVED to .* \(was .*\)\. CALLS, your operator's calendar and the reminders follow the new time, and your operator was told\./);
    expect((await told()).filter((t) => t.startsWith('Call moved: Keith Driver — now '))).toHaveLength(1);

    expect((await actAs('sales/call', { lead: keith.id, cancelled: true })).error).toMatch(/source: where you verified this/);
    const off = await actAs('sales/call', { lead: keith.id, cancelled: true, source: 'mail #441, Calendly "Canceled"' });
    expect(off.status, off.error).toBe('ok');
    expect(off.content).toMatch(/is called off: it has left CALLS and your operator's calendar, and they were told\. The lead stays open/);
    expect((await told()).filter((t) => t.startsWith('Call called off: Keith Driver — was '))).toHaveLength(1);
    const lead = (await (await leadLedgerFor(POSITION_HOUSE)).load()).find((l) => l.id === keith.id);
    expect(callOf(lead)).toBeNull();
    expect(callOffOf(lead)).toMatchObject({ at: next, title: 'Keith Driver — rescheduled', by: LANE });
    expect(lead.status).toBe('qualified'); // a call that fell through is not a no
    expect(leadCalls([lead], { fromMs: 0, toMs: Date.now() + 366 * 86_400_000 })).toEqual([]);
    const day = dayKey(Date.parse(next));
    expect((await houseAgenda(POSITION_HOUSE, { from: day, to: day })).items.filter((i) => i.source === 'meeting')).toEqual([]);
    // Nothing left to call off; and a new call books cleanly after one was called off, as a booking (not a move).
    expect((await actAs('sales/call', { lead: keith.id, cancelled: true, source: 'mail #441' })).error).toMatch(/no call is booked with Keith Driver/);
    expect(await cancelCall(POSITION_HOUSE, { leadId: keith.id, by: 'operator' })).toEqual({ ok: false, reason: 'no call is booked with them' });
    expect(await bookCall(POSITION_HOUSE, { leadId: keith.id, call: readCall({ at: next, title: 'Third time' }).call, by: 'operator' })).toMatchObject({ ok: true, moved: false });
    const back = (await (await leadLedgerFor(POSITION_HOUSE)).load()).find((l) => l.id === keith.id);
    expect(callOf(back)).toEqual({ at: next, title: 'Third time', link: null });
    expect(callOffOf(back)).toBeNull();
  }, 60000);
});
