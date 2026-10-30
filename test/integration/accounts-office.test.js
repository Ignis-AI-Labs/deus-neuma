/**
 * THE LOGISTA OFFICE through the real stack (RULE 0, nothing mocked): a real
 * house on tmp disk with REAL money-in receipts (the money-in store) and a
 * REAL executed spend (the being's spend ledger), the operator seating
 * through the real routers behind REAL auth, the Logista's acts filed as
 * intents and settled by the REAL portal sweep. TREASURY is not ACCOUNTS from
 * both sides; an entry from a receipt takes the receipt's figures; a receipt
 * books once; the briefing owes every unbooked receipt and marks a CPA's
 * deadline.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { makeReceipt } from '../../backend/services/money-in/receipt-rows.js';
import { appendReceipts, withHouseLock } from '../../backend/services/money-in/money-in-store.js';
import { makeCompany, openCompany } from '../../backend/services/company-line/company-store.js';
import { seatHolders } from '../../backend/services/company-line/stage-holders.js';
import { logistaBriefingSection } from '../../backend/services/accounts/accounts-briefing.js';
import { cfoDesignation } from '../../backend/services/treasury/cfo-designation.js';
import accountsRouter from '../../backend/routes/accounts-routes.js';
import treasuryRouter from '../../backend/routes/treasury-routes.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { processToolCalls } = __test;
const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const USDC = { symbol: 'USDC', kind: 'erc20', decimals: 6, priceId: 'usd-coin', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' };
const hash = (n) => `0x${n.toString(16).padStart(64, '0')}`;

describe('THE LOGISTA OFFICE through the real stack (gnosis)', () => {
  let me, app, httpServer, wss, serverWs, client, company, inKey;
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
  const board = async () => (await request(app).get('/api/v1/accounts/board').use(as)).body;

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'accounts-office-test-key';
    useTempRealm();
    const wsRoot = path.join(await createTempDir('accounts-office'), 'workspaces');
    setWorkspacesRoot(wsRoot);
    me = await fullAuth();
    for (const id of ['logi', 'quae']) {
      await workspace.create(id);
      await fs.writeFile(path.join(wsRoot, id, 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
    }
    company = makeCompany({ name: 'Tidewater', mode: 'field', openedBy: 'operator', now: new Date().toISOString() });
    await openCompany(me.address, company);
    // A real receipt in the money-in ledger, and a real executed spend in a being's ledger.
    const row = makeReceipt({
      network: 'ethereum', asset: USDC, amountRaw: '120000000', from: ethers.Wallet.createRandom().address,
      to: { address: ethers.Wallet.createRandom().address, member: 'quae', label: 'quae' }, block: 101, timestamp: Date.parse('2026-11-01T10:00:00Z') / 1000,
      txHash: hash(7), logIndex: 0, internal: false, detectedAt: '2026-11-01T10:00:05Z',
    });
    inKey = row.key;
    await withHouseLock(me.address, () => appendReceipts(me.address, [row]));
    await workspace.updatePendingSpends('quae', (r) => [...r, {
      id: 'aa11bb22cc33dd44', to: ethers.Wallet.createRandom().address, value: '0.01', memo: 'GPU hours', requestedAt: '2026-11-02T10:00:00.000Z',
      resolvedAt: '2026-11-02T10:01:00.000Z', status: 'executed', txHash: hash(8),
    }]);
    app = express();
    app.use(express.json());
    app.use('/api/v1/accounts', accountsRouter);
    app.use('/api/v1/treasury', treasuryRouter);
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

  test('TREASURY is not ACCOUNTS: the Quaestor\'s being cannot keep the books, nor the Logista approve the money', async () => {
    expect((await request(app).put('/api/v1/treasury/seat').use(as).send({ laneId: 'quae' })).status).toBe(200);
    expect((await request(app).put('/api/v1/accounts/seat').use(as).send({ laneId: 'quae' })).status).toBe(409);
    expect((await request(app).put('/api/v1/accounts/seat').use(as).send({ laneId: 'logi' })).body.logista).toMatchObject({ laneId: 'logi' });
    expect((await request(app).put('/api/v1/treasury/seat').use(as).send({ laneId: 'logi' })).status).toBe(409);
    expect((await seatHolders(me.address)).Logista).toBe('logi');
  });

  test('every receipt the house holds is owed to the books until booked', async () => {
    const b = await board();
    expect(b.unbooked.map((r) => `${r.kind}:${r.ref}`)).toEqual([`money-in:${inKey}`, 'spend:quae:aa11bb22cc33dd44']);
    const text = await logistaBriefingSection(conn('logi'));
    expect(text).toContain('Receipts no company has booked (2) — book each with accounts/book:');
    expect(await logistaBriefingSection(conn('quae'))).toBe('');
  });

  test('an entry from a receipt takes the receipt\'s figures, and a receipt books once', async () => {
    const book = { type: 'accounts/book', company: company.id, receipt: { kind: 'money-in', ref: inKey, amount: 999999 }, category: 'revenue', memo: 'Padstow, November' };
    expect(await act('quae', book)).toMatchObject({ status: 'denied', error: expect.stringMatching(/only the seated Logista/) });
    expect((await act('logi', book)).status).toBe('ok');
    expect(await act('logi', book)).toMatchObject({ error: expect.stringMatching(/already booked — one receipt, one entry/) });
    expect((await act('logi', { type: 'accounts/book', company: company.id, receipt: { kind: 'spend', ref: 'quae:aa11bb22cc33dd44' }, category: 'compute', memo: 'GPU hours' })).status).toBe('ok');
    const [books] = (await board()).books;
    expect(books.yearToDate.currencies).toEqual({ USDC: { in: 120, out: 0, net: 120 }, ETH: { in: 0, out: 0.01, net: -0.01 } });
    expect((await board()).unbooked).toEqual([]);
  });

  test('money with no receipt is booked by hand, with its source, and stands unmatched; a wrong entry is voided', async () => {
    const manual = (source) => ({ type: 'accounts/book', company: company.id, receipt: { kind: 'manual', direction: 'out', amount: 100, currency: 'USD', date: '2026-11-02', source }, category: 'fees', memo: 'Wyoming filing fee' });
    expect(await act('logi', manual('paid it'))).toMatchObject({ status: 'error', error: expect.stringMatching(/receipt\.source/) });
    expect((await act('logi', manual('invoice: Wyoming SOS #2026-1234'))).status).toBe('ok');
    const [b1] = (await board()).books;
    expect(b1.yearToDate.unmatched).toBe(1);
    const fee = b1.entries.find((e) => e.receipt.kind === 'manual');
    expect((await act('logi', { type: 'accounts/void', company: company.id, id: fee.id, reason: 'booked to the wrong company' })).status).toBe('ok');
    const [b2] = (await board()).books;
    expect([b2.yearToDate.unmatched, b2.voided]).toEqual([0, 1]);
  });

  test('a deadline cites its source; one a CPA must sign is marked; met, it closes', async () => {
    const due = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    expect(await act('logi', { type: 'accounts/deadline', company: company.id, what: 'Federal return', due, authority: 'the IRS', source: 'my memory' })).toMatchObject({ status: 'error' });
    expect((await act('logi', { type: 'accounts/deadline', company: company.id, what: 'Federal return (Form 1065)', due, authority: 'the IRS', source: 'https://www.irs.gov/forms-pubs/about-form-1065', needsCpa: true })).status).toBe('ok');
    expect(await logistaBriefingSection(conn('logi'))).toContain('Federal return (Form 1065) — ' + due + ', to the IRS — NEEDS A LICENSED CPA');
    const [d] = (await board()).books[0].deadlines;
    expect((await act('logi', { type: 'accounts/deadline-met', company: company.id, id: d.id, note: 'filed by the CPA, confirmation 4412' })).status).toBe('ok');
    expect(await logistaBriefingSection(conn('logi'))).not.toContain('NEEDS A LICENSED CPA');
  });

  test('a being seated in both offices by hand still cannot keep the books it approves', async () => {
    await cfoDesignation.designate(me.address, 'logi');
    expect(await act('logi', { type: 'accounts/void', company: company.id, id: 'b-00000000', reason: 'testing the split' })).toMatchObject({ status: 'denied', error: expect.stringMatching(/TREASURY is not ACCOUNTS/) });
  });
});
