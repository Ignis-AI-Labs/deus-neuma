/**
 * LEADS THAT CAME ON THEIR OWN, AND WHAT EACH ONE IS (RULE 0, nothing mocked):
 * a real TLS IMAP server on loopback holding real mail, the house's real
 * reader, the real acts judged for a really seated Mercator who really holds
 * the mailbox, the lead list on tmp disk, the operator's routes behind real
 * auth. The scan names only people on no list; an inbound lead is filed under
 * what it is; only a buyer is worked with the sales pitch and its follow-ups.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { startTlsImap } from '../helpers/imap-tls-kit.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { setEmailCredential } from '../../backend/services/email/email-credentials.js';
import { emailBinding } from '../../backend/services/email/email-binding.js';
import { salesInboundIntents } from '../../backend/services/intents/sales-inbound-acts.js';
import { senderOf, isMachine, missedSenders, scanText } from '../../backend/services/sales/mail-scan.js';
import { leadLedgerFor, LEAD_KINDS, UNSORTED, kindOf, sourceOf } from '../../backend/services/leads/lead-ledger.js';
import { upkeepDue } from '../../backend/services/sales/lead-upkeep.js';
import { leadEmailRefusal } from '../../backend/services/sales/email-ledger.js';
import { addSuppression } from '../../backend/services/sales/sales-store.js';
import { makeSuppression } from '../../backend/services/sales/suppress-shape.js';
import { mercatorBriefingSection } from '../../backend/services/revenue/revenue-briefing.js';
import { leadGroups, groupLine, listLine, statusWords, SCAN_ASK, SORT_ASK, sourceCounts, fromSource, sourceWords } from '../../frontend/app/RelinkShell/company-line/lead-list-view.js';

const [mailScan, inbound, refile] = salesInboundIntents;
const SAVED = Object.fromEntries(['DNA_ENCRYPTION_KEY', 'NEUMA_EMAIL_CREDENTIALS_PATH', 'NEUMA_EMAIL_BINDING_PATH'].map((k) => [k, process.env[k]]));
const PRIOR_ROOT = getWorkspacesRoot();

describe('who wrote to the house, read from envelopes (pure)', () => {
  test('a sender is its address and its name; a machine is not a person', () => {
    expect(senderOf('Jo Smith <Jo@Acme.Example>')).toEqual({ email: 'jo@acme.example', name: 'Jo Smith' });
    expect(senderOf('jo@acme.example')).toEqual({ email: 'jo@acme.example', name: '' });
    expect(['no-reply@acme.example', 'notifications@github.com', 'billing@acme.example', 'x@accounts.google.com', 'not-an-address'].map(isMachine)).toEqual([true, true, true, true, true]);
    expect(['jo@acme.example', 'founder@startup.example', 'careers.jo@webmail.example'].map(isMachine)).toEqual([false, false, false]);
  });

  test('only people on no list are named: not a lead, not do-not-contact, not a machine, not the house', () => {
    const messages = [
      { uid: 9, from: 'Ana <ana@studio.example>', subject: 'Applying for the designer role', date: 'd9' },
      { uid: 8, from: 'no-reply@bank.example', subject: 'Your statement', date: 'd8' },
      { uid: 7, from: 'Raj <raj@fund.example>', subject: 'Intro', date: 'd7' },
      { uid: 6, from: 'Ana <ana@studio.example>', subject: 'Portfolio attached', date: 'd6' },
      { uid: 5, from: 'Known <known@lead.example>', subject: 'Re: hello', date: 'd5' },
      { uid: 4, from: 'Stop <stop@nope.example>', subject: 'hi', date: 'd4' },
      { uid: 3, from: 'House <house@tidewater.example>', subject: 'note to self', date: 'd3' },
    ];
    const scan = missedSenders({ messages, leads: [{ contact: 'Known@Lead.example' }], suppressed: (e) => e.endsWith('@nope.example'), own: ['house@tidewater.example'] });
    expect(scan.counts).toEqual({ read: 7, onList: 1, suppressed: 1, machines: 1, own: 1 });
    expect(scan.missed.map((s) => [s.email, s.name, s.messages.map((m) => m.uid)])).toEqual([['ana@studio.example', 'Ana', [9, 6]], ['raj@fund.example', 'Raj', [7]]]);
    expect(scanText(scan)).toMatch(/^Mailbox scan: 7 message\(s\) read\. 1 from people already on the lead list, 1 from the do-not-contact list, 1 from machines, 1 from the house itself\.\n2 sender\(s\) are on no list:\n- Ana <ana@studio\.example> — 2 message\(s\); newest: uid 9 "Applying for the designer role"/);
    expect(scanText(missedSenders({ messages: [], leads: [], suppressed: () => false }))).toContain('Nobody new');
  });

  test('the lead list reads by kind, the ones owed an answer first', () => {
    const leads = [{ id: '1', name: 'Ana', kind: 'applicant', status: 'replied', updatedAt: '2' }, { id: '2', name: 'Bo', kind: 'buyer', status: 'won', updatedAt: '3' }, { id: '3', name: 'Cy', kind: 'buyer', status: 'replied', updatedAt: '1' }];
    const groups = leadGroups(leads, LEAD_KINDS);
    expect(groups.map((g) => [g.label, g.leads.map((l) => l.name), g.open, g.owed])).toEqual([['BUYERS', ['Cy', 'Bo'], 1, 1], ['APPLICANTS', ['Ana'], 1, 1]]);
    expect(groupLine(groups[0])).toEqual(['2 LEADS', '1 OPEN', { text: '1 OWED AN ANSWER', tone: 'alert' }]);
    expect(listLine(groups)).toEqual(['3 LEADS', '2 BUYERS', '1 APPLICANTS', { text: '2 OWED AN ANSWER', tone: 'alert' }]);
    expect([statusWords({ status: 'replied' }), statusWords({ status: 'cold' })]).toEqual(['THEY WROTE — OWED AN ANSWER', 'NOT WRITTEN TO YET']);
    expect(SCAN_ASK).toMatch(/sales\/mail-scan[\s\S]*sales\/inbound[\s\S]*Do not answer anyone yet/);
  });
});

describe('where a lead came from (pure)', () => {
  test('the lane it was recorded on says; one on no lane is read from how it is reached', () => {
    expect(sourceOf({ channelId: 'linkedin', contact: 'jo@acme.example' })).toBe('linkedin');
    expect(['x.com/Lynx_Protocol', 'https://twitter.com/a', 'jo@acme.example', 'https://www.linkedin.com/in/jo', '@handle', 't.me/room', 'call 555 0100', ''].map((contact) => sourceOf({ channelId: 'other', contact })))
      .toEqual(['x', 'x', 'email', 'linkedin', 'x', 'telegram', 'other', 'other']);
  });

  test('the list counts its leads by source, most first, and shows one source alone on a press', () => {
    const leads = [{ id: '1', channel: 'x', status: 'contacted' }, { id: '2', channel: 'email', status: 'replied' }, { id: '3', channel: 'x', status: 'replied' }, { id: '4', channel: 'other', status: 'cold' }];
    expect(sourceCounts(leads)).toEqual([{ channel: 'x', label: 'X (TWITTER)', n: 2, owed: 1 }, { channel: 'other', label: 'ELSEWHERE', n: 1, owed: 0 }, { channel: 'email', label: 'EMAIL', n: 1, owed: 1 }]);
    expect([fromSource(leads, 'x').map((l) => l.id), fromSource(leads, '').length, fromSource(leads, 'linkedin')]).toEqual([['1', '3'], 4, []]);
    expect([sourceWords('linkedin'), sourceWords('sms'), sourceWords(undefined)]).toEqual(['LINKEDIN', 'SMS', 'OTHER']);
  });
});

describe('nobody is a buyer by default (pure)', () => {
  const x = { id: 'aaaaaaaa11111111', name: 'Lynx Arcade', contact: 'x.com/Lynx_Protocol', channelId: 'x', status: 'contacted', source: '', touches: [{ at: '2026-11-10T00:00:00.000Z', status: 'contacted', note: 'Warm partnership: free listing on their arcade' }] };
  test('a lead nobody sorted is UNSORTED; only one the lead engine scored is a buyer without being told', () => {
    expect([kindOf(x), kindOf({ ...x, kind: 'partner' }), kindOf({ ...x, source: 'lead engine [s-1] Base teams · address: https://a.example' }), kindOf({ ...x, kind: 'nonsense' })]).toEqual([UNSORTED, 'partner', 'buyer', UNSORTED]);
  });

  test('sorting comes first: an unsorted lead is due a sort, never a sales follow-up', () => {
    const now = Date.parse('2026-11-16T00:00:00.000Z');
    expect(upkeepDue({ leads: [x], now }).map((d) => [d.kind, d.leadKind])).toEqual([['sort', 'unsorted']]);
    expect(upkeepDue({ leads: [{ ...x, kind: 'partner' }], now })).toEqual([]);
    expect(upkeepDue({ leads: [{ ...x, kind: 'buyer' }], now }).map((d) => d.kind)).toEqual(['follow-up']);
  });

  test('the list shows the unsorted first, marked, with the ask that hands them to the seat', () => {
    const groups = leadGroups([{ id: '1', name: 'Lynx', kind: 'unsorted', status: 'contacted', updatedAt: '1' }, { id: '2', name: 'Raj', kind: 'buyer', status: 'cold', updatedAt: '2' }], LEAD_KINDS);
    expect(groups.map((g) => [g.label, g.unsorted])).toEqual([['NOT SORTED YET', true], ['BUYERS', false]]);
    expect(groupLine(groups[0])).toEqual([{ text: '1 TO SORT', tone: 'alert' }, '1 OPEN']);
    expect(listLine(groups)).toEqual(['2 LEADS', { text: '1 NOT SORTED YET', tone: 'alert' }, '1 BUYERS']);
    expect(SORT_ASK).toMatch(/in one sales\/kind filing[\s\S]*a vendor is selling to us[\s\S]*Where you cannot tell, say so and ask me/);
  });
});

describe('THE MAILBOX SCAN through the real stack (gnosis)', () => {
  let me, app, imap, rajUid;
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const conn = (neumaId) => ({ companion: { name: neumaId, neumaId }, walletAddress: me.address });
  const run = async (intent, payload, lane = 'merc') => {
    const judged = await intent.validate(payload, { connection: conn(lane) });
    return judged.ok ? intent.execute(judged.value, {}) : judged;
  };
  const engine = async () => (await request(app).get('/api/v1/revenue/lead-engine').use(as)).body;

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'mail-scan-test-key';
    useTempRealm();
    const tmp = await createTempDir('mail-scan');
    process.env.NEUMA_EMAIL_CREDENTIALS_PATH = path.join(tmp, 'email-credentials.json');
    process.env.NEUMA_EMAIL_BINDING_PATH = path.join(tmp, 'email-binding.json');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    for (const [i, id] of ['merc', 'scout'].entries()) {
      await workspace.create(id);
      await fs.writeFile(path.join(tmp, 'workspaces', id, 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
      await fs.mkdir(path.join(tmp, 'workspaces', id, 'identity'), { recursive: true });
      await fs.writeFile(path.join(tmp, 'workspaces', id, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: `0x${String(i + 1).padStart(40, 'c')}` }));
    }
    imap = await startTlsImap(tmp);
    imap.deliver({ from: 'Ana Ruiz <ana@studio.example>', subject: 'Applying for the designer role', body: 'I would like to work with you.' });
    imap.deliver({ from: 'no-reply@bank.example', subject: 'Your statement is ready', body: '...' });
    rajUid = imap.deliver({ from: 'Raj Patel <raj@protocol.example>', subject: 'Can you audit our contracts?', body: 'We launch in March.' });
    imap.deliver({ from: 'Stop <stop@nope.example>', subject: 'hello', body: '...' });
    await setEmailCredential(me.address, { address: 'house@tidewater.example', username: 'house@tidewater.example', password: 'app-password', imapHost: 'localhost', imapPort: String(imap.port), smtpHost: 'localhost', smtpPort: '1' });
    await addSuppression(me.address, makeSuppression({ target: 'nope.example', reason: 'asked', by: 'operator', now: new Date().toISOString() }));
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
    expect((await request(app).put('/api/v1/revenue/seat').use(as).send({ laneId: 'merc' })).status).toBe(200);
  }, 60000);

  afterAll(async () => {
    await imap?.close();
    setWorkspacesRoot(PRIOR_ROOT);
    for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('only the seated Mercator who holds the mailbox scans it', async () => {
    expect(await run(mailScan, {}, 'scout')).toMatchObject({ ok: false, status: 'denied', reason: expect.stringMatching(/only the seated Mercator/) });
    expect(await run(mailScan, {})).toMatchObject({ ok: false, status: 'denied', reason: expect.stringMatching(/the mailbox is not yours to hold/) });
    await emailBinding.bind(me.address, 'email', { neumaId: 'merc' });
    expect(await run(mailScan, { messages: 9999 })).toMatchObject({ ok: false, reason: expect.stringMatching(/messages: a whole number, 1 to 300/) });
    const scan = await run(mailScan, {});
    expect(scan.ok).toBe(true);
    expect(scan.detail).toMatch(/^Mailbox scan: 4 message\(s\) read\. 0 from people already on the lead list, 1 from the do-not-contact list, 1 from machines, 0 from the house itself\.\n2 sender\(s\) are on no list:/);
    expect(scan.detail).toContain(`Raj Patel <raj@protocol.example> — 1 message(s); newest: uid ${rajUid} "Can you audit our contracts?"`);
    expect(scan.detail).toContain('Ana Ruiz <ana@studio.example>');
    expect(scan.detail).not.toContain('bank.example');
  });

  test('a sender is filed under what they are; an address that never wrote is refused', async () => {
    expect(await run(inbound, { email: 'ghost@nowhere.example', name: 'Ghost', kind: 'buyer', about: 'wants an audit' })).toMatchObject({ ok: false, reason: expect.stringMatching(/is not a sender the mailbox shows/) });
    expect(await run(inbound, { email: 'raj@protocol.example', name: 'Raj Patel', kind: 'customer', about: 'wants an audit' })).toMatchObject({ ok: false, reason: expect.stringMatching(/kind: what they are to the house — buyer \(may pay the house\), applicant/) });
    expect(await run(inbound, { email: 'stop@nope.example', name: 'Stop', kind: 'other', about: 'said hello' })).toMatchObject({ ok: false, reason: expect.stringMatching(/do-not-contact list/) });
    expect((await run(inbound, { email: 'raj@protocol.example', name: 'Raj Patel', kind: 'buyer', about: 'wants their contracts audited before a March launch', uid: rajUid })).detail).toMatch(/on the lead list as buyer, owed an answer\. Answer with email\/send; it is checked against the approved facts\./);
    expect((await run(inbound, { email: 'Ana@Studio.example', name: 'Ana Ruiz', kind: 'applicant', about: 'applying for the designer role' })).detail).toMatch(/as applicant, owed an answer\. Answer plainly/);
    expect(await run(inbound, { email: 'ana@studio.example', name: 'Ana', kind: 'buyer', about: 'again, twice over' })).toMatchObject({ ok: false, reason: expect.stringMatching(/already on the lead list as "Ana Ruiz" \(applicant\)/) });
    const leads = await (await leadLedgerFor(me.address)).load();
    expect(leads.map((l) => [l.name, l.contact, kindOf(l), l.status, l.touches[0].direction])).toEqual([['Raj Patel', 'raj@protocol.example', 'buyer', 'replied', 'in'], ['Ana Ruiz', 'ana@studio.example', 'applicant', 'replied', 'in']]);
    expect(leads[0].source).toBe(`mailbox: they wrote first · uid ${rajUid} "Can you audit our contracts?"`);
    // Filed, they are on a list: the next scan names nobody.
    expect((await run(mailScan, {})).detail).toMatch(/2 from people already on the lead list[\s\S]*Nobody new/);
  });

  test('only a buyer is worked with the pitch: its checks, and its follow-up sequence', async () => {
    const leads = await (await leadLedgerFor(me.address)).load();
    const mail = { subject: 'Hello', text: 'Thank you for writing.', laneId: 'merc' };
    expect(await leadEmailRefusal(me.address, { ...mail, to: ['ana@studio.example'] })).toBe(null);
    expect(await leadEmailRefusal(me.address, { ...mail, to: ['raj@protocol.example'] })).toMatch(/does not pass the facts check/);
    // Both are owed an answer today; a contacted applicant is never chased, a contacted buyer is.
    const now = Date.now();
    expect(upkeepDue({ leads, now }).map((d) => [d.kind, d.name, d.leadKind])).toEqual([['answer', 'Raj Patel', 'buyer'], ['answer', 'Ana Ruiz', 'applicant']]);
    const later = leads.map((l) => ({ ...l, status: 'contacted', touches: [...l.touches, { at: new Date(now).toISOString(), direction: 'out', status: 'contacted' }] }));
    expect(upkeepDue({ leads: later, now: now + 4 * 86_400_000 }).map((d) => [d.kind, d.name])).toEqual([['follow-up', 'Raj Patel']]);
  });

  test('the operator reads the list by kind and re-files a lead; the seat can too, with why', async () => {
    const before = await engine();
    expect(before.leadKinds).toEqual(LEAD_KINDS);
    expect(before.leads.map((l) => [l.name, l.kind, l.channel, l.status, l.last])).toEqual([['Raj Patel', 'buyer', 'email', 'replied', 'wants their contracts audited before a March launch'], ['Ana Ruiz', 'applicant', 'email', 'replied', 'applying for the designer role']]);
    const ana = before.leads[1];
    expect((await request(app).post(`/api/v1/revenue/lead-engine/leads/${ana.id}/kind`).use(as).send({ kind: 'employee' })).status).toBe(400);
    expect((await request(app).post('/api/v1/revenue/lead-engine/leads/nope/kind').use(as).send({ kind: 'partner' })).status).toBe(404);
    expect((await request(app).post(`/api/v1/revenue/lead-engine/leads/${ana.id}/kind`).use(as).send({ kind: 'partner' })).body).toEqual({ ok: true, lead: { id: ana.id, kind: 'partner' } });
    expect(await run(refile, { id: ana.id.slice(0, 8), kind: 'partner', why: 'she offers a studio partnership' })).toMatchObject({ ok: false, reason: expect.stringMatching(/already filed as partner/) });
    expect((await run(refile, { id: ana.id.slice(0, 8), kind: 'applicant', why: 'her message asks for the designer role' })).detail).toBe('"Ana Ruiz" is now filed as applicant.');
    const stored = (await (await leadLedgerFor(me.address)).load()).find((l) => l.id === ana.id);
    expect(stored.touches.slice(-2).map((t) => [t.by, t.kindFrom, t.kindTo])).toEqual([['operator', 'applicant', 'partner'], ['merc', 'partner', 'applicant']]);
    expect((await request(app).post(`/api/v1/revenue/lead-engine/leads/${ana.id}/kind`).send({ kind: 'partner' })).status).toBe(401);
    // Leads recorded elsewhere with no kind (a marketing lead from X) are NOT buyers: they wait to be sorted, the
    // seat reads each with its id and its note, and sorts them all in one filing.
    const ledger = await leadLedgerFor(me.address);
    const lynx = await ledger.add({ name: 'Lynx Arcade', contact: 'x.com/Lynx_Protocol', channelId: 'x', status: 'contacted', addedBy: 'aure', note: 'Warm partnership: a free listing on their arcade' });
    const daniel = await ledger.add({ name: 'Daniel K', contact: 'x.com/DanielxK', channelId: 'x', addedBy: 'aure', note: 'Offers a white hat audit of the pools' });
    expect((await engine()).leads.filter((l) => l.kind === 'unsorted').map((l) => [l.name, l.channel])).toEqual([['Lynx Arcade', 'x'], ['Daniel K', 'x']]);
    const told = await mercatorBriefingSection(conn('merc'));
    expect(told).toContain('- NOT SORTED YET: 2. Nobody is a buyer until someone says so. Sort them all now in ONE sales/kind filing');
    expect(told).toContain(`· [${lynx.id.slice(0, 8)}] Lynx Arcade (x.com/Lynx_Protocol) — came from x — Warm partnership: a free listing on their arcade`);
    expect(await run(refile, { leads: [{ id: lynx.id.slice(0, 8), kind: 'partner', why: 'they propose listing our token on their arcade' }, { id: daniel.id.slice(0, 8), kind: 'seller', why: 'offers us an audit' }] }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/^leads\[1\]: kind: buyer \(may pay the house\)/) });
    expect((await run(refile, { leads: [{ id: lynx.id.slice(0, 8), kind: 'partner', why: 'they propose listing our token on their arcade' }, { id: daniel.id.slice(0, 8), kind: 'vendor', why: 'he offers us a security audit, a service sold to us' }] })).detail)
      .toBe('"Lynx Arcade" is now filed as partner. "Daniel K" is now filed as vendor.');
    expect((await engine()).leads.map((l) => [l.name, l.kind])).toEqual([['Raj Patel', 'buyer'], ['Ana Ruiz', 'applicant'], ['Lynx Arcade', 'partner'], ['Daniel K', 'vendor']]);
    // The seat reads its list by kind, and how each kind is worked.
    const briefing = await mercatorBriefingSection(conn('merc'));
    expect(briefing).toMatch(/- BUYER: 1 \(1 open\)\n- APPLICANT: 1 \(1 open\) — answered plainly; the sales pitch and its follow-ups are for buyers only\n- PARTNER: 1 \(1 open\)[^\n]*\n- VENDOR: 1 \(1 open\)[^\n]*\nWhere they came from: email 2, x 2\./);
  });
});
