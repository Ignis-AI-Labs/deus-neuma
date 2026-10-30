/**
 * The Quaestor's invoice acts (the house economy's Stage 3 — the deal is the
 * Mercator's, the money the Quaestor's, the books the Logista's):
 *
 *   treasury/invoice      — bill a deal the Mercator won: its lines and due
 *                           date. Where it is paid is the operator's setting,
 *                           put on the invoice by the house, never by a being.
 *   treasury/invoice-paid — the invoice is paid: name the money-in receipt
 *                           that paid it (at its address, on its network, in
 *                           its money, for at least its total; one receipt,
 *                           one invoice).
 *
 * THE SEAT LAW: both are the house's seated Quaestor's alone, re-read per act.
 * Neither moves money or reaches outside the house: the invoice reaches the
 * customer through the delivery door and the house mailbox, each gated.
 */
import { cfoDesignation } from '../treasury/cfo-designation.js';
import { readDeals } from '../revenue/deal-store.js';
import { readCompany } from '../company-line/company-store.js';
import { makeInvoice } from '../invoices/invoice-shape.js';
import { issueInvoice, recordPaid, readPayTo } from '../invoices/invoice-store.js';

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const seatRefusal = async (connection) => ((await cfoDesignation.holds(connection.walletAddress, connection.companion?.neumaId))
  ? null : { ok: false, status: 'denied', reason: 'invoices are the Quaestor office\'s — only the seated Quaestor issues them' });
const availableFor = async ({ laneId, connection }) => ((await cfoDesignation.holds(connection?.walletAddress, laneId)) ? {} : null);

export const invoiceIssueIntent = Object.freeze({
  name: 'treasury/invoice',
  policyTool: 'treasury.invoice',
  fieldsForPrompt: '{deal, lines: [{what, amount}], due: "YYYY-MM-DD", note?}',
  descriptionForPrompt: 'QUAESTOR ONLY. Bill a deal the Mercator won: deal is its [id]; lines what each part bills, in the deal\'s own currency (USD is paid in dollar stablecoins, ETH in ether, on Ethereum); due the date it falls due; note any terms. The live invoices of a deal never bill past what it was won at. You never write where it is paid — the house puts the operator\'s address on it. The Mercator delivers it (delivery/publish, then the house mailbox).',
  availableFor,
  validate: async (payload, { connection }) => {
    const seat = await seatRefusal(connection);
    if (seat) return seat;
    const wallet = connection.walletAddress;
    const deal = (await readDeals(wallet)).deals.find((d) => d.id === String(payload?.deal ?? '').trim()) ?? null;
    if (!deal) return invalid(`"${payload?.deal ?? ''}" is not a deal of this house — your QUAESTOR OFFICE briefing names each won deal by its [id]`);
    const [company, payTo] = await Promise.all([readCompany(wallet, deal.companyId).catch(() => null), readPayTo(wallet)]);
    try {
      // a dry judgment against an empty bill: the real one is re-judged under the store's chain
      makeInvoice({ ...payload, deal, company, payTo, number: 'INV-0000', billed: 0, by: connection.companion.neumaId, now: new Date().toISOString() });
    } catch (error) {
      return invalid(error.message);
    }
    return { ok: true, value: { deal, company, payTo, lines: payload.lines, due: payload.due, note: payload.note } };
  },
  summarize: (payload) => `invoice deal ${payload?.deal ?? '?'} (${Array.isArray(payload?.lines) ? payload.lines.length : 0} line(s), due ${payload?.due ?? '?'})`,
  execute: async (value, { connection }) => {
    const issued = await issueInvoice(connection.walletAddress, ({ number, billed }) => makeInvoice({
      ...value, number, billed: billed(value.deal.id), by: connection.companion.neumaId, now: new Date().toISOString(),
    }));
    if (!issued.ok) return { ok: false, reason: issued.reason };
    const v = issued.invoice;
    return { ok: true, detail: `Issued ${v.number} [${v.id}] to ${v.buyer}: ${v.total} ${v.currency}, due ${v.due}, payable at the operator's address. The Mercator delivers it: delivery/publish {deal: "${v.dealId}", invoice: "${v.id}"}, then the link by the house mailbox.` };
  },
});

export const invoicePaidIntent = Object.freeze({
  name: 'treasury/invoice-paid',
  policyTool: 'treasury.invoice-paid',
  fieldsForPrompt: '{invoice, receipt}',
  descriptionForPrompt: 'QUAESTOR ONLY. An invoice is paid: invoice is its [id] or number; receipt the money-in receipt\'s key that paid it (your briefing lists the receipts at each open invoice\'s address). It holds only if the receipt landed there, on its network, in its money, for at least its total — and a receipt pays one invoice. The Logista then books the receipt.',
  availableFor,
  validate: async (payload, { connection }) => {
    const seat = await seatRefusal(connection);
    if (seat) return seat;
    const invoiceId = String(payload?.invoice ?? '').trim();
    const receiptKey = String(payload?.receipt ?? '').trim();
    if (!invoiceId || !receiptKey) return invalid('name {invoice, receipt}');
    return { ok: true, value: { invoiceId, receiptKey } };
  },
  summarize: (payload) => `invoice ${payload?.invoice ?? '?'} paid by ${String(payload?.receipt ?? '?').slice(0, 24)}`,
  execute: async (value, { connection }) => {
    const paid = await recordPaid(connection.walletAddress, { ...value, by: connection.companion.neumaId, now: new Date().toISOString() });
    if (!paid.ok) return { ok: false, reason: paid.reason };
    return { ok: true, detail: `${paid.invoice.number} is paid, by receipt ${value.receiptKey}. The Logista books that receipt (accounts/book) as revenue.` };
  },
});

export const invoiceIntents = Object.freeze([invoiceIssueIntent, invoicePaidIntent]);
