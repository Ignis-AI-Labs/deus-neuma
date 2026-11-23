// deal-invoice-routes — the operator bills a won deal from the deals screen (mounted inside revenue-routes.js, behind
// its auth): issue an invoice, see every invoice and how each can be paid, email one to its buyer, void one, and ask
// Stripe now whether a card invoice was paid. Design note, 2026-11-21: […]
//
//   GET  /invoices               every invoice, newest first, and the ways the house can be paid
//   POST /deals/:id/invoice      {lines: [{what, amount}], due, note?, card?, crypto?}
//   POST /invoices/:id/send      {to, greeting?} — from the house mailbox, on this press
//   POST /invoices/:id/void      {reason}
//   POST /invoices/check         ask Stripe now
import express from 'express';
import { readDeals } from '../services/revenue/deal-store.js';
import { companyOfHouse } from '../services/revenue/deal-company.js';
import { makeInvoice } from '../services/invoices/invoice-shape.js';
import { issueInvoice, invoiceBoard, readPayTo, cardKey, voidInvoice, settleCardInvoices } from '../services/invoices/invoice-store.js';
import { sendInvoice } from '../services/invoices/invoice-send.js';
import { leadLedgerFor } from '../services/leads/lead-ledger.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('DealInvoices');
const router = express.Router();
const guard = (label, fn) => async (req, res) => {
  try { return await fn(req, res); } catch (error) { log.error(`${label} failed`, { error: error.message }); return res.status(500).json({ error: `Could not ${label}` }); }
};

// The screen being opened is a reason to ask Stripe now, at most once a minute a house.
const ASK_EVERY_MS = 60_000;
const asked = new Map();
const settleSoon = async (wallet) => {
  const key = String(wallet).toLowerCase();
  if (Date.now() - (asked.get(key) ?? 0) < ASK_EVERY_MS) return;
  asked.set(key, Date.now());
  await settleCardInvoices(wallet);
};

const board = async (wallet) => {
  const [b, deals, leads] = await Promise.all([invoiceBoard(wallet, Date.now()), readDeals(wallet), (await leadLedgerFor(wallet)).load().catch(() => [])]);
  // Who each invoice would be sent to: the address of the lead its deal came from, when it came from one.
  const contactOf = new Map(deals.deals.map((d) => [d.id, leads.find((l) => l.id === d.leadId)?.contact ?? null]));
  return { invoices: b.invoices.map((v) => ({ ...v, buyerContact: contactOf.get(v.dealId) ?? null })), ways: { crypto: b.payTo ? { address: b.payTo.address, network: b.payTo.network } : null, card: b.card } };
};

router.get('/invoices', guard('read the invoices', async (req, res) => { await settleSoon(req.walletAddress); return res.json(await board(req.walletAddress)); }));

router.post('/invoices/check', guard('ask Stripe', async (req, res) => {
  asked.set(String(req.walletAddress).toLowerCase(), Date.now());
  const settled = await settleCardInvoices(req.walletAddress);
  return res.json({ ok: true, ...settled, ...(await board(req.walletAddress)) });
}));

router.post('/deals/:id/invoice', guard('issue the invoice', async (req, res) => {
  const wallet = req.walletAddress;
  const deal = (await readDeals(wallet)).deals.find((d) => d.id === String(req.params.id)) ?? null;
  if (!deal) return res.status(404).json({ error: 'no such deal in this house' });
  const [company, payTo, key] = await Promise.all([companyOfHouse(wallet, deal.companyId), readPayTo(wallet), cardKey(wallet)]);
  if (!company) return res.status(400).json({ error: 'the company this deal is for is no longer a company of this house' });
  // Which ways this invoice offers: what the operator ticked, or every way the house can take when nothing was said.
  const said = req.body?.card !== undefined || req.body?.crypto !== undefined;
  const issued = await issueInvoice(wallet, ({ number, billed }) => makeInvoice({
    deal, company, payTo, cardReady: Boolean(key), ...(said ? { ways: { card: req.body?.card === true, crypto: req.body?.crypto === true } } : {}),
    lines: req.body?.lines, due: req.body?.due, note: req.body?.note, number, billed: billed(deal.id), by: 'operator', now: new Date().toISOString(),
  }));
  if (!issued.ok) return res.status(400).json({ error: issued.reason });
  log.info('An invoice was issued by the operator', { invoice: issued.invoice.number, deal: deal.id, card: Boolean(issued.invoice.card) });
  return res.json({ ok: true, invoice: issued.invoice, ...(issued.cardProblem ? { cardProblem: issued.cardProblem } : {}), ...(await board(wallet)) });
}));

router.post('/invoices/:id/send', guard('send the invoice', async (req, res) => {
  const sent = await sendInvoice(req.walletAddress, { invoiceId: String(req.params.id), to: req.body?.to, greeting: String(req.body?.greeting ?? ''), by: 'operator' });
  if (!sent.ok) return res.status(/no such/.test(sent.reason) ? 404 : 400).json({ error: sent.reason });
  log.info('An invoice was emailed by the operator', { invoice: sent.number });
  return res.json({ ok: true, to: sent.to, ...(await board(req.walletAddress)) });
}));

router.post('/invoices/:id/void', guard('void the invoice', async (req, res) => {
  const done = await voidInvoice(req.walletAddress, { invoiceId: String(req.params.id), reason: req.body?.reason, by: 'operator', now: new Date().toISOString() });
  if (!done.ok) return res.status(/no such/.test(done.reason) ? 404 : 400).json({ error: done.reason });
  return res.json({ ok: true, ...(await board(req.walletAddress)) });
}));

export default router;
