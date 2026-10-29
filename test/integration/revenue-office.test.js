/**
 * THE MERCATOR OFFICE through the real stack (RULE 0, nothing mocked): a real
 * house on tmp disk, the operator seating a Mercator through the real router
 * behind REAL auth, the being's deals filed as intents and settled by the REAL
 * portal sweep, the CMO's real lead ledger taking the handoff. The sales seat
 * is the line's Mercator; a deal opens only qualified; a clear no rests the
 * thread; MAKOTO rides the Mercator's and the CMO's playbooks.
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
import { makeCompany, openCompany } from '../../backend/services/company-line/company-store.js';
import { seatHolders } from '../../backend/services/company-line/stage-holders.js';
import { mercatorBriefingSection } from '../../backend/services/revenue/revenue-briefing.js';
import { scaffoldCmoWorkspace } from '../../backend/services/marketing/marketing-scaffold.js';
import { MAKOTO_LINE } from '../../backend/services/makoto.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { processToolCalls } = __test;
const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const soulOf = (i) => `0x${String(i + 1).padStart(40, 'b')}`;

describe('THE MERCATOR OFFICE through the real stack (gnosis)', () => {
  let me, app, httpServer, wss, serverWs, client, company, wsRoot;
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
  const spin = { problem: 'Tables arrive in a format nobody can pin up', needPayoff: '"It would save me an hour every Monday"' };

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'revenue-office-test-key';
    useTempRealm();
    wsRoot = path.join(await createTempDir('revenue-office'), 'workspaces');
    setWorkspacesRoot(wsRoot);
    me = await fullAuth();
    for (const [i, id] of ['merc', 'scout'].entries()) {
      await workspace.create(id);
      await fs.writeFile(path.join(wsRoot, id, 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
      await fs.mkdir(path.join(wsRoot, id, 'identity'), { recursive: true });
      await fs.writeFile(path.join(wsRoot, id, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: soulOf(i) }));
    }
    // The founding record gives the Mercator title to 'scout'; the office will outrank it.
    await fs.writeFile(path.join(wsRoot, 'house-founding.base.json'), JSON.stringify({
      schema: 'kenorie-house-founding/1', houseName: 'tidewater', network: 'base', blockNumber: 1,
      members: [{ address: me.address, kind: 0, title: 'Rector' }, { address: soulOf(1), kind: 1, title: 'Mercator' }],
    }));
    company = makeCompany({ name: 'Tidewater', mode: 'field', openedBy: 'operator', now: new Date().toISOString() });
    await openCompany(me.address, company);
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
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

  test('the operator seats the Mercator: the office outranks the founding title, and the playbook carries MAKOTO', async () => {
    expect((await seatHolders(me.address)).Mercator).toBe('scout');
    expect((await request(app).put('/api/v1/revenue/seat').send({ laneId: 'merc' })).status).toBe(401);
    expect((await request(app).put('/api/v1/revenue/seat').use(as).send({ laneId: 'merc' })).body.mercator).toMatchObject({ laneId: 'merc' });
    expect((await seatHolders(me.address)).Mercator).toBe('merc');
    const playbook = await fs.readFile(path.join(wsRoot, 'merc', 'revenue', 'playbook.md'), 'utf8');
    expect(playbook).toContain('# The Mercator Playbook');
    expect(playbook).toContain('MAKOTO 誠 (makoto, "sincerity")');
  });

  test('a qualified lead hands over: the Mercator opens the deal, and the lead moves to it on the CMO\'s ledger', async () => {
    const ledger = await leadLedgerFor(me.address);
    const lead = await ledger.add({ name: 'Padstow harbour office', channelId: 'email', status: 'qualified', addedBy: 'scout' });
    expect(await mercatorBriefingSection(conn('merc'))).toContain(`- [${lead.id}] Padstow harbour office (email)`);
    expect(await mercatorBriefingSection(conn('scout'))).toBe('');
    const filing = { type: 'revenue/deal', company: company.id, buyer: 'Padstow harbour office', leadId: lead.id, value: { amount: 120, currency: 'USD' }, spin, nextStep: 'Send the sample sheet Monday' };
    expect(await act('scout', filing)).toMatchObject({ status: 'denied', error: expect.stringMatching(/only the seated Mercator/) });
    expect(await act('merc', { ...filing, spin: { problem: spin.problem } })).toMatchObject({ status: 'error', error: expect.stringMatching(/qualify first/) });
    expect((await act('merc', filing)).status).toBe('ok');
    const [stored] = (await ledger.load()).filter((l) => l.id === lead.id);
    expect(stored).toMatchObject({ status: 'qualified', ownerNeumaId: 'merc' });
    expect(stored.touches.at(-1).note).toMatch(/^deal \[d-[a-f0-9]{8}\] opened by the Mercator$/);
    const board = (await request(app).get('/api/v1/revenue/board').use(as)).body;
    expect(board.pipeline.qualified).toEqual({ count: 1, value: { USD: 120 } });
    const briefing = await mercatorBriefingSection(conn('merc'));
    expect(briefing).toContain('Pipeline: QUALIFIED 1 (120 USD)');
    expect(briefing).not.toContain(`- [${lead.id}] Padstow`);
    expect(briefing).toContain(MAKOTO_LINE);
  });

  test('every move says why; a won deal moves its lead; a clear no rests the thread', async () => {
    const [deal] = (await request(app).get('/api/v1/revenue/board').use(as)).body.deals;
    expect(await act('merc', { type: 'revenue/move', id: deal.id, stage: 'won', note: 'yes' })).toMatchObject({ status: 'error', error: expect.stringMatching(/why we won/) });
    expect((await act('merc', { type: 'revenue/move', id: deal.id, stage: 'proposed', note: 'Ten dollars a month, billed monthly' })).status).toBe('ok');
    expect((await act('merc', { type: 'revenue/move', id: deal.id, stage: 'won', note: 'The sample sheet sold itself' })).status).toBe('ok');
    const lead = (await (await leadLedgerFor(me.address)).load()).find((l) => l.id === deal.leadId);
    expect(lead.status).toBe('won');
    const fowey = { type: 'revenue/deal', company: company.id, buyer: 'Fowey harbour', value: { amount: 90, currency: 'USD' }, spin, nextStep: 'Call the harbour master' };
    expect((await act('merc', fowey)).status).toBe('ok');
    const open = (await request(app).get('/api/v1/revenue/board').use(as)).body.deals.find((d) => d.buyer === 'Fowey harbour');
    expect((await act('merc', { type: 'revenue/move', id: open.id, stage: 'lost', note: 'Happy with the almanac, said no plainly' })).status).toBe('ok');
    expect(await act('merc', fowey)).toMatchObject({ status: 'error', error: expect.stringMatching(/a clear no ends the thread \(MAKOTO\)/) });
  });

  test('MAKOTO joins the CMO\'s playbook too', async () => {
    await scaffoldCmoWorkspace('scout');
    expect(await fs.readFile(path.join(wsRoot, 'scout', 'marketing', 'playbook.md'), 'utf8')).toContain('MAKOTO 誠 (makoto, "sincerity")');
  });
});
