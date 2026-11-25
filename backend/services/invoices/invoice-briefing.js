// The invoices part of the QUAESTOR OFFICE briefing: the won deals still to
// bill, every open invoice (overdue said), and the receipts landed at each
// one's address that pay no invoice yet — so the office names the receipt
// that paid it, never guesses. Where invoices are paid is the operator's
// setting; when it is not set, the briefing says so.
// The lines are pure; the read is impure.

import { readDeals } from '../revenue/deal-store.js';
import { readReceipts } from '../money-in/money-in-store.js';
import { readInvoices, readPayTo, cardKey } from './invoice-store.js';
import { billedFor, overdue, unmatchedFor } from './invoice-shape.js';

const CAP = 10;

/** The lines. pure. */
export const invoiceBriefingLines = ({ deals, invoices, receipts, payTo, nowMs, cardReady = false }) => {
  const toBill = deals.filter((d) => d.stage === 'won' && billedFor(invoices, d.id) < d.value.amount);
  const open = invoices.filter((v) => v.status === 'open');
  if (!toBill.length && !open.length) return [];
  return [
    '',
    '### Invoices',
    payTo ? `Invoices are paid to the operator's ${payTo.address} on ${payTo.network} — the house puts it on each invoice; you never write it.`
      : cardReady ? 'Invoices are paid by card: the house makes each one its own Stripe payment link on the operator\'s Stripe account and prints it on the invoice; you never write it.'
        : 'The operator has not set how invoices are paid — no invoice can be issued until they do (a crypto address in TREASURY, or Stripe in SETTINGS, API, Payments). Ask them by house post if a deal waits.',
    ...(payTo && cardReady ? ['They can also be paid by card: the house makes each invoice its own Stripe payment link and prints it beside the address. A card invoice is marked paid by the house when Stripe says so — you record only a crypto receipt.'] : []),
    ...toBill.slice(0, CAP).map((d) => `- to bill: deal [${d.id}] ${d.buyer}, won at ${d.value.amount} ${d.value.currency}; billed ${billedFor(invoices, d.id)} — treasury/invoice`),
    ...open.slice(0, CAP).flatMap((v) => {
      const maybe = unmatchedFor(v, receipts, invoices).filter((r) => Number(r.amount) >= v.total).slice(0, 3);
      return [
        `- open: ${v.number} [${v.id}] ${v.buyer} ${v.total} ${v.currency}, due ${v.due}${overdue(v, nowMs) ? ' — OVERDUE' : ''}${v.card ? ' · has its card link' : ''}${v.sent?.length ? ` · sent to ${v.sent.at(-1).to}` : ' · not sent to the buyer yet'}`,
        ...maybe.map((r) => `  - a receipt that may be its: ${r.amount} ${r.asset} on ${r.timestamp.slice(0, 10)}, key ${r.key} — treasury/invoice-paid if it is`),
      ];
    }),
  ];
};

/** The lines for this house, or [] when there is nothing to bill or collect. impure. */
export const invoiceBriefing = async (wallet, nowMs) => {
  const [{ deals }, { invoices }, receipts, payTo, key] = await Promise.all([
    readDeals(wallet), readInvoices(wallet), readReceipts(wallet).catch(() => []), readPayTo(wallet), cardKey(wallet).catch(() => null),
  ]);
  return invoiceBriefingLines({ deals, invoices, receipts, payTo, nowMs, cardReady: Boolean(key) });
};
