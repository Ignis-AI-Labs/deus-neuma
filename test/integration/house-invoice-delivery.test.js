/**
 * A WON DEAL, BILLED, DELIVERED, PAID AND BOOKED — the house economy's
 * Stages 3–4 end to end through the real stack (RULE 0, nothing faked): real
 * lanes seated as Mercator, Quaestor and Logista on a temp realm; every act
 * filed as the beings file them and settled by the real intent sweep over a
 * real WebSocket pair (the operator's card answered on that socket); the real
 * treasury and revenue routes behind real session tokens; a real money-in
 * receipt in the real ledger; the real delivery folder on disk.
 *
 * Under proof: no invoice before the operator says where it is paid, and none
 * past what the deal was won at; the invoice the buyer reads is rendered from
 * the record with the operator's address; nothing is published before the
 * operator chooses where, nor without the operator's yes; a file leaves only
 * from inside the house ground and never carrying a recovery phrase; the
 * invoice is paid only by the receipt that pays it; the Logista books it;
 * another house can touch none of it, nor claim this house's wallets as its own.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import process from 'node:process';
import { setImmediate } from 'node:timers';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { walletDir } from '../../backend/services/user-realm.js';
import { makeCompany, openCompany } from '../../backend/services/company-line/company-store.js';
import { croDesignation } from '../../backend/services/revenue/cro-designation.js';
import { cfoDesignation } from '../../backend/services/treasury/cfo-designation.js';
import { caoDesignation } from '../../backend/services/accounts/cao-designation.js';
import { makeReceipt } from '../../backend/services/money-in/receipt-rows.js';
import { withHouseLock, appendReceipts, readExtras } from '../../backend/services/money-in/money-in-store.js';
import { readInvoices } from '../../backend/services/invoices/invoice-store.js';
import { readBooks } from '../../backend/services/accounts/books-store.js';
import { cfoBriefingSection } from '../../backend/services/treasury/treasury-briefing.js';
import { mercatorBriefingSection } from '../../backend/services/revenue/revenue-briefing.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import treasuryRouter from '../../backend/routes/treasury-routes.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import moneyInRouter from '../../backend/routes/money-in-routes.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { processToolCalls } = __test;
const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const PAY_TO = `0x${'7e'.repeat(20)}`;
const USDC = { symbol: 'USDC', kind: 'erc20', decimals: 6, priceId: 'usd-coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' };

describe('a won deal, billed, delivered, paid and booked — through the real stack', () => {
  let me, other, ground, folder, app, httpServer, wss, serverWs, client, company, dealId, invoice;
  let decision = 'allow';
  let asking = null;
  const asked = [];

  const as = (who) => (req) => req.set('Authorization', `Bearer ${who.token}`);
  // A being's act as it files one: JSON into its own lane, settled by the real sweep; a card is answered on the socket.
  let filed = 0;
  const act = async (laneId, payload) => {
    const dir = path.join(workspace.pathFor(laneId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    filed += 1;
    await fs.writeFile(path.join(dir, `act-${filed}.json`), JSON.stringify(payload));
    asking = { ws: serverWs, companion: { name: laneId, neumaId: laneId }, walletAddress: me.address, sessionId: `sess-${laneId}` };
    const [result] = await processToolCalls(serverWs, '', asking);
    return result;
  };
  const land = async (amount, n) => {
    const receipt = makeReceipt({
      network: 'ethereum', asset: USDC, amountRaw: String(amount * 1_000_000), from: ethers.Wallet.createRandom().address,
      to: { address: PAY_TO, member: null, label: 'invoices' }, block: 300 + n, timestamp: Math.floor(Date.now() / 1000),
      txHash: `0x${String(n).padStart(64, '0')}`, logIndex: 0, internal: false, detectedAt: new Date().toISOString(),
    });
    await withHouseLock(me.address, () => appendReceipts(me.address, [receipt]));
    return receipt.key;
  };

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'invoice-delivery-test-key';
    useTempRealm();
    const tmp = await createTempDir('invoice-delivery');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    ground = path.join(tmp, 'ground');
    folder = path.join(tmp, 'served');
    me = await fullAuth();
    other = await fullAuth();
    for (const [laneId, who] of [['merc', me], ['quae', me], ['logi', me], ['brook', other]]) {
      await workspace.create(laneId);
      await fs.writeFile(path.join(workspace.pathFor(laneId), 'owner.json'), JSON.stringify({ wallet: who.address, claimedAt: 1 }));
    }
    await croDesignation.designate(me.address, 'merc');
    await cfoDesignation.designate(me.address, 'quae');
    await caoDesignation.designate(me.address, 'logi');
    await fs.mkdir(path.join(ground, 'repos', 'tidewater', 'delivery'), { recursive: true });
    await fs.mkdir(folder, { recursive: true });
    await fs.mkdir(walletDir(me.address), { recursive: true });
    await fs.writeFile(path.join(walletDir(me.address), 'house-workspace.json'), JSON.stringify({ root: ground }));
    company = makeCompany({ name: 'Tidewater', mode: 'field', openedBy: 'operator', now: new Date().toISOString() });
    await openCompany(me.address, company);

    app = express();
    app.use(express.json());
    app.use('/api/v1/treasury', treasuryRouter);
    app.use('/api/v1/revenue', revenueRouter);
    app.use('/api/v1/money-in', moneyInRouter);
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => { wss.on('connection', (ws) => { serverWs = ws; resolve(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    // the operator's screen: every card it is shown, answered with this test's decision
    client.on('message', (raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type !== 'tool:approval_request') return;
      asked.push(frame);
      setImmediate(() => resolveToolApproval(asking, frame.id, decision));
    });
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

  test('the Mercator wins a deal', async () => {
    const opened = await act('merc', {
      type: 'revenue/deal', company: company.id, buyer: 'Port of Brine', value: { amount: 1200, currency: 'USD' },
      spin: { problem: 'tide tables arrive late every week', needPayoff: 'two fewer missed berths a month, they said' }, nextStep: 'send the proposal',
    });
    expect(opened.status, opened.error).toBe('ok');
    dealId = (await request(app).get('/api/v1/revenue/board').use(as(me))).body.deals[0].id;
    expect((await act('merc', { type: 'revenue/move', id: dealId, stage: 'won', note: 'They signed the one-page sheet for a year.' })).status).toBe('ok');
  });

  test('no invoice before the operator says where it is paid; then none past the deal, and none by another seat', async () => {
    const lines = [{ what: 'Harbour sheet, one year', amount: 1000 }, { what: 'Setup', amount: 200 }];
    const early = await act('quae', { type: 'treasury/invoice', deal: dealId, lines, due: '2099-01-31' });
    expect(early.status, JSON.stringify(early)).toBe('error'); // an invalid filing comes back as an error, with its reason
    expect(early.error).toMatch(/no being writes payment details/);

    expect((await request(app).put('/api/v1/treasury/invoice-wallet').use(as(me)).send({ address: 'my wallet' })).status).toBe(400);
    const set = await request(app).put('/api/v1/treasury/invoice-wallet').use(as(me)).send({ address: PAY_TO });
    expect(set.status).toBe(200);
    expect(set.body.payTo).toMatchObject({ address: ethers.getAddress(PAY_TO), network: 'ethereum', by: 'operator' });
    expect((await readExtras(me.address)).map((e) => e.address)).toContain(ethers.getAddress(PAY_TO)); // watched for money in

    const over = await act('quae', { type: 'treasury/invoice', deal: dealId, lines: [...lines, { what: 'Extra', amount: 1 }], due: '2099-01-31' });
    expect(over.error).toMatch(/would bill past it/);
    expect((await act('merc', { type: 'treasury/invoice', deal: dealId, lines, due: '2099-01-31' })).status).not.toBe('ok');

    const issued = await act('quae', { type: 'treasury/invoice', deal: dealId, lines, due: '2099-01-31', note: 'Net 30.' });
    expect(issued.status, issued.error).toBe('ok');
    [invoice] = (await readInvoices(me.address)).invoices;
    expect(invoice).toMatchObject({ number: 'INV-0001', buyer: 'Port of Brine', total: 1200, currency: 'USD', status: 'open', payTo: { address: ethers.getAddress(PAY_TO) } });
    expect(await cfoBriefingSection({ walletAddress: me.address, companion: { neumaId: 'quae' } })).toContain(`- open: INV-0001 [${invoice.id}] Port of Brine 1200 USD, due 2099-01-31`);
  });

  test('nothing is published before the operator chooses where, nor without their yes', async () => {
    const before = await act('merc', { type: 'delivery/publish', deal: dealId, invoice: invoice.id });
    expect(before.status).toBe('denied');
    expect(before.error).toMatch(/has not chosen where deliveries go/);
    expect((await request(app).put('/api/v1/revenue/delivery-destination').use(as(me)).send({ folder: 'relative/path', linkBase: 'https://files.example.test/out' })).status).toBe(400);
    expect((await request(app).put('/api/v1/revenue/delivery-destination').use(as(me)).send({ folder, linkBase: 'http://files.example.test/out' })).status).toBe(400);
    const set = await request(app).put('/api/v1/revenue/delivery-destination').use(as(me)).send({ folder, linkBase: 'https://files.example.test/out/' });
    expect(set.status).toBe(200);

    decision = 'deny';
    const denied = await act('merc', { type: 'delivery/publish', deal: dealId, invoice: invoice.id });
    expect(denied.status).toBe('denied');
    expect(asked.at(-1)).toMatchObject({ type: 'tool:approval_request' });
    expect(await fs.readdir(folder)).toEqual([]);
  });

  test('with the operator\'s yes the invoice is published, rendered from the record, under a link no one can guess', async () => {
    decision = 'allow';
    const published = await act('merc', { type: 'delivery/publish', deal: dealId, invoice: 'INV-0001' });
    expect(published.status, published.error).toBe('ok');
    const { deliveries, destination } = (await request(app).get('/api/v1/revenue/board').use(as(me))).body;
    expect(destination).toMatchObject({ folder, linkBase: 'https://files.example.test/out' });
    expect(deliveries).toHaveLength(1);
    const [d] = deliveries;
    expect(d).toMatchObject({ dealId, kind: 'invoice', invoiceId: invoice.id, name: 'INV-0001.html', by: 'merc' });
    expect(d.link).toMatch(new RegExp(`^https://files\\.example\\.test/out/${company.id}/[a-f0-9]{24}/INV-0001\\.html$`));
    const page = await fs.readFile(path.join(folder, ...d.link.replace('https://files.example.test/out/', '').split('/')), 'utf8');
    expect(page).toContain(`<code>${ethers.getAddress(PAY_TO)}</code>`);
    expect(page).toContain('Pay 1,200.00 USD in USDC, USDT or DAI on Ethereum mainnet to');
    expect(page).toContain('prepared by an AI agent team working for Tidewater');
    expect(await mercatorBriefingSection({ walletAddress: me.address, companion: { neumaId: 'merc' } })).toContain(`  - invoice INV-0001 [${invoice.id}] 1200 USD, open, published`);
  });

  test('a file leaves only from inside the house ground, and never carrying a recovery phrase', async () => {
    await fs.writeFile(path.join(ground, 'repos', 'tidewater', 'delivery', 'sheet.md'), '# Brine tides, November\n\nHigh 06:12, low 12:30.\n');
    await fs.writeFile(path.join(ground, 'repos', 'tidewater', 'delivery', 'keys.md'), `backup: ${ethers.Wallet.createRandom().mnemonic.phrase}\n`);
    await fs.writeFile(path.join(path.dirname(ground), 'outside.md'), 'not the house\'s');
    await fs.symlink(path.join(path.dirname(ground), 'outside.md'), path.join(ground, 'repos', 'tidewater', 'delivery', 'escape.md'));

    expect((await act('merc', { type: 'delivery/publish', deal: dealId, path: '../outside.md' })).error).toMatch(/outside the house ground/);
    expect((await act('merc', { type: 'delivery/publish', deal: dealId, path: 'repos/tidewater/delivery/escape.md' })).error).toMatch(/outside the house ground/);
    const secret = await act('merc', { type: 'delivery/publish', deal: dealId, path: 'repos/tidewater/delivery/keys.md' });
    expect(secret.status).toBe('denied');
    expect(secret.error).toMatch(/^the file carries what looks like a se/); // the outbound screen's own words
    const ok = await act('merc', { type: 'delivery/publish', deal: dealId, path: 'repos/tidewater/delivery/sheet.md' });
    expect(ok.status, ok.error).toBe('ok');
    const { deliveries } = (await request(app).get('/api/v1/revenue/board').use(as(me))).body;
    expect(deliveries.map((d) => d.name)).toEqual(['INV-0001.html', 'sheet.md']);
  });

  test('the money lands; the invoice is paid only by the receipt that pays it; the Logista books it', async () => {
    const short = await land(1000, 1);
    const full = await land(1200, 2);
    const wrong = await act('quae', { type: 'treasury/invoice-paid', invoice: 'INV-0001', receipt: short });
    expect(wrong.error).toMatch(/the receipt holds 1000.0 USDC; INV-0001 is 1200 USD/);
    expect(await cfoBriefingSection({ walletAddress: me.address, companion: { neumaId: 'quae' } })).toContain(`key ${full}`);
    const paid = await act('quae', { type: 'treasury/invoice-paid', invoice: 'INV-0001', receipt: full });
    expect(paid.status, paid.error).toBe('ok');
    expect((await readInvoices(me.address)).invoices[0]).toMatchObject({ status: 'paid', paid: { receipt: full, by: 'quae' } });

    const booked = await act('logi', { type: 'accounts/book', company: company.id, receipt: { kind: 'money-in', ref: full }, category: 'revenue', memo: 'INV-0001, Port of Brine — the harbour sheet, one year' });
    expect(booked.status, booked.error).toBe('ok');
    const { entries } = await readBooks(me.address, company.id);
    expect(entries).toEqual([expect.objectContaining({ direction: 'in', amount: 1200, currency: 'USDC', category: 'revenue', receipt: { kind: 'money-in', ref: full } })]);
  });

  test('another house touches none of it; a settled invoice is not voided', async () => {
    // another house is never paid at, nor watches, this house's wallets — the operator's own, or one it watches
    for (const address of [me.address, PAY_TO]) {
      const claimed = await request(app).put('/api/v1/treasury/invoice-wallet').use(as(other)).send({ address });
      expect(claimed.status).toBe(400);
      expect(claimed.body.error).toMatch(/belongs to another house on this machine/);
      expect((await request(app).put(`/api/v1/money-in/addresses/${address}`).use(as(other)).send({ label: 'mine now' })).status).toBe(409);
    }
    expect(await readExtras(other.address)).toEqual([]);
    expect((await request(app).post(`/api/v1/treasury/invoices/${invoice.id}/void`).use(as(other)).send({ reason: 'not mine at all' })).status).toBe(404);
    expect((await request(app).post(`/api/v1/treasury/invoices/${invoice.id}/paid`).use(as(other)).send({ receipt: 'x' })).status).toBe(404);
    const theirs = (await request(app).get('/api/v1/revenue/board').use(as(other))).body;
    expect(theirs).toMatchObject({ deals: [], deliveries: [], destination: null });
    const settled = await request(app).post(`/api/v1/treasury/invoices/${invoice.id}/void`).use(as(me)).send({ reason: 'changed our mind' });
    expect(settled.status).toBe(400);
    expect(settled.body.error).toMatch(/only an open invoice is voided/);
  });
});
