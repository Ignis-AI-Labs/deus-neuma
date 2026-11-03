// AN INVOICE — the Quaestor's bill for a deal the Mercator won (the house
// economy's Stage 3; house-company-line.md §5: the deal is the Mercator's,
// the money the Quaestor's, the books the Logista's). Money in only, on
// Ethereum, receive-only: an invoice in USD is paid in dollar stablecoins, one
// in ETH in ether. Stripe waits (ruling 2026-10-16 §8.3).
//
// NO BEING WRITES PAYMENT DETAILS: where an invoice is paid is the operator's
// own setting, snapshotted onto the invoice when it is issued; the Quaestor
// names only the deal, the lines and the due date. The invoice's document is
// rendered here from the record, never from a file a being could edit.
//
// Paid is a fact, not a claim: a receipt the house's money-in ledger holds, at
// the invoice's address, on its network, in its money, for at least its total
// — and one receipt pays one invoice. A wrong invoice is voided with why.
// Events: { type: 'issued', invoice, at }  { type: 'paid', id, receipt, by, at }
//         { type: 'voided', id, reason, by, at }
// PURE, but for the random ids.

import crypto from 'crypto';

export const INVOICE_CURRENCIES = Object.freeze(['USD', 'ETH']);
const DOLLARS = Object.freeze(['USDC', 'USDT', 'DAI']);
const LINES_MAX = 20;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);
const round = (n) => Math.round(n * 1e6) / 1e6;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The invoice's number, from how many the house issued before it. pure. */
export const invoiceNumber = (issuedBefore) => `INV-${String(issuedBefore + 1).padStart(4, '0')}`;

/**
 * Issue an invoice for a won deal, or a thrown reason. Pure but for its id.
 * @param {{deal: ?object, company: ?object, lines: unknown, due: unknown, note?: unknown,
 *   payTo: ?{address: string, network: string}, number: string, billed: number, by: string, now: string}} fields
 *   billed: what the deal's live invoices already bill, in its currency
 */
export const makeInvoice = ({ deal, company, lines, due, note, payTo, number, billed, by, now }) => {
  if (!deal) throw new Error('no such deal in this house — the QUAESTOR OFFICE briefing names each won deal by its [id]');
  if (deal.stage !== 'won') throw new Error(`that deal is ${deal.stage} — an invoice bills a deal the Mercator won`);
  if (!payTo) throw new Error('the operator has not set where invoices are paid — no being writes payment details; ask the operator to set it in TREASURY');
  const currency = deal.value.currency;
  if (!INVOICE_CURRENCIES.includes(currency)) throw new Error(`the deal is in ${currency}; the house's wallet takes USD (in dollar stablecoins) or ETH today — card payments wait`);
  const items = Array.isArray(lines) ? lines.slice(0, LINES_MAX + 1) : [];
  if (!items.length || items.length > LINES_MAX) throw new Error(`lines: 1 to ${LINES_MAX} of {what, amount}`);
  const billedLines = items.map((l, i) => {
    const what = clean(l?.what, 200);
    const amount = Number(l?.amount);
    if (what.length < 3) throw new Error(`lines[${i}].what: what this line bills`);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`lines[${i}].amount: above zero, in ${currency}`);
    return Object.freeze({ what, amount: round(amount) });
  });
  const total = round(billedLines.reduce((sum, l) => sum + l.amount, 0));
  if (round(billed + total) > deal.value.amount) {
    throw new Error(`the deal was won at ${deal.value.amount} ${currency}; ${billed} is already billed — this invoice would bill past it`);
  }
  if (!DATE.test(String(due)) || Number.isNaN(Date.parse(due)) || String(due) < String(now).slice(0, 10)) throw new Error('due: the date it falls due, YYYY-MM-DD, today or later');
  return Object.freeze({
    id: `v-${crypto.randomBytes(4).toString('hex')}`, number, companyId: company.id, company: company.name, dealId: deal.id, buyer: deal.buyer,
    lines: Object.freeze(billedLines), total, currency, due: String(due), note: clean(note, 600) || null,
    payTo: Object.freeze({ address: payTo.address, network: payTo.network }), by, issuedAt: now,
  });
};

/**
 * Fold the record: every invoice, each with its standing. pure.
 * @param {Array<object>} events
 */
export const foldInvoices = (events) => events.reduce((acc, e) => {
  if (e?.type === 'issued' && e.invoice?.id && !acc.invoices.some((v) => v.id === e.invoice.id)) {
    return { ...acc, invoices: [...acc.invoices, { ...e.invoice, status: 'open', paid: null, voided: null }] };
  }
  const v = acc.invoices.find((x) => x.id === e?.id && x.status === 'open');
  if (v && e.type === 'paid') return { ...acc, invoices: acc.invoices.map((x) => (x === v ? { ...x, status: 'paid', paid: { receipt: e.receipt, by: e.by, at: e.at } } : x)) };
  if (v && e.type === 'voided') return { ...acc, invoices: acc.invoices.map((x) => (x === v ? { ...x, status: 'void', voided: { reason: e.reason, by: e.by, at: e.at } } : x)) };
  return { ...acc, skipped: acc.skipped + 1 };
}, { invoices: [], skipped: 0 });

/** What a deal's live invoices already bill. pure. */
export const billedFor = (invoices, dealId) => round(invoices.filter((v) => v.dealId === dealId && v.status !== 'void').reduce((s, v) => s + v.total, 0));

/** Past its due date and unpaid? pure. */
export const overdue = (invoice, nowMs) => invoice.status === 'open' && Date.parse(`${invoice.due}T23:59:59Z`) < nowMs;

/** Is this receipt the invoice's money? pure. */
const sameMoney = (invoice, receipt) => (invoice.currency === 'ETH' ? receipt.asset === 'ETH' : DOLLARS.includes(receipt.asset));

/**
 * Was this invoice paid by this receipt? pure.
 * @param {Array<object>} invoices - folded
 * @param {{invoiceId: string, receipt: ?object, by: string, now: string}} args - receipt: a money-in row
 */
export const judgePaid = (invoices, { invoiceId, receipt, by, now }) => {
  const v = invoices.find((x) => x.id === invoiceId || x.number === invoiceId);
  if (!v) return { ok: false, reason: 'no such invoice in this house' };
  if (v.status !== 'open') return { ok: false, reason: `${v.number} is ${v.status === 'paid' ? 'already paid' : 'void'}` };
  if (!receipt) return { ok: false, reason: 'no such receipt in the house\'s money-in ledger — the money has not landed' };
  if (invoices.some((x) => x.paid?.receipt === receipt.key)) return { ok: false, reason: 'that receipt already paid another invoice — one receipt, one invoice' };
  if (String(receipt.to).toLowerCase() !== v.payTo.address.toLowerCase() || receipt.network !== v.payTo.network) {
    return { ok: false, reason: `that receipt landed at ${receipt.to} on ${receipt.network}, not ${v.number}'s ${v.payTo.address} on ${v.payTo.network}` };
  }
  if (!sameMoney(v, receipt) || Number(receipt.amount) < v.total) return { ok: false, reason: `the receipt holds ${receipt.amount} ${receipt.asset}; ${v.number} is ${v.total} ${v.currency}` };
  return { ok: true, event: { type: 'paid', id: v.id, receipt: receipt.key, by, at: now } };
};

/** Void an open invoice with why. pure. */
export const judgeVoid = (invoices, { invoiceId, reason, by, now }) => {
  const v = invoices.find((x) => x.id === invoiceId || x.number === invoiceId);
  if (!v) return { ok: false, reason: 'no such invoice in this house' };
  if (v.status !== 'open') return { ok: false, reason: `${v.number} is ${v.status} — only an open invoice is voided` };
  const why = clean(reason, 300);
  if (why.length < 5) return { ok: false, reason: 'reason: why this invoice is void' };
  return { ok: true, event: { type: 'voided', id: v.id, reason: why, by, at: now } };
};

/** Receipts at an open invoice's address that pay no invoice yet: the ones that may be its. pure. */
export const unmatchedFor = (invoice, receipts, invoices) => receipts.filter((r) => String(r.to).toLowerCase() === invoice.payTo.address.toLowerCase()
  && r.network === invoice.payTo.network && sameMoney(invoice, r) && !invoices.some((x) => x.paid?.receipt === r.key));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, currency) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 6, minimumFractionDigits: currency === 'USD' ? 2 : 0 })} ${currency}`;

/**
 * The invoice as the customer reads it — one self-contained page, rendered
 * from the record (the payment address is the operator's, as snapshotted).
 * Every word a being wrote is escaped. pure.
 */
export const invoiceHtml = (v) => {
  const pay = v.currency === 'ETH' ? `${money(v.total, 'ETH')}` : `${money(v.total, 'USD')} in USDC, USDT or DAI`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(v.company)} — invoice ${esc(v.number)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.5rem;color:#111;line-height:1.5}
table{width:100%;border-collapse:collapse;margin:1.5rem 0}td,th{text-align:left;padding:.5rem;border-bottom:1px solid #ddd}
td.n,th.n{text-align:right}.pay{background:#f5f5f5;padding:1rem;word-break:break-all}.small{color:#555;font-size:.9rem}</style></head>
<body>
<h1>${esc(v.company)}</h1>
<p><strong>Invoice ${esc(v.number)}</strong><br>Issued ${esc(v.issuedAt.slice(0, 10))} · Due ${esc(v.due)}<br>Billed to ${esc(v.buyer)}</p>
<table><thead><tr><th>For</th><th class="n">Amount</th></tr></thead><tbody>
${v.lines.map((l) => `<tr><td>${esc(l.what)}</td><td class="n">${esc(money(l.amount, v.currency))}</td></tr>`).join('\n')}
<tr><th>Total</th><th class="n">${esc(money(v.total, v.currency))}</th></tr></tbody></table>
${v.note ? `<p>${esc(v.note)}</p>` : ''}
<div class="pay"><p><strong>Pay ${esc(pay)} on ${esc(v.payTo.network === 'ethereum' ? 'Ethereum mainnet' : v.payTo.network)} to</strong></p>
<p><code>${esc(v.payTo.address)}</code></p>
<p class="small">The payment is matched to this invoice by its amount and this address. Send from a wallet you control, and only on the network named here.</p></div>
<p class="small">This invoice was prepared by an AI agent team working for ${esc(v.company)}, under its operator's review. Questions go to the address it came from.</p>
</body></html>
`;
};
