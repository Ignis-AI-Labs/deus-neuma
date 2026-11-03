/**
 * THE RAISE ROOM's outreach through the real stack (RULE 0, nothing mocked):
 * a company walked to STANDING through the real line store; the mandate
 * drafted and the facts filed by the real sweep, signed and reviewed by the
 * operator through the real router behind REAL auth; investors listed and
 * cleared by their seats; and every investor message sent by the house's own
 * SMTP sender over real TLS to a real mail server (smtp-tls-kit.js). The
 * facts gate holds a false message; the payment line arrives filled from the
 * signed mandate, and the record keeps the message as written; a failed send
 * records nothing; pace, follow-ups and a declined investor hold.
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
import { startTlsSmtp } from '../helpers/smtp-tls-kit.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { makeCompany, openCompany, appendLineEvent } from '../../backend/services/company-line/company-store.js';
import { emailBinding } from '../../backend/services/email/email-binding.js';
import { setEmailCredential } from '../../backend/services/email/email-credentials.js';
import { disclosureLine, PAYMENT_PLACEHOLDER } from '../../backend/services/raise/facts-gate.js';
import raiseRouter from '../../backend/routes/raise-routes.js';
import { ethers } from 'ethers';
import { makeReceipt } from '../../backend/services/money-in/receipt-rows.js';
import { appendReceipts, withHouseLock, readExtras } from '../../backend/services/money-in/money-in-store.js';
import { readWaiting } from '../../backend/services/waiting/waiting-sources.js';
import { houseReceipts } from '../../backend/services/accounts/house-receipts.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { processToolCalls } = __test;
const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const SEATS = Object.freeze([['spec', 'Speculator'], ['numer', 'Numerarius'], ['arch', 'Architectus'], ['merc', 'Mercator'], ['prae', 'Praetor'], ['quae', 'Quaestor']]);
const soulOf = (i) => `0x${String(i + 1).padStart(40, 'd')}`;
const WALLET_IN = `0x${'7e'.repeat(20)}`;
const DISCLOSE = disclosureLine('Tidewater');
const decoded = (data) => Buffer.from(data.split('\r\n\r\n').slice(1).join('').replace(/\r\n/g, ''), 'base64').toString('utf8');

describe('THE RAISE ROOM — outreach, sent for real (gnosis)', () => {
  let me, app, httpServer, wss, serverWs, client, company, smtp, tmp;
  const ids = {};
  const conn = (neumaId) => ({ ws: serverWs, companion: { name: neumaId, neumaId }, walletAddress: me.address, sessionId: `sess-${neumaId}` });
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  let filed = 0;
  const act = async (neumaId, payload) => {
    const dir = path.join(workspace.pathFor(neumaId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    filed += 1;
    await fs.writeFile(path.join(dir, `act-${filed}.json`), JSON.stringify({ company: company.id, ...payload }));
    const [result] = await processToolCalls(serverWs, '', conn(neumaId));
    return result;
  };
  const raise = async () => (await request(app).get('/api/v1/raise').use(as)).body.raises.find((r) => r.id === company.id).raise;
  const investor = (name) => raise().then((r) => r.investors.find((i) => i.name === name));
  const reach = (who, body, subject = 'Tidewater — tide sheets for small harbours') => act('merc', { type: 'raise/reach', investor: ids[who], subject, body });
  const TRUE_BODY = `Three harbours already pay for our weekly sheet, 360 USD a month. We expect thirty harbours within a year (forward-looking). We are raising 250,000 USD on a SAFE, with a 5,000 USD smallest check. ${DISCLOSE} ${PAYMENT_PLACEHOLDER}`;

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'raise-outreach-test-key';
    useTempRealm();
    tmp = await createTempDir('raise-outreach');
    const wsRoot = path.join(tmp, 'workspaces');
    setWorkspacesRoot(wsRoot);
    me = await fullAuth();
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
    company = makeCompany({ name: 'Tidewater', mode: 'field', openedBy: 'operator', now: new Date().toISOString() });
    await openCompany(me.address, company);
    await standCompany(appendLineEvent, me.address, company.id, { spec: 'spec', numer: 'numer', arch: 'arch', merc: 'merc', prae: 'prae' });
    smtp = await startTlsSmtp(tmp);
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

  afterAll(async () => {
    client?.close();
    wss?.close();
    httpServer?.close();
    await smtp?.close();
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('the room readies: a mandate signed, the facts approved, three investors listed and judged under the route', async () => {
    expect((await act('quae', { type: 'raise/mandate', amount: 250000, currency: 'USD', instrument: 'safe', valuation: { low: 2000000, high: 3000000, basis: 'repos/tidewater/valuation.md — three comparables' }, useOfFunds: 'Twelve months of serving and two harbour pilots.', route: { kind: '506c', jurisdiction: 'US' }, limits: { perDay: 3, followUps: 1 }, minCheck: 5000 })).status).toBe('ok');
    const { draft } = await raise();
    expect((await request(app).post(`/api/v1/raise/${company.id}/sign`).use(as).send({ mandateId: draft.id, counselChoseRoute: true, account: { kind: 'wallet', address: WALLET_IN } })).status).toBe(200);
    expect((await act('numer', { type: 'raise/facts', facts: [
      { claim: 'Three harbours pay for the weekly sheet', figure: { value: 3, unit: 'harbours' }, source: 'books: Tidewater 2026' },
      { claim: 'Monthly revenue from the sheet', figure: { value: 360, unit: 'USD' }, source: 'ledger: money-in, November' },
      { claim: 'Thirty harbours within a year', figure: { value: 30, unit: 'harbours' }, source: 'repos/tidewater/plan.md', forwardLooking: true },
    ] })).status).toBe('ok');
    const { sheet } = await raise();
    expect((await request(app).post(`/api/v1/raise/${company.id}/review`).use(as).send({ sheetId: sheet.id, verdict: 'approved' })).status).toBe(200);
    for (const [name, email] of [['Ann Fund', 'ann@fund.example'], ['Bo Angel', 'bo@angel.example'], ['Cy Ventures', 'cy@ventures.example']]) {
      expect((await act('spec', { type: 'raise/investor', name, email, thesis: 'Maritime software at seed', why: 'Backed port-tech before' })).status).toBe('ok');
      ids[name.split(' ')[0]] = (await investor(name)).id;
    }
    expect(await act('merc', { type: 'raise/clear', investor: ids.Ann, verdict: 'cleared' })).toMatchObject({ status: 'denied', error: expect.stringMatching(/the Praetor's act/) });
    expect((await act('prae', { type: 'raise/clear', investor: ids.Ann, verdict: 'cleared' })).status).toBe('ok');
    expect((await act('prae', { type: 'raise/clear', investor: ids.Cy, verdict: 'cleared' })).status).toBe('ok');
    expect((await act('prae', { type: 'raise/clear', investor: ids.Bo, verdict: 'refused', note: 'Not an accredited investor by their own public filing' })).status).toBe('ok');
  });

  test('no mailbox, no reach; a send that fails records nothing', async () => {
    expect(await reach('Ann', TRUE_BODY)).toMatchObject({ status: 'denied', error: expect.stringMatching(/mailbox is not yours to hold/) });
    await emailBinding.bind(me.address, 'email', { neumaId: 'merc' });
    await setEmailCredential(me.address, { address: 'raise@tidewater.example', username: 'raise@tidewater.example', password: 'test-app-password', smtpHost: 'localhost', smtpPort: '1', imapHost: 'localhost', imapPort: '1' });
    expect(await reach('Ann', TRUE_BODY)).toMatchObject({ error: expect.stringMatching(/the message was not sent/) });
    expect((await investor('Ann Fund')).thread).toEqual([]);
    await setEmailCredential(me.address, { smtpPort: String(smtp.port) });
  });

  test('the facts gate holds a message the record cannot back — nothing leaves', async () => {
    const result = await reach('Ann', `We have 12 harbours. We will triple revenue. Act now and wire to ${WALLET_IN}. ${DISCLOSE}`);
    expect(result.error).toMatch(/the facts gate holds this message — 12 is not on the facts sheet/);
    expect(result.error).toMatch(/mark this forward-looking sentence/);
    expect(result.error).toMatch(/a wallet address — no payment detail is ever written by a being/);
    expect(result.error).toMatch(/no false urgency \(MAKOTO\)/);
    expect(smtp.received).toEqual([]);
  });

  test('a true message goes out over real TLS, the payment line filled from the mandate; the record keeps it as written', async () => {
    expect((await reach('Ann', TRUE_BODY)).status).toBe('ok');
    expect(smtp.received).toHaveLength(1);
    const [mail] = smtp.received;
    expect(mail.to).toEqual(['ann@fund.example']);
    const text = decoded(mail.data);
    expect(text).toContain(DISCLOSE);
    expect(text).toContain(`Funds are received only at ${WALLET_IN} on ethereum, and only once the papers are signed.`);
    expect(text).not.toContain(PAYMENT_PLACEHOLDER);
    const [kept] = (await investor('Ann Fund')).thread;
    expect(kept.text).toContain(PAYMENT_PLACEHOLDER);
    expect(kept.text).not.toContain(WALLET_IN);
    expect(await reach('Bo', TRUE_BODY)).toMatchObject({ status: 'denied', error: expect.stringMatching(/only an investor the Praetor cleared/) });
  });

  test('follow-ups and the day\'s pace hold; a declined investor\'s thread ends', async () => {
    expect((await reach('Ann', TRUE_BODY, 'Following up — Tidewater')).status).toBe('ok');
    expect(await reach('Ann', TRUE_BODY, 'Once more')).toMatchObject({ status: 'denied', error: expect.stringMatching(/allows 1 follow-ups after the first message/) });
    expect((await reach('Cy', TRUE_BODY)).status).toBe('ok');
    expect(await reach('Cy', TRUE_BODY, 'Following up')).toMatchObject({ status: 'denied', error: expect.stringMatching(/pace is 3 messages a day/) });
    expect(smtp.received.map((m) => m.to[0])).toEqual(['ann@fund.example', 'ann@fund.example', 'cy@ventures.example']);
    expect((await act('merc', { type: 'raise/update', investor: ids.Ann, status: 'declined', note: 'Not investing in software this year' })).status).toBe('ok');
    expect(await reach('Ann', TRUE_BODY)).toMatchObject({ status: 'denied', error: 'Ann Fund declined — a clear no ends the thread (MAKOTO)' });
  });

  test('the close: terms inside the mandate, the Praetor\'s check, and the operator\'s signature on money that landed at the mandate\'s wallet', async () => {
    // Signing a wallet mandate put that wallet on the money-in watch, so an investor's transfer is seen.
    expect((await readExtras(me.address)).map((e) => e.address.toLowerCase())).toContain(WALLET_IN.toLowerCase());
    expect((await act('merc', { type: 'raise/update', investor: ids.Cy, status: 'interested', note: 'Asked for the terms' })).status).toBe('ok');
    expect(await act('quae', { type: 'raise/terms', investor: ids.Cy, amount: 1000, valuation: 2500000 })).toMatchObject({ error: expect.stringMatching(/smallest check, 5000 USD/) });
    expect((await act('quae', { type: 'raise/terms', investor: ids.Cy, amount: 50000, valuation: 2500000, notes: 'Post-money SAFE' })).status).toBe('ok');
    expect((await act('prae', { type: 'raise/terms-check', investor: ids.Cy, verdict: 'sound' })).status).toBe('ok');
    expect((await readWaiting(me.address)).items.find((i) => i.where?.raise === 'close')).toMatchObject({ title: 'Tidewater: sign Cy Ventures\'s close (50000 USD)' });
    const usdc = { symbol: 'USDC', kind: 'erc20', decimals: 6, priceId: 'usd-coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' };
    const landed = (to, n) => makeReceipt({ network: 'ethereum', asset: usdc, amountRaw: String(50000 * 1_000_000), from: ethers.Wallet.createRandom().address,
      to: { address: to, member: null, label: 'raise' }, block: 200 + n, timestamp: Math.floor(Date.now() / 1000), txHash: `0x${String(n).padStart(64, '0')}`, logIndex: 0, internal: false, detectedAt: new Date().toISOString() });
    const elsewhere = landed(ethers.Wallet.createRandom().address, 1);
    const right = landed(WALLET_IN, 2);
    await withHouseLock(me.address, () => appendReceipts(me.address, [elsewhere, right]));
    const close = (body) => request(app).post(`/api/v1/raise/${company.id}/close-investor`).use(as).send({ investorId: ids.Cy, signedPapers: true, accreditedVerified: true, ...body });
    expect((await close({ receipt: 'ethereum:0xnone:0' })).body.error).toMatch(/the money has not landed/);
    expect((await close({ receipt: elsewhere.key })).body.error).toMatch(/not the mandate's/);
    expect((await close({ receipt: right.key, accreditedVerified: false })).body.error).toBe('a 506(c) close needs the investor verified accredited');
    const done = (await close({ receipt: right.key })).body.raise;
    expect(done.investors.find((i) => i.id === ids.Cy)).toMatchObject({ status: 'closed', closed: { amount: 50000, received: { kind: 'money-in', ref: right.key } } });
    expect((await readWaiting(me.address)).items.some((i) => i.where?.raise === 'close')).toBe(false);
    // The money that closed stands among the receipts the books owe — the Logista books it as investment.
    expect((await houseReceipts(me.address)).some((r) => r.ref === right.key && r.direction === 'in')).toBe(true);
  });
});
