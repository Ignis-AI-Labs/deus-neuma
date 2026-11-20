/**
 * THE LEAD ENGINE through the real stack (RULE 0, nothing mocked): a real
 * house on tmp disk, the operator seating a Mercator and approving its pitch
 * through the real routers behind REAL auth, the being's filings settled as
 * intents by the REAL portal sweep, the house's real lead ledger taking the
 * leads. Only the seated Mercator files; nothing from a draft segment reaches
 * the ledger; an address is never guessed; the do-not-contact list holds.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import process from 'node:process';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { mercatorBriefingSection } from '../../backend/services/revenue/revenue-briefing.js';
import { leadEmailRefusal } from '../../backend/services/sales/email-ledger.js';
import { judgeCover } from '../../backend/services/sales/sales-cover.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { processToolCalls } = __test;
const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const soulOf = (i) => `0x${String(i + 1).padStart(40, 'c')}`;

const SEGMENT = {
  type: 'sales/segment', name: 'Non-developer founders', offer: 'One-to-one coaching to build your own product with AI tools',
  company: 'ignis', customerProblem: 'They know what to build and cannot build it', targetRole: 'Founder',
  targetGeography: 'United States', countries: ['US'], targetCompanySize: '1–10',
  positiveCriteria: ['Building a software product', 'Founder is not a developer'], negativeCriteria: ['Software agency'],
  exampleClients: ['Smart Maintenance Systems'], why: 'Raw AI tools leave them with half-built parts',
};
const score = (criterion, n) => ({ criterion, score: n, reasoning: `read on their own pages (${n}/5)` });
const company = (domain, fit, extra = {}) => ({
  domain, name: domain.split('.')[0], source: `https://${domain}`, country: 'US',
  scores: [score('Building a software product', fit), score('Founder is not a developer', fit)],
  people: [{ name: 'Ada Lovelace', role: 'Founder', sourceUrl: `https://${domain}/team` }], ...extra,
});

describe('THE LEAD ENGINE through the real stack (gnosis)', () => {
  let me, app, httpServer, wss, serverWs, client, wsRoot;
  const conn = (neumaId) => ({ ws: serverWs, companion: { name: neumaId, neumaId }, walletAddress: me.address, sessionId: `sess-${neumaId}` });
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  let filed = 0;
  const act = async (neumaId, payload) => {
    const dir = path.join(workspace.pathFor(neumaId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    filed += 1;
    await fs.writeFile(path.join(dir, `act-${filed}.json`), JSON.stringify(payload));
    const [result] = await processToolCalls(serverWs, '', conn(neumaId));
    return result;
  };
  const engine = async () => (await request(app).get('/api/v1/revenue/lead-engine').use(as)).body;

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'sales-office-test-key';
    useTempRealm();
    wsRoot = path.join(await createTempDir('sales-office'), 'workspaces');
    setWorkspacesRoot(wsRoot);
    me = await fullAuth();
    for (const [i, id] of ['merc', 'scout'].entries()) {
      await workspace.create(id);
      await fs.writeFile(path.join(wsRoot, id, 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
      await fs.mkdir(path.join(wsRoot, id, 'identity'), { recursive: true });
      await fs.writeFile(path.join(wsRoot, id, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: soulOf(i) }));
    }
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => { wss.on('connection', (ws) => { serverWs = ws; resolve(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    await linked;
    expect((await request(app).put('/api/v1/revenue/seat').use(as).send({ laneId: 'merc' })).status).toBe(200);
  }, 60000);

  afterAll(() => {
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('only the seated Mercator files; a segment needs its role and opens as a draft', async () => {
    expect(await act('scout', SEGMENT)).toMatchObject({ status: 'denied', error: expect.stringMatching(/only the seated Mercator/) });
    expect(await act('merc', { ...SEGMENT, targetRole: '' })).toMatchObject({ status: 'error', error: expect.stringMatching(/targetRole: who to reach/) });
    expect((await act('merc', SEGMENT)).status).toBe('ok');
    const [segment] = (await engine()).segments;
    expect(segment).toMatchObject({ name: 'Non-developer founders', state: 'draft', targetRole: 'Founder' });
    expect(await request(app).get('/api/v1/revenue/lead-engine').then((r) => r.status)).toBe(401);
  });

  test('prospects are scored on every sign of fit, held once each, and nothing reaches the ledger from a draft', async () => {
    const [segment] = (await engine()).segments;
    const missing = { ...company('acme.dev', 4), scores: [score('Building a software product', 4)] };
    expect(await act('merc', { type: 'sales/prospect', segment: segment.id, companies: [missing] })).toMatchObject({ status: 'error', error: expect.stringMatching(/"Founder is not a developer" has no score/) });
    const filing = { type: 'sales/prospect', segment: segment.id, companies: [company('acme.dev', 5), company('beta.dev', 1), company('acme.dev', 4)] };
    expect((await act('merc', filing)).status).toBe('ok');
    const { prospects } = await engine();
    expect(prospects.map((p) => [p.domain, p.match])).toEqual([['acme.dev', 3], ['beta.dev', 1]]);
    const acme = prospects[0];
    const lead = { type: 'sales/lead', id: acme.id, person: 0, email: 'ada@acme.dev', emailSource: 'https://acme.dev/contact' };
    expect(await act('merc', lead)).toMatchObject({ status: 'error', error: expect.stringMatching(/not approved — the operator approves the pitch/) });
  });

  test('the operator approves the pitch; a guessed address is refused; a read one lands on the ledger, cold, the Mercator\'s', async () => {
    const [segment] = (await engine()).segments;
    expect((await request(app).post(`/api/v1/revenue/lead-engine/segments/${segment.id}/state`).use(as).send({ state: 'approved' })).body.segment.state).toBe('approved');
    const [acme, beta] = (await engine()).prospects;
    const lead = { type: 'sales/lead', id: acme.id, person: 0, email: 'ada@acme.dev' };
    expect(await act('merc', lead)).toMatchObject({ status: 'error', error: expect.stringMatching(/never guessed/) });
    expect(await act('merc', { ...lead, id: beta.id, emailSource: 'https://beta.dev/contact' })).toMatchObject({ status: 'error', error: expect.stringMatching(/is no match/) });
    // The country gate: a company outside the audience's countries, or a UK address, never reaches the ledger.
    expect((await act('merc', { type: 'sales/prospect', segment: segment.id, companies: [company('quay.co.uk', 5, { country: 'GB' })] })).status).toBe('ok');
    const quay = (await engine()).prospects.find((p) => p.domain === 'quay.co.uk');
    expect(await act('merc', { ...lead, id: quay.id, email: 'ada@quay.co.uk', emailSource: 'https://quay.co.uk/team' })).toMatchObject({ status: 'error', error: expect.stringMatching(/is in GB, and "Non-developer founders" may only be sent to US/) });
    expect(await act('merc', { ...lead, email: 'ada@acme.co.uk', emailSource: 'https://acme.dev/contact' })).toMatchObject({ status: 'error', error: expect.stringMatching(/is a GB address, and "Non-developer founders" may only be sent to US/) });
    expect((await act('merc', { ...lead, emailSource: 'https://acme.dev/contact' })).status).toBe('ok');
    const [onLedger] = await (await leadLedgerFor(me.address)).load();
    expect(onLedger).toMatchObject({ name: 'Ada Lovelace, Founder at acme', contact: 'ada@acme.dev', status: 'cold', ownerNeumaId: 'merc', channelId: 'email' });
    expect(onLedger.source).toContain(`lead engine [${segment.id}]`);
    expect((await engine()).prospects[0]).toMatchObject({ stage: 'promoted', leadId: onLedger.id });
    // The address is often read AFTER the company was scored (found live, 2026-11-15): the person is filed with the lead.
    expect((await act('merc', { type: 'sales/prospect', segment: segment.id, companies: [company('delta.dev', 4, { people: [] })] })).status).toBe('ok');
    const delta = (await engine()).prospects.find((p) => p.domain === 'delta.dev');
    expect(delta.people).toEqual([]);
    const late = { type: 'sales/lead', id: delta.id, email: 'team@delta.dev', emailSource: 'https://delta.dev/contact' };
    expect(await act('merc', { ...late, person: 0 })).toMatchObject({ status: 'error', error: expect.stringMatching(/has no person filed yet — give \{name, role\}/) });
    expect(await act('merc', { ...late, person: { name: 'Delta team', role: '' } })).toMatchObject({ status: 'error', error: expect.stringMatching(/person: \{name, role\} — who the address belongs to/) });
    expect((await act('merc', { ...late, person: { name: 'Delta team', role: 'contact' } })).status).toBe('ok');
    expect((await (await leadLedgerFor(me.address)).load()).find((l) => l.contact === 'team@delta.dev')).toMatchObject({ name: 'Delta team, contact at delta', status: 'cold' });
    expect((await engine()).prospects.find((p) => p.domain === 'delta.dev')).toMatchObject({ stage: 'promoted', people: [{ name: 'Delta team', role: 'contact', sourceUrl: 'https://delta.dev/contact' }] });
  });

  test('the do-not-contact list holds, from the operator or the Mercator', async () => {
    const [segment] = (await engine()).segments;
    expect((await request(app).post('/api/v1/revenue/lead-engine/suppress').use(as).send({ target: 'gamma.dev', reason: 'customer' })).body.entry).toMatchObject({ kind: 'domain', value: 'gamma.dev' });
    expect((await act('merc', { type: 'sales/suppress', target: 'ada@acme.dev', reason: 'asked' })).status).toBe('ok');
    const refused = await act('merc', { type: 'sales/prospect', segment: segment.id, companies: [company('gamma.dev', 5)] });
    expect(refused.status).toBe('ok');
    expect(JSON.stringify(refused)).toMatch(/Refused gamma\.dev: gamma\.dev is on the do-not-contact list/);
    const { upkeep, suppressions } = await engine();
    expect(suppressions).toHaveLength(2);
    expect(upkeep[0]).toMatchObject({ kind: 'suppressed', name: 'Ada Lovelace, Founder at acme' });
  });

  test('the Mercator reads the engine in its briefing; re-aiming an approved pitch sends it back for approval', async () => {
    const briefing = await mercatorBriefingSection(conn('merc'));
    expect(briefing).toContain('## LEAD ENGINE');
    expect(briefing).toMatch(/\[s-[a-f0-9]{8}\] Non-developer founders \(for ignis\) — APPROVED — role: Founder — sends only to US — pool 2 \(strong 1, weak 0, none 1\), on the ledger 2/);
    expect(briefing).toMatch(/SUPPRESSED \[[a-f0-9]{8}\] Ada Lovelace/);
    expect(await mercatorBriefingSection(conn('scout'))).toBe('');
    const [segment] = (await engine()).segments;
    expect((await act('merc', { ...SEGMENT, id: segment.id, targetRole: 'Head of Operations' })).status).toBe('ok');
    expect((await engine()).segments[0]).toMatchObject({ state: 'draft', targetRole: 'Head of Operations' });
  });

  test('the Mercator files the facts; the operator approves them; the briefing carries them and the disclosure line', async () => {
    const facts = [
      { company: 'ignis', claim: 'One-to-one sessions with the founder, 60 minutes', figure: { value: 60, unit: 'minutes' }, source: 'https://ignislabs.ai/sessions' },
      { company: 'ignis', claim: 'A session costs 250 US dollars an hour', figure: { value: 250, unit: 'USD' }, source: 'https://ignislabs.ai/sessions' },
      { company: 'ignis', claim: 'A customer launched his own product after the sessions', source: 'https://ignislabs.ai/testimonials' },
    ];
    expect(await act('scout', { type: 'sales/facts', facts })).toMatchObject({ status: 'denied' });
    expect(await act('merc', { type: 'sales/facts', facts: facts.slice(0, 2) })).toMatchObject({ status: 'error', error: expect.stringMatching(/at least three/) });
    expect(await mercatorBriefingSection(conn('merc'))).toContain('FACTS: none filed');
    expect((await act('merc', { type: 'sales/facts', facts })).status).toBe('ok');
    const { sheet } = (await engine()).facts;
    expect((await mercatorBriefingSection(conn('merc')))).toContain(`FACTS: sheet [${sheet.id}], waiting for the operator's approval.`);
    expect((await request(app).post(`/api/v1/revenue/lead-engine/facts/${sheet.id}`).use(as).send({ verdict: 'returned', note: 'no' })).status).toBe(409);
    expect((await request(app).post(`/api/v1/revenue/lead-engine/facts/${sheet.id}`).send({ verdict: 'approved' })).status).toBe(401);
    expect((await request(app).post(`/api/v1/revenue/lead-engine/facts/${sheet.id}`).use(as).send({ verdict: 'approved' })).body.facts.approved.id).toBe(sheet.id);
    const briefing = await mercatorBriefingSection(conn('merc'));
    expect(briefing).toContain(`FACTS: sheet [${sheet.id}], APPROVED.`);
    expect(briefing).toContain('- (ignis) A session costs 250 US dollars an hour [250 USD]');
    expect(briefing).toContain('Sign each email as who you are, an AI of the company, never as a person. No set line is required in its words. A way out (reply "stop" and you will not write again) is optional; if you give one, it is one short line at the very end, below your name, never in the body.');
    expect(briefing).not.toContain('I am an AI, writing for the company');
  });

  test('an audience and a fact belong to ONE company of the house; a sister company\'s fact backs nothing in this company\'s email', async () => {
    expect(await act('merc', { ...SEGMENT, name: 'Somebody else\'s buyers', company: 'acme-corp' })).toMatchObject({ status: 'error', error: expect.stringMatching(/"acme-corp" is not a company of this house — the house's companies are: ignis, umbrae/) });
    expect(await act('merc', { ...SEGMENT, name: 'No company named', company: '' })).toMatchObject({ status: 'error', error: expect.stringMatching(/company: the id of the house company this audience is sold for/) });
    const fact = (company, claim, figure) => ({ company, claim, ...(figure ? { figure } : {}), source: 'https://ignislabs.ai/sessions' });
    expect(await act('merc', { type: 'sales/facts', facts: [fact('ignis', 'Sessions are one to one'), fact('nowhere', 'A fact of no company here'), fact('ignis', 'Sessions run 60 minutes', { value: 60, unit: 'minutes' })] }))
      .toMatchObject({ status: 'error', error: expect.stringMatching(/"nowhere" is not a company of this house/) });
    // The 250 figure is now Umbrae's alone. Ada is a lead of the ignis audience: it backs nothing for her.
    expect((await act('merc', { type: 'sales/facts', facts: [fact('ignis', 'Sessions are one to one with the founder'), fact('umbrae', 'A position starts at 250 US dollars', { value: 250, unit: 'USD' }), fact('ignis', 'Sessions run 60 minutes', { value: 60, unit: 'minutes' })] })).status).toBe('ok');
    const { sheet } = (await engine()).facts;
    expect((await request(app).post(`/api/v1/revenue/lead-engine/facts/${sheet.id}`).use(as).send({ verdict: 'approved' })).status).toBe(200);
    const email = (words) => ({ to: ['ada@acme.dev'], subject: 'Your build', text: `${words} May I send two ideas?\n\nMerc`, promise: 'two short written ideas', laneId: 'merc' });
    expect(await leadEmailRefusal(me.address, email('It starts at 250 dollars.'))).toMatch(/250 is not on the approved facts sheet/);
    // Her own company's figure passes the facts check; her address a database confirmed live (a first email needs that,
    // 2026-11-19); what stops it next is only that no model is here to read its claims.
    const { noteAddressCheck } = await import('../../backend/services/sales/sales-store.js');
    await noteAddressCheck(me.address, { email: 'ada@acme.dev', check: { status: 'valid', score: 98, checker: 'Hunter' }, spent: 0.5, by: 'test' });
    expect(await leadEmailRefusal(me.address, email('A session runs 60 minutes.'))).toMatch(/the claims check could not run/);
  });
  test('a lead filed with no audience is put under one, and reads its campaign — no drop, no re-file; moved again, it loses the old list approval', async () => {
    // A lead added by hand: on the ledger, under no audience, so under no campaign.
    const ledger = await leadLedgerFor(me.address);
    const made = await ledger.add({ name: 'Kinetiq', contact: 'team@kinetiq.example', channelId: 'email', source: 'operator', ownerNeumaId: 'merc' });
    const leadId = made.lead?.id ?? made.id;
    const leadOf = async () => (await engine()).leads.find((l) => l.id === leadId);
    expect((await leadOf()).origin ?? null).toBeNull();
    // An audience under a campaign.
    const [segment] = (await engine()).segments;
    const opened = await request(app).post('/api/v1/revenue/lead-engine/campaigns').use(as).send({ name: 'User Acquisition', company: 'ignis', goal: 'first hundred users' });
    expect(opened.status).toBe(200);
    const campaign = (await engine()).campaigns.find((c) => c.name === 'User Acquisition');
    expect((await request(app).post(`/api/v1/revenue/lead-engine/segments/${segment.id}/campaign`).use(as).send({ campaign: campaign.id })).status).toBe(200);

    expect(await act('scout', { type: 'sales/place', lead: leadId, segment: segment.id })).toMatchObject({ status: 'denied' });
    expect(await act('merc', { type: 'sales/place', lead: 'nobody@nowhere.example', segment: segment.id })).toMatchObject({ status: 'error', error: expect.stringMatching(/is not a lead on the ledger/) });
    expect(await act('merc', { type: 'sales/place', lead: leadId, segment: 's-nope' })).toMatchObject({ status: 'error', error: expect.stringMatching(/is not an audience of this house/) });
    // by its address, as the seat knows it
    const placed = await act('merc', { type: 'sales/place', lead: 'team@kinetiq.example', segment: segment.id });
    expect(placed.status).toBe('ok');
    expect(placed.content).toMatch(/now stands under audience "Non-developer founders".*campaign "User Acquisition"/);
    expect((await leadOf()).origin).toMatchObject({ audienceId: segment.id, campaignId: campaign.id, campaign: 'User Acquisition' });
    expect(await act('merc', { type: 'sales/place', lead: leadId, segment: segment.id })).toMatchObject({ status: 'error', error: expect.stringMatching(/already stands under/) });
    // placed, never listed: nothing the operator approved a list of
    const record = (await engine()).prospects.find((p) => p.leadId === leadId);
    expect(record).toMatchObject({ stage: 'promoted', placed: true });
    expect(record.listApproved ?? false).toBe(false);
  });

  test('P6-123: an address away from its company\'s domain is filed, and no approved list covers it — every email to it asks', async () => {
    const [segment] = (await engine()).segments;
    expect((await request(app).post(`/api/v1/revenue/lead-engine/segments/${segment.id}/state`).use(as).send({ state: 'approved' })).status).toBe(200);
    const companies = [company('epsilon.dev', 5), company('zeta.dev', 5)];
    expect((await act('merc', { type: 'sales/prospect', segment: segment.id, companies })).status).toBe('ok');
    const pool = (await engine()).prospects.filter((p) => ['epsilon.dev', 'zeta.dev'].includes(p.domain));
    // The operator approves the list: both companies are on it.
    const listed = await request(app).post(`/api/v1/revenue/lead-engine/segments/${segment.id}/list`).use(as).send({ ids: (await engine()).prospects.filter((p) => p.segmentId === segment.id && p.match >= 2 && p.stage !== 'dropped' && !p.listApproved).map((p) => p.id) });
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const file = (domain, email) => act('merc', { type: 'sales/lead', id: pool.find((p) => p.domain === domain).id, person: 0, email, emailSource: `https://${domain}/contact` });
    const away = await file('epsilon.dev', 'epsilon.studio@mailbox.example');
    expect(away).toMatchObject({ status: 'ok', content: expect.stringMatching(/is not at epsilon\.dev, so no approved list covers it: every email to it waits for your operator's yes/) });
    expect((await file('zeta.dev', 'ada@zeta.dev')).content).not.toMatch(/no approved list covers it/);
    const leads = await (await leadLedgerFor(me.address)).load();
    expect(leads.find((l) => l.contact === 'epsilon.studio@mailbox.example').touches[0].note).toContain('address is not at epsilon.dev: every email to it asks the operator');
    // The cover, on the house's real records: the company's own address goes under the list, the other one asks.
    const state = { leads, prospects: (await engine()).prospects, segments: (await engine()).segments, now: Date.now() };
    expect(judgeCover({ ...state, recipients: ['ada@zeta.dev'] })).toEqual({ covered: true });
    expect(judgeCover({ ...state, recipients: ['epsilon.studio@mailbox.example'] })).toEqual({ covered: false, reason: 'epsilon.studio@mailbox.example is not at epsilon.dev — the list the operator approved is companies' });
  });

  test('P6-70: the operator lifts a do-not-contact entry through the real route; an entry not listed is a 404', async () => {
    const lift = (target) => request(app).post('/api/v1/revenue/lead-engine/suppress/lift').use(as).send({ target });
    expect((await request(app).post('/api/v1/revenue/lead-engine/suppress').use(as).send({ target: 'cfo@wrongly-listed.example', reason: 'bounced' })).status).toBe(200);
    expect((await engine()).suppressions.map((e) => e.value)).toContain('cfo@wrongly-listed.example');
    const lifted = await lift('cfo@wrongly-listed.example');
    expect(lifted.status).toBe(200);
    expect(lifted.body).toMatchObject({ ok: true, entry: { kind: 'email', value: 'cfo@wrongly-listed.example' } });
    expect((await engine()).suppressions.map((e) => e.value)).not.toContain('cfo@wrongly-listed.example');
    expect((await lift('cfo@wrongly-listed.example')).status).toBe(404);
    expect((await request(app).post('/api/v1/revenue/lead-engine/suppress/lift').send({ target: 'gamma.dev' })).status).toBe(401);
  });
});
