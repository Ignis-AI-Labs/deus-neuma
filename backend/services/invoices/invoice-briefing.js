// The invoices part of the QUAESTOR OFFICE briefing: the won deals still to
// bill, every open invoice (overdue said), and the receipts landed at each
// one's address that pay no invoice yet — so the office names the receipt
// that paid it, never guesses. Where invoices are paid is the operator's
// setting; when it is not set, the briefing says so.
// The lines are pure; the read is impure.

import { readDeals } from '../revenue/deal-store.js';
import { readReceipts } from '../money-in/money-in-store.js';
import { readInvoices, readPayTo } from './invoice-store.js';
import { billedFor, overdue, unmatchedFor } from './invoice-shape.js';

const CAP = 10;

/** The lines. pure. */
export const invoiceBriefingLines = ({ deals, invoices, receipts, payTo, nowMs }) => {
  const toBill = deals.filter((d) => d.stage === 'won' && billedFor(invoices, d.id) < d.value.amount);
  const open = invoices.filter((v) => v.status === 'open');
  if (!toBill.length && !open.length) return [];
  return [
    '',
    '### Invoices',
    payTo ? `Invoices are paid to the operator's ${payTo.address} on ${payTo.network} — the house puts it on each invoice; you never write it.`
      : 'The operator has not set where invoices are paid — no invoice can be issued until they do (TREASURY). Ask them by house post if a deal waits.',
    ...toBill.slice(0, CAP).map((d) => `- to bill: deal [${d.id}] ${d.buyer}, won at ${d.value.amount} ${d.value.currency}; billed ${billedFor(invoices, d.id)} — treasury/invoice`),
    ...open.slice(0, CAP).flatMap((v) => {
      const maybe = unmatchedFor(v, receipts, invoices).filter((r) => Number(r.amount) >= v.total).slice(0, 3);
      return [
        `- open: ${v.number} [${v.id}] ${v.buyer} ${v.total} ${v.currency}, due ${v.due}${overdue(v, nowMs) ? ' — OVERDUE' : ''}`,
        ...maybe.map((r) => `  - a receipt that may be its: ${r.amount} ${r.asset} on ${r.timestamp.slice(0, 10)}, key ${r.key} — treasury/invoice-paid if it is`),
      ];
    }),
  ];
};

/** The lines for this house, or [] when there is nothing to bill or collect. impure. */
export const invoiceBriefing = async (wallet, nowMs) => {
  const [{ deals }, { invoices }, receipts, payTo] = await Promise.all([
    readDeals(wallet), readInvoices(wallet), readReceipts(wallet).catch(() => []), readPayTo(wallet),
  ]);
  return invoiceBriefingLines({ deals, invoices, receipts, payTo, nowMs });
};
