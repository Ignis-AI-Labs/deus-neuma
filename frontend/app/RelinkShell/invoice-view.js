// The invoices' display law (the TREASURY window's INVOICES): each invoice in
// one line, its standing said plainly, and each receipt that may pay it. An
// address reads exactly as it is. PURE.

const amount = (n, currency) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 6, minimumFractionDigits: currency === 'USD' ? 2 : 0 })} ${currency}`;

/** An invoice's standing. pure. */
export const standing = (v) => (v.status === 'open' ? (v.overdue ? 'OVERDUE' : 'OPEN') : v.status === 'paid' ? 'PAID' : 'VOID');

/** The invoice in one line. pure. */
export const invoiceWords = (v) => `${v.number} — ${v.buyer} — ${amount(v.total, v.currency)} — DUE ${v.due} — ${standing(v)}`;

/** A receipt that may pay it. pure. */
export const candidateWords = (c) => `PAID BY ${amount(c.amount, c.asset)} ON ${String(c.at).slice(0, 10)}`;

/** What became of it, when it is settled. pure. */
export const settledWords = (v) => (v.status === 'paid' ? `PAID ${String(v.paid.at).slice(0, 10)} BY RECEIPT ${v.paid.receipt}`
  : v.status === 'void' ? `VOID ${String(v.voided.at).slice(0, 10)} — ${v.voided.reason}` : null);
