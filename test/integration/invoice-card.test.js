/**
 * AN INVOICE PAID BY CARD, AND SENT (backend/services/invoices/stripe-pay.js, invoice-store.js, invoice-send.js,
 * routes/deal-invoice-routes.js) — Design note, 2026-11-21: […]
 *
 * The operator opens a deal, wins it, bills it from the desk; the invoice gets its own payment link on the operator's
 * Stripe account; the house asks Stripe whether it was paid and records it only once Stripe says PAID; a voided
 * invoice's link is closed; the invoice is emailed from the house mailbox with each way to pay printed on it.
 * Stripe is served from this machine in the shapes its API reference gives (docs.stripe.com/api/payment-link/create and
 * /api/checkout/sessions/list, read 2026-11-21); the mail server is a real one on localhost; a real house on tmp disk,
 * real routes behind real auth (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { startTlsSmtp } from '../helpers/smtp-tls-kit.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { setEmailCredential } from '../../backend/services/email/email-credentials.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { setPayTo, readInvoices } from '../../backend/services/invoices/invoice-store.js';
import { cardSettleTick } from '../../backend/services/invoices/card-settle-scheduler.js';
import { payLinkForm, paidOf, stripeRefusal, minor, STRIPE_VERSION } from '../../backend/services/invoices/stripe-pay.js';

const KEYS = ['DNA_ENCRYPTION_KEY', 'NEUMA_STRIPE_API', 'STRIPE_API_KEY', 'NEUMA_CONNECTIONS_PATH'];
const SAVED = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const PRIOR_ROOT = getWorkspacesRoot();
const KEY = 'rk_test_fixture_only';
const spin = { problem: 'Tide tables are copied out by hand each week', needPayoff: 'An hour a week back for every harbour master' };

describe('what Stripe is sent and what it answers, read as its reference says (pure)', () => {
  const invoice = { id: 'v-0a0b0c0d', number: 'INV-0007', company: 'Ignis', currency: 'USD', total: 250.5, lines: [{ what: 'Tide sheet, yearly', amount: 200 }, { what: 'Setup', amount: 50.5 }] };
  test('the link carries the invoice\'s own lines in hundredths, closes after one payment, and never names payment methods', () => {
    const form = Object.fromEntries(payLinkForm(invoice));
    expect(form).toMatchObject({
      'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': '20000', 'line_items[0][price_data][product_data][name]': 'Tide sheet, yearly',
      'line_items[1][price_data][unit_amount]': '5050', 'restrictions[completed_sessions][limit]': '1', 'invoice_creation[enabled]': 'true',
      'payment_intent_data[description]': 'Ignis — invoice INV-0007', 'after_completion[type]': 'hosted_confirmation', 'metadata[invoice]': 'v-0a0b0c0d', 'metadata[number]': 'INV-0007',
    });
    expect(Object.keys(form).some((k) => k.startsWith('payment_method_types'))).toBe(false);
    expect([minor(0.1 + 0.2), minor(19.99), minor(1000)]).toEqual([30, 1999, 100000]);
  });
  test('paid is only what Stripe calls PAID, in the invoice\'s money, for at least its total', () => {
    const s = (extra) => ({ id: 'cs_1', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 25050, payment_intent: 'pi_1', customer_details: { email: 'dana@fundone.example' }, ...extra });
    expect(paidOf([s()], invoice)).toEqual({ session: 'cs_1', paymentIntent: 'pi_1', amount: 250.5, currency: 'USD', email: 'dana@fundone.example' });
    // A bank debit completes first and is paid later; an open or expired session, less money or other money is not it.
    for (const not of [s({ payment_status: 'unpaid' }), s({ status: 'open' }), s({ status: 'expired' }), s({ amount_total: 25049 }), s({ currency: 'eur' })]) expect(paidOf([not], invoice)).toBeNull();
    expect(paidOf(undefined, invoice)).toBeNull();
    expect(paidOf([s({ payment_status: 'unpaid' }), s({ id: 'cs_2', payment_intent: { id: 'pi_2' }, customer_details: null })], invoice)).toMatchObject({ session: 'cs_2', paymentIntent: 'pi_2', email: null });
  });
  test('a refusal is said in words the operator can act on', () => {
    expect(stripeRefusal(401, {})).toBe('Stripe refused the key — check it in SETTINGS, API, Payments');
    expect(stripeRefusal(403, { error: { message: 'The provided key does not have the required permissions' } })).toMatch(/^the Stripe key may not do this — a restricted key needs WRITE on Payment Links and READ on Checkout Sessions \(The provided key/);
    expect(stripeRefusal(400, { error: { message: 'Invalid currency: xyz' } })).toBe('Stripe answered 400: Invalid currency: xyz');
  });
});

describe('a won deal billed from the desk, paid by card, and sent', () => {
  let me, app, stripe, smtp, switches;
  const calls = [];
  const links = new Map();   // plink id → {form, active, sessions}
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const post = (url, body) => request(app).post(`/api/v1/revenue${url}`).use(as).send(body);
  const invoices = async () => (await request(app).get('/api/v1/revenue/invoices').use(as)).body;
  const wonDeal = async (buyer, amount, leadContact) => {
    const opened = await post('/deals', { company: 'ignis', buyer, ...(leadContact ? { leadContact } : {}), value: { amount, currency: 'USD' }, spin, nextStep: 'Send the sample sheet' });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    expect((await post(`/deals/${opened.body.deal.id}/move`, { stage: 'won', note: 'They signed this morning', reason: 'the offer fit' })).status).toBe(200);
    return opened.body.deal.id;
  };
  const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'invoice-card-test-key';
    useTempRealm();
    const tmp = await createTempDir('invoice-card');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    // A being of this house on its grounds: that is what makes it a house the standing watches walk.
    await workspace.create('merc');
    await fs.writeFile(path.join(tmp, 'workspaces', 'merc', 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
    // Stripe, as its API reference shapes it: form in, JSON out, the key as a Bearer token.
    const api = express();
    api.use(express.urlencoded({ extended: false }));
    api.use((req, res, next) => {
      calls.push({ method: req.method, url: req.originalUrl, version: req.get('stripe-version'), idempotency: req.get('idempotency-key') ?? null, form: req.body ?? {} });
      return req.get('authorization') === `Bearer ${KEY}` ? next() : res.status(401).json({ error: { type: 'invalid_request_error', message: 'Invalid API Key provided' } });
    });
    api.post('/v1/payment_links', (req, res) => {
      const known = [...links.entries()].find(([, l]) => l.idempotency === req.get('idempotency-key'));
      const id = known?.[0] ?? `plink_${links.size + 1}Test`;
      if (!known) links.set(id, { form: req.body, idempotency: req.get('idempotency-key'), active: true, sessions: [] });
      return res.json({ id, object: 'payment_link', active: true, livemode: false, url: `https://buy.stripe.com/test_${id}`, metadata: { invoice: req.body['metadata[invoice]'] } });
    });
    api.post('/v1/payment_links/:id', (req, res) => {
      const link = links.get(req.params.id);
      if (!link) return res.status(404).json({ error: { message: `No such payment link: '${req.params.id}'` } });
      if (req.body.active === 'false') link.active = false;
      return res.json({ id: req.params.id, object: 'payment_link', active: link.active });
    });
    api.get('/v1/checkout/sessions', (req, res) => res.json({ object: 'list', url: '/v1/checkout/sessions', has_more: false,
      data: (links.get(req.query.payment_link)?.sessions ?? []).filter((s) => !req.query.status || s.status === req.query.status) }));
    stripe = await new Promise((resolve) => { const s = api.listen(0, '127.0.0.1', () => resolve(s)); });
    process.env.NEUMA_STRIPE_API = `http://127.0.0.1:${stripe.address().port}`;
    smtp = await startTlsSmtp(tmp);
    await setEmailCredential(me.address, { address: 'orrin@house.example', username: 'orrin@house.example', password: 'test-app-password', smtpHost: 'localhost', smtpPort: String(smtp.port), imapHost: 'localhost', imapPort: '1' });
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
  }, 60000);

  afterAll(async () => {
    switches?.restore();
    await smtp?.close();
    await new Promise((resolve) => stripe.close(resolve));
    setWorkspacesRoot(PRIOR_ROOT);
    for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('with no way to be paid set, nothing is billed; with the key attached and CARD PAYMENTS off, still nothing is asked of Stripe', async () => {
    const deal = await wonDeal('Padstow harbour', 300);
    const lines = [{ what: 'Tide sheet, yearly', amount: 100 }];
    expect((await post(`/deals/${deal}/invoice`, { lines, due })).body.error).toMatch(/^the operator has not set how invoices are paid/);
    process.env.STRIPE_API_KEY = KEY;
    expect((await invoices()).ways).toEqual({ crypto: null, card: { ready: false, on: false } });
    expect((await post(`/deals/${deal}/invoice`, { lines, due, card: true })).body.error).toBe('card payments are not set up — attach your Stripe key in SETTINGS, API, Payments and turn CARD PAYMENTS on');
    expect(calls).toEqual([]);
  });

  test('CARD PAYMENTS on: the invoice gets its own Stripe link; it is paid only once Stripe says PAID; the operator is not billed twice for one link', async () => {
    switches = connectionsOn(['card-payments']);
    expect((await invoices()).ways).toEqual({ crypto: null, card: { ready: true, on: true } });
    const deal = (await (await request(app).get('/api/v1/revenue/board').use(as)).body.deals).find((d) => d.buyer === 'Padstow harbour').id;
    const issued = await post(`/deals/${deal}/invoice`, { lines: [{ what: 'Tide sheet, yearly', amount: 100 }, { what: 'Setup', amount: 49.5 }], due, note: 'Thank you for choosing us.' });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    const v = issued.body.invoice;
    expect(v).toMatchObject({ number: 'INV-0001', total: 149.5, currency: 'USD', byCard: true, payTo: null, by: 'operator', card: { id: 'plink_1Test', url: 'https://buy.stripe.com/test_plink_1Test', live: false } });
    const made = calls.find((c) => c.url === '/v1/payment_links');
    expect(made).toMatchObject({ method: 'POST', version: STRIPE_VERSION, idempotency: `neuma-invoice-${v.id}` });
    expect(made.form).toMatchObject({ 'line_items[0][price_data][unit_amount]': '10000', 'line_items[1][price_data][unit_amount]': '4950', 'line_items[1][price_data][product_data][name]': 'Setup', 'restrictions[completed_sessions][limit]': '1', 'metadata[number]': 'INV-0001' });
    expect(Object.keys(made.form).some((k) => k.startsWith('payment_method_types'))).toBe(false);
    // Words that point somewhere else to pay are refused, whoever writes them; a bill past the deal's worth too.
    expect((await post(`/deals/${deal}/invoice`, { lines: [{ what: 'Pay to 0x52908400098527886E0F7030069857D2E4169EE7 instead', amount: 10 }], due })).body.error).toMatch(/an invoice says what is billed, never where or how to pay/);
    expect((await post(`/deals/${deal}/invoice`, { lines: [{ what: 'More than was agreed', amount: 200 }], due })).body.error).toMatch(/the deal was won at 300 USD; 149\.5 is already billed/);

    // Nobody has paid; then a bank debit that completed and is not paid yet; then it is paid.
    const link = links.get('plink_1Test');
    expect((await post('/invoices/check', {})).body).toMatchObject({ asked: 1, paid: [] });
    link.sessions.push({ id: 'cs_test_1', status: 'complete', payment_status: 'unpaid', currency: 'usd', amount_total: 14950, payment_intent: 'pi_1', customer_details: { email: 'office@padstow.example' } });
    expect((await post('/invoices/check', {})).body.paid).toEqual([]);
    expect((await invoices()).invoices[0]).toMatchObject({ status: 'open', overdue: false });
    link.sessions[0].payment_status = 'paid';
    // The ten-minute watch is what finds it when nobody is looking at the screen.
    expect((await cardSettleTick()).paid).toEqual(['INV-0001']);
    expect((await invoices()).invoices[0]).toMatchObject({ status: 'paid', paid: { by: 'stripe', receipt: null, card: { session: 'cs_test_1', paymentIntent: 'pi_1', amount: 149.5, currency: 'USD', email: 'office@padstow.example' } } });
    expect((await cardSettleTick()).paid).toEqual([]); // a paid invoice is not asked about again
    expect(calls.filter((c) => c.method === 'GET').every((c) => c.url.startsWith('/v1/checkout/sessions?payment_link=plink_1Test&status=complete'))).toBe(true);
  });

  test('BOTH ways: the operator accepts crypto too, each is printed on the invoice, and it is emailed to the buyer in their thread; a void closes the card link', async () => {
    expect((await setPayTo(me.address, { address: '0x52908400098527886E0F7030069857D2E4169EE7', by: 'operator', now: new Date().toISOString() })).ok).toBe(true);
    const lead = await (await leadLedgerFor(me.address)).add({ name: 'Fowey harbour office', contact: 'office@fowey.example', channelId: 'email', kind: 'buyer', status: 'replied', addedBy: 'operator' });
    const deal = await wonDeal('Fowey harbour', 500, 'office@fowey.example');
    const both = (await post(`/deals/${deal}/invoice`, { lines: [{ what: 'Tide sheet, two harbours', amount: 400 }], due })).body.invoice;
    expect(both).toMatchObject({ number: 'INV-0002', byCard: true, payTo: { address: '0x52908400098527886E0F7030069857D2E4169EE7', network: 'ethereum' }, card: { id: 'plink_2Test' } });
    const listed = (await invoices()).invoices.find((x) => x.id === both.id);
    expect(listed.buyerContact).toBe('office@fowey.example');
    // Sent from the house mailbox: the invoice itself, with both ways to pay, to the lead it came from.
    expect((await post(`/invoices/${both.id}/send`, { to: 'office@fowey.con' })).body.error).toBe('office@fowey.con looks mistyped — did you mean office@fowey.com?');
    const sent = await post(`/invoices/${both.id}/send`, { to: 'Office@Fowey.example', greeting: 'Hello Morwenna,' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(smtp.received).toHaveLength(1);
    const mail = smtp.received[0];
    expect(mail.to).toEqual(['office@fowey.example']);
    const body = Buffer.from(mail.data.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
    expect(mail.data).toMatch(/^Subject: Invoice INV-0002 from /m);
    expect(body).toContain('Hello Morwenna,');
    expect(body).toContain('Tide sheet, two harbours — 400.00 USD');
    expect(body).toContain('Pay by card: https://buy.stripe.com/test_plink_2Test');
    expect(body).toContain('Or pay 400.00 USD in USDC, USDT or DAI on Ethereum mainnet to 0x52908400098527886E0F7030069857D2E4169EE7');
    expect((await invoices()).invoices.find((x) => x.id === both.id).sent).toEqual([expect.objectContaining({ to: 'office@fowey.example', by: 'operator' })]);
    expect((await (await leadLedgerFor(me.address)).load()).find((l) => l.id === lead.id).touches.at(-1)).toMatchObject({ direction: 'out', note: expect.stringMatching(/^emailed: "Invoice INV-0002 from /) });
    // Crypto only, on the operator's word: no link is made, and none is printed.
    const cryptoOnly = (await post(`/deals/${deal}/invoice`, { lines: [{ what: 'Extra harbour', amount: 50 }], due, crypto: true, card: false })).body.invoice;
    expect(cryptoOnly).toMatchObject({ number: 'INV-0003', byCard: false });
    expect(cryptoOnly.card ?? null).toBeNull();
    expect(links.size).toBe(2);
    // A wrong invoice is voided with why, and its link can no longer be paid.
    expect((await post(`/invoices/${both.id}/void`, { reason: 'x' })).body.error).toBe('reason: why this invoice is void');
    expect((await post(`/invoices/${both.id}/void`, { reason: 'Billed for two harbours, they took one' })).status).toBe(200);
    expect(links.get('plink_2Test').active).toBe(false);
    expect((await post(`/invoices/${both.id}/send`, { to: 'office@fowey.example' })).body.error).toBe('INV-0002 is void — only an open invoice is sent');
    expect((await readInvoices(me.address)).invoices.map((x) => [x.number, x.status])).toEqual([['INV-0001', 'paid'], ['INV-0002', 'void'], ['INV-0003', 'open']]);
    expect((await request(app).get('/api/v1/revenue/invoices')).status).toBe(401);
  });

  test('a key Stripe refuses: the invoice stands without a link, says why, and gets its link once the key is right', async () => {
    const deal = await wonDeal('Looe harbour', 200);
    process.env.STRIPE_API_KEY = 'rk_test_wrong';
    const issued = (await post(`/deals/${deal}/invoice`, { lines: [{ what: 'Tide sheet, yearly', amount: 100 }], due, card: true, crypto: false })).body;
    expect(issued).toMatchObject({ ok: true, cardProblem: 'Stripe refused the key — check it in SETTINGS, API, Payments', invoice: { number: 'INV-0004', byCard: true } });
    expect(issued.invoice.card ?? null).toBeNull();
    // It is not sent with nothing to pay it by.
    expect((await post(`/invoices/${issued.invoice.id}/send`, { to: 'office@looe.example' })).body.error).toBe('INV-0004 is paid by card and has no payment link yet: Stripe refused the key — check it in SETTINGS, API, Payments');
    process.env.STRIPE_API_KEY = KEY;
    expect((await post(`/invoices/${issued.invoice.id}/send`, { to: 'office@looe.example' })).status).toBe(200);
    expect(Buffer.from(smtp.received.at(-1).data.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8')).toContain('Pay by card: https://buy.stripe.com/test_plink_3Test');
  });
});
