/**
 * THE RAISE ROOM's foundation through the real stack (RULE 0, nothing
 * mocked): a real house on tmp disk whose company walks its founding line to
 * STANDING through the real line store; the Quaestor and the Numerarius file
 * their drafts as intents settled by the REAL portal sweep; the operator signs,
 * switches and records counsel through the real router behind REAL auth.
 * No raise for a company that does not stand; no mandate without the
 * operator's signature and counsel's route; no being ever reads the account.
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
import { standCompany } from '../helpers/company-line-kit.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { makeCompany, openCompany, appendLineEvent } from '../../backend/services/company-line/company-store.js';
import { companyLineBriefing } from '../../backend/services/company-line/company-briefing.js';
import { readWaiting } from '../../backend/services/waiting/waiting-sources.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import raiseRouter from '../../backend/routes/raise-routes.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { processToolCalls } = __test;
const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const SEATS = Object.freeze([['spec', 'Speculator'], ['numer', 'Numerarius'], ['arch', 'Architectus'], ['merc', 'Mercator'], ['prae', 'Praetor'], ['quae', 'Quaestor']]);
const soulOf = (i) => `0x${String(i + 1).padStart(40, 'c')}`;
const WALLET_IN = `0x${'7e'.repeat(20)}`;

describe('THE RAISE ROOM — the mandate and the facts (gnosis)', () => {
  let me, other, app, httpServer, wss, serverWs, client, standing, founding;
  const conn = (neumaId) => ({ ws: serverWs, companion: { name: neumaId, neumaId }, walletAddress: me.address, sessionId: `sess-${neumaId}` });
  const as = (who) => (req) => req.set('Authorization', `Bearer ${who.token}`);
  let filed = 0;
  const act = async (neumaId, payload) => {
    const dir = path.join(workspace.pathFor(neumaId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    filed += 1;
    await fs.writeFile(path.join(dir, `act-${filed}.json`), JSON.stringify(payload));
    const [result] = await processToolCalls(serverWs, '', conn(neumaId));
    return result;
  };
  const raiseOf = async (id) => (await request(app).get('/api/v1/raise').use(as(me))).body.raises.find((r) => r.id === id)?.raise;
  const MANDATE = {
    type: 'raise/mandate', amount: 250000, currency: 'USD', instrument: 'safe',
    valuation: { low: 2000000, high: 3000000, basis: 'repos/tidewater/valuation.md — revenue multiple against three comparables' },
    useOfFunds: 'Twelve months of serving, two harbour pilots, and counsel.', route: { kind: '506c', jurisdiction: 'US' }, limits: { perDay: 10, followUps: 2 }, minCheck: 5000,
  };
  const FACTS = [
    { claim: 'Three harbours pay for the weekly sheet', figure: { value: 3, unit: 'harbours' }, source: 'books: Tidewater 2026 to date' },
    { claim: 'Monthly revenue from the sheet', figure: { value: 360, unit: 'USD' }, source: 'ledger: money-in, November 2026' },
    { claim: 'We expect thirty harbours within a year', figure: { value: 30, unit: 'harbours' }, source: 'repos/tidewater/plan.md', forwardLooking: true },
  ];

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'raise-room-test-key';
    useTempRealm();
    const wsRoot = path.join(await createTempDir('raise-room'), 'workspaces');
    setWorkspacesRoot(wsRoot);
    me = await fullAuth();
    other = await fullAuth();
    for (const [i, [id]] of SEATS.entries()) {
      await workspace.create(id);
      await fs.writeFile(path.join(wsRoot, id, 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
      await fs.mkdir(path.join(wsRoot, id, 'identity'), { recursive: true });
      await fs.writeFile(path.join(wsRoot, id, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: soulOf(i) }));
    }
    await fs.writeFile(path.join(wsRoot, 'house-founding.base.json'), JSON.stringify({
      schema: 'kenorie-house-founding/1', houseName: 'tidewater', network: 'base', blockNumber: 1,
      members: [{ address: me.address, kind: 0, title: 'Rector' }, ...SEATS.map(([, title], i) => ({ address: soulOf(i), kind: 1, title }))],
    }));
    standing = makeCompany({ name: 'Tidewater', mode: 'field', openedBy: 'operator', now: new Date().toISOString() });
    founding = makeCompany({ name: 'Brine', mode: 'house', openedBy: 'operator', now: new Date().toISOString() });
    await openCompany(me.address, standing);
    await openCompany(me.address, founding);
    await standCompany(appendLineEvent, me.address, standing.id, { spec: 'spec', numer: 'numer', arch: 'arch', merc: 'merc', prae: 'prae' });
    app = express();
    app.use(express.json());
    app.use('/api/v1/raise', raiseRouter);
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => { wss.on('connection', (ws) => { serverWs = ws; resolve(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    await linked;
  }, 60000);

  afterAll(() => {
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('only the Quaestor drafts, and only for a company that stands; the draft waits for the operator', async () => {
    expect(await act('quae', { ...MANDATE, company: founding.id })).toMatchObject({ status: 'denied', error: expect.stringMatching(/still on its founding line/) });
    expect(await act('numer', { ...MANDATE, company: standing.id })).toMatchObject({ status: 'denied', error: expect.stringMatching(/the Quaestor's act/) });
    expect((await act('quae', { ...MANDATE, company: standing.id })).status).toBe('ok');
    const raise = await raiseOf(standing.id);
    expect(raise).toMatchObject({ status: 'none', draft: { amount: 250000, route: { kind: '506c' } } });
    expect((await readWaiting(me.address)).items.find((i) => i.kind === 'raise')).toMatchObject({ title: 'Tidewater: sign the raise mandate (250000 USD)', where: { raise: 'sign', companyId: standing.id } });
    expect((await readNotifications(me.address)).records.some((n) => n.title === 'Tidewater: the raise mandate waits for your signature')).toBe(true);
  });

  test('the operator signs the draft on screen, counsel\'s route confirmed; the account never reaches a being', async () => {
    const { draft } = await raiseOf(standing.id);
    const sign = (body) => request(app).post(`/api/v1/raise/${standing.id}/sign`).use(as(me)).send(body);
    expect((await sign({ mandateId: draft.id, counselChoseRoute: false, account: { kind: 'wallet', address: WALLET_IN } })).body.error).toMatch(/counsel chooses the legal route/);
    expect((await sign({ mandateId: 'm-00000000', counselChoseRoute: true, account: { kind: 'wallet', address: WALLET_IN } })).status).toBe(400);
    expect((await request(app).post(`/api/v1/raise/${standing.id}/sign`).use(as(other)).send({ mandateId: draft.id, counselChoseRoute: true, account: { kind: 'wallet', address: WALLET_IN } })).status).toBe(404);
    expect((await sign({ mandateId: draft.id, counselChoseRoute: true, account: { kind: 'wallet', address: WALLET_IN } })).body.raise).toMatchObject({ status: 'active', account: { kind: 'wallet', address: WALLET_IN } });
    expect((await readWaiting(me.address)).items.some((i) => i.kind === 'raise' && i.where.raise === 'sign')).toBe(false);
    const briefing = await companyLineBriefing(conn('numer'));
    expect(briefing).toContain(`- Tidewater [${standing.id}] RAISE: mandate active; no facts sheet yet (raise/facts, the Numerarius).`);
    expect(briefing.toLowerCase()).not.toContain(WALLET_IN.toLowerCase());
  });

  test('the Numerarius files the facts, every one sourced; counsel\'s review is the operator\'s to carry', async () => {
    expect(await act('numer', { type: 'raise/facts', company: standing.id, facts: [...FACTS.slice(0, 2), { claim: 'The best tide product anywhere', source: 'trust us' }] })).toMatchObject({ status: 'error', error: expect.stringMatching(/facts\[2\]\.source/) });
    expect((await act('numer', { type: 'raise/facts', company: standing.id, facts: FACTS, dataRoom: ['repos/tidewater/data-room/'] })).status).toBe('ok');
    const { sheet } = await raiseOf(standing.id);
    expect((await readWaiting(me.address)).items.find((i) => i.kind === 'raise')).toMatchObject({ where: { raise: 'review' } });
    const review = (body) => request(app).post(`/api/v1/raise/${standing.id}/review`).use(as(me)).send(body);
    expect((await review({ sheetId: sheet.id, verdict: 'returned' })).body.error).toBe('say what counsel wants changed');
    expect((await review({ sheetId: sheet.id, verdict: 'approved', note: 'Approved for a 506(c) offering.' })).body.raise).toMatchObject({ approved: { id: sheet.id }, review: { verdict: 'approved' } });
    expect(await companyLineBriefing(conn('quae'))).toContain('facts sheet approved by counsel');
  });

  test('the operator\'s switch: pause, resume, close — and nothing after close', async () => {
    const move = (type) => request(app).post(`/api/v1/raise/${standing.id}/status`).use(as(me)).send({ type, note: 'operator' });
    expect((await move('resumed')).body.error).toBe('the mandate is active — it cannot be resumed from there');
    expect((await move('paused')).body.raise.status).toBe('paused');
    expect((await move('resumed')).body.raise.status).toBe('active');
    expect((await move('closed')).body.raise.status).toBe('closed');
    expect((await move('paused')).status).toBe(400);
    expect((await request(app).get('/api/v1/raise').use(as(other))).body.raises).toEqual([]);
  });
});
