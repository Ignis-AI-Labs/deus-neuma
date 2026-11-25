/**
 * IMPORT LEADS THROUGH THE REAL ROUTE (POST /api/v1/revenue/lead-engine/import) — Design note, 2026-11-18: […]
 * A real app, a real signed session, a real house ledger on temp disk (RULE 0): the file goes as text, a dry run says
 * what would happen and writes nothing, the import writes the leads and the do-not-contact entries, the lead engine
 * then shows each with its messages and what is due, and an import done twice adds nobody twice.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import process from 'node:process';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { readSuppressions } from '../../backend/services/sales/sales-store.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { stageDraft, readOutbox } from '../../backend/services/sales/email-outbox.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const person = (i, extra = {}) => ({ name: `Person ${i}`, email: `p${i}@studio${i}.io`, company: `Studio ${i}`, campaign: 'Video creators', project: 'Deus Neuma', outcome: 'none',
  messages: [{ at: '2026-11-18T06:00:00Z', way: 'out', from: `e@lookalike${i % 7}.co`, signedAs: 'Ethan Wells', subject: 'Video', text: `Hi Person ${i}, ${'a local assistant for your studio. '.repeat(6)}` }], flags: ['invented-sender'], ...extra });
const FILE = JSON.stringify({ kind: 'lead-import', source: 'explee', people: [
  person(1, { name: 'Andreas Saplaouras', email: 'andreas@slas.gr', outcome: 'interested', messages: [...person(1).messages, { at: '2026-11-18T11:26:00Z', way: 'in', text: 'Could you share a demo and pricing?' }] }),
  person(2, { outcome: 'unsubscribed' }),
  person(3, { email: 'g****@metalex.tech' }),
  ...Array.from({ length: 400 }, (_, i) => person(i + 10)),
] });

describe('IMPORT LEADS — another tool\'s people, onto the house\'s own list', () => {
  let me, app;
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const send = (text, dry) => as(request(app).post(`/api/v1/revenue/lead-engine/import${dry ? '?dry=1' : ''}`)).set('Content-Type', 'text/plain').send(text);

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'lead-import-test-key';
    useTempRealm();
    setWorkspacesRoot(path.join(await createTempDir('lead-import'), 'workspaces'));
    me = await fullAuth();
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
  }, 60000);

  afterAll(() => {
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('a dry run says what would happen and writes nothing; the file is far past the JSON limit and still goes', async () => {
    expect(FILE.length).toBeGreaterThan(150_000);
    const dry = await send(FILE, true);
    expect(dry.status, JSON.stringify(dry.body).slice(0, 300)).toBe(200);
    expect(dry.body).toMatchObject({ ok: true, dry: true, source: 'explee', counts: { people: 403, add: 402, interested: 1, suppress: 1, flagged: 402, skip: 1 } });
    expect(dry.body.skipped).toEqual([expect.objectContaining({ why: 'the tool hid the address (it shows it only once someone replies)' })]);
    expect(await (await leadLedgerFor(me.address)).load()).toEqual([]);
    expect(await request(app).post('/api/v1/revenue/lead-engine/import').set('Content-Type', 'text/plain').send(FILE).then((r) => r.status)).toBe(401);
    expect((await send('name,company\nJo,Acme\n')).body.error).toBe('the CSV needs an email column');
  });

  test('the import writes every lead with its messages, puts the unsubscribed on the do-not-contact list, and the engine shows the reply waiting for an answer', async () => {
    const done = await send(FILE);
    expect(done.body).toMatchObject({ ok: true, dry: false, added: 402, suppressed: 1 });
    expect((await readSuppressions(me.address)).map((s) => [s.value, s.reason])).toEqual([['p2@studio2.io', 'unsubscribed']]);
    const engine = (await as(request(app).get('/api/v1/revenue/lead-engine'))).body;
    const andreas = engine.leads.find((l) => l.contact === 'andreas@slas.gr');
    expect(andreas).toMatchObject({ status: 'replied', kind: 'buyer', channel: 'email' });
    // Who found the company and the address is said on the lead itself (Design note, 2026-11-18: […]).
    expect(andreas.foundBy).toEqual({ company: 'Explee', address: 'Explee' });
    expect(engine.spentBy).toEqual({});
    expect(andreas.thread.map((m) => [m.way, m.channel, m.from])).toEqual([['out', 'email', 'e@lookalike1.co'], ['in', 'email', null]]);
    expect(andreas.thread[0].note).toMatch(/^emailed by explee as "Ethan Wells" <e@lookalike1\.co>: "Video"\n\nHi Person 1/);
    expect(engine.upkeep.filter((u) => u.kind === 'answer').map((u) => u.name)).toEqual(['Andreas Saplaouras at Studio 1']);
    // Done twice, nobody comes twice.
    expect((await send(FILE)).body).toMatchObject({ added: 0, counts: { add: 0, skip: 403 } });
    expect(await (await leadLedgerFor(me.address)).load()).toHaveLength(402);
  }, 60000);

  test('a CSV with an email column comes in the same way', async () => {
    const csv = 'email,first_name,last_name,company_name,job_title,emails_sent,first_sent_at,status,replied\nnew@agency.io,Mia,Lund,Agency,Founder,1,2026-11-18T06:00:00Z,,false\n';
    expect((await send(csv)).body).toMatchObject({ ok: true, added: 1 });
    expect((await (await leadLedgerFor(me.address)).load()).find((l) => l.contact === 'new@agency.io')).toMatchObject({ name: 'Mia Lund, Founder at Agency', status: 'contacted', source: 'imported from csv' });
  });

  test('the operator deletes staged emails through the route: never sent, off the list (Design note, 2026-11-18', async () => {
    const a = await stageDraft(me.address, { to: ['andreas@slas.gr'], subject: 'One', text: 'Hello Andreas, the words of a staged email.', by: 'merc' });
    const b = await stageDraft(me.address, { to: ['p10@studio10.io'], subject: 'Two', text: 'Hello there, the words of another staged email.', by: 'merc' });
    const res = await as(request(app).post('/api/v1/revenue/lead-engine/outbox/delete')).send({ ids: [a.id, b.id, 'm-00000000'] });
    expect(res.body).toEqual({ ok: true, deleted: [a.id, b.id], missing: ['m-00000000'] });
    expect((await readOutbox(me.address)).drafts.filter((d) => [a.id, b.id].includes(d.id)).map((d) => [d.state, d.why])).toEqual([['withdrawn', 'deleted by the operator'], ['withdrawn', 'deleted by the operator']]);
    expect((await as(request(app).post('/api/v1/revenue/lead-engine/outbox/delete')).send({})).status).toBe(400);
  });
});
