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
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { processToolCalls } = __test;
const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const soulOf = (i) => `0x${String(i + 1).padStart(40, 'c')}`;

const SEGMENT = {
  type: 'sales/segment', name: 'Non-developer founders', offer: 'One-to-one coaching to build your own product with AI tools',
  customerProblem: 'They know what to build and cannot build it', targetRole: 'Founder',
  targetGeography: 'United States, United Kingdom', targetCompanySize: '1–10',
  positiveCriteria: ['Building a software product', 'Founder is not a developer'], negativeCriteria: ['Software agency'],
  exampleClients: ['Smart Maintenance Systems'], why: 'Raw AI tools leave them with half-built parts',
};
const score = (criterion, n) => ({ criterion, score: n, reasoning: `read on their own pages (${n}/5)` });
const company = (domain, fit, extra = {}) => ({
  domain, name: domain.split('.')[0], source: `https://${domain}`,
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
    expect((await act('merc', { ...lead, emailSource: 'https://acme.dev/contact' })).status).toBe('ok');
    const [onLedger] = await (await leadLedgerFor(me.address)).load();
    expect(onLedger).toMatchObject({ name: 'Ada Lovelace, Founder at acme', contact: 'ada@acme.dev', status: 'cold', ownerNeumaId: 'merc', channelId: 'email' });
    expect(onLedger.source).toContain(`lead engine [${segment.id}]`);
    expect((await engine()).prospects[0]).toMatchObject({ stage: 'promoted', leadId: onLedger.id });
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
    expect(briefing).toMatch(/\[s-[a-f0-9]{8}\] Non-developer founders — APPROVED — role: Founder — pool 1 \(strong 0, weak 0, none 1\), on the ledger 1/);
    expect(briefing).toMatch(/SUPPRESSED \[[a-f0-9]{8}\] Ada Lovelace/);
    expect(await mercatorBriefingSection(conn('scout'))).toBe('');
    const [segment] = (await engine()).segments;
    expect((await act('merc', { ...SEGMENT, id: segment.id, targetRole: 'Head of Operations' })).status).toBe('ok');
    expect((await engine()).segments[0]).toMatchObject({ state: 'draft', targetRole: 'Head of Operations' });
  });

  test('the Mercator files the facts; the operator approves them; the briefing carries them and the disclosure line', async () => {
    const facts = [
      { claim: 'One-to-one sessions with the founder, 60 minutes', figure: { value: 60, unit: 'minutes' }, source: 'https://ignislabs.ai/sessions' },
      { claim: 'A session costs 250 US dollars an hour', figure: { value: 250, unit: 'USD' }, source: 'https://ignislabs.ai/sessions' },
      { claim: 'A customer launched his own product after the sessions', source: 'https://ignislabs.ai/testimonials' },
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
    expect(briefing).toContain('- A session costs 250 US dollars an hour [250 USD]');
    expect(briefing).toContain('I am an AI, writing for the company. Reply "stop" and I will not write again.');
  });
});
