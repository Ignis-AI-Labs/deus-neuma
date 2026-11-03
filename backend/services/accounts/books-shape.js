// THE BOOKS — the Logista's record of every dollar a company moves
// (docs/planning/proposals/governance/house-company-line.md §3, §5 BOOK).
// TREASURY is not ACCOUNTS: the Quaestor moves money, the Logista records it.
//
// An entry matched to a receipt the machine already holds — a money-in receipt
// (money-in/), an executed spend (treasury/) — takes its amount, currency,
// date and direction FROM that receipt: the books can never drift from what
// moved. Only money with no receipt on this machine (cash, a bank transfer)
// is entered by hand, and it must name its source (SHINKEI) — it stands as
// UNMATCHED on every statement until a receipt backs it.
//
// The record is append-only: a wrong entry is voided (with why) and booked
// again, never edited. Deadlines (tax, filings) ride beside it, each citing
// where the date comes from and whether a licensed CPA must sign.
// Events: { type: 'booked', entry, at }  { type: 'voided', id, reason, by, at }
//         { type: 'deadline', deadline, at }  { type: 'met', id, note, by, at }
// PURE, but for the random ids.

import crypto from 'crypto';
import { sourceLaw } from '../company-line/source-law.js';

export const CATEGORIES = Object.freeze(['revenue', 'investment', 'cost-of-sales', 'compute', 'software', 'fees', 'taxes', 'contractors', 'other']);
const CURRENCY = /^[A-Z]{2,6}$/;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);
const { isSource, words: SOURCE_WORDS } = sourceLaw(['invoice', 'bank', 'receipt', 'statement', 'document']);

const id = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex')}`;

/**
 * One entry, or a thrown reason. `matched` is the receipt the caller looked up
 * for a money-in or spend entry ({direction, amount, currency, date}); a
 * manual entry carries its own figures and a source. Pure but for its id.
 * @param {{receipt: object, matched: ?object, category: unknown, memo: unknown, by: string, now: string}} fields
 */
export const makeEntry = ({ receipt, matched, category, memo, by, now }) => {
  if (!CATEGORIES.includes(category)) throw new Error(`category is one of ${CATEGORIES.join(', ')}`);
  const note = clean(memo, 300);
  if (note.length < 3) throw new Error('memo: what this money was for');
  const kind = receipt?.kind;
  if (kind === 'money-in' || kind === 'spend') {
    if (!matched) throw new Error(`no ${kind} receipt "${receipt?.ref ?? ''}" in this house — the LOGISTA OFFICE briefing lists the unbooked ones by ref`);
    return Object.freeze({ id: id('b'), ...matched, receipt: Object.freeze({ kind, ref: String(receipt.ref) }), category, memo: note, by, bookedAt: now });
  }
  if (kind !== 'manual') throw new Error('receipt.kind is money-in, spend, or manual');
  const amount = Number(receipt.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('a manual entry carries receipt.amount, above zero');
  if (!CURRENCY.test(String(receipt.currency))) throw new Error('receipt.currency: USD, EUR, ETH, USDC …');
  if (!['in', 'out'].includes(receipt.direction)) throw new Error('receipt.direction is in or out');
  if (Number.isNaN(Date.parse(receipt.date))) throw new Error('receipt.date: when the money moved');
  if (!isSource(receipt.source)) throw new Error(`receipt.source: ${SOURCE_WORDS}`);
  return Object.freeze({
    id: id('b'), direction: receipt.direction, amount, currency: receipt.currency, date: String(receipt.date),
    receipt: Object.freeze({ kind: 'manual', ref: null, source: clean(receipt.source, 300) }), category, memo: note, by, bookedAt: now,
  });
};

/** One deadline, or a thrown reason. Pure but for its id. */
export const makeDeadline = ({ what, due, authority, source, needsCpa, by, now }) => {
  const w = clean(what, 160);
  if (w.length < 5) throw new Error('what: the filing or payment that falls due');
  if (Number.isNaN(Date.parse(due))) throw new Error('due: the date it falls due');
  const a = clean(authority, 120);
  if (a.length < 2) throw new Error('authority: who it is owed to (the IRS, the state, …)');
  if (!isSource(source)) throw new Error(`source: where this date comes from — ${SOURCE_WORDS}`);
  return Object.freeze({ id: id('t'), what: w, due: String(due), authority: a, source: clean(source, 300), needsCpa: needsCpa === true, by, setAt: now });
};

/**
 * Fold the record: live entries, voided entries, and deadlines. pure.
 * @param {Array<object>} events
 */
export const foldBooks = (events) => events.reduce((acc, e) => {
  if (e?.type === 'booked' && e.entry?.id) return { ...acc, entries: [...acc.entries, e.entry] };
  if (e?.type === 'voided' && acc.entries.some((x) => x.id === e.id)) {
    return { ...acc, entries: acc.entries.filter((x) => x.id !== e.id), voided: [...acc.voided, { ...acc.entries.find((x) => x.id === e.id), void: { reason: e.reason, by: e.by, at: e.at } }] };
  }
  if (e?.type === 'deadline' && e.deadline?.id) return { ...acc, deadlines: [...acc.deadlines, { ...e.deadline, met: null }] };
  if (e?.type === 'met' && acc.deadlines.some((d) => d.id === e.id && !d.met)) {
    return { ...acc, deadlines: acc.deadlines.map((d) => (d.id === e.id ? { ...d, met: { note: e.note, by: e.by, at: e.at } } : d)) };
  }
  return { ...acc, skipped: acc.skipped + 1 };
}, { entries: [], voided: [], deadlines: [], skipped: 0 });

/**
 * The statement for a period: per currency, money in, out and net; per
 * category; and how many entries stand unmatched (no receipt backs them). pure.
 * @param {ReadonlyArray<object>} entries - live entries
 * @param {{from?: string, to?: string}} [period] - inclusive ISO dates; none = all time
 */
export const statement = (entries, { from = null, to = null } = {}) => {
  const inPeriod = entries.filter((e) => (!from || e.date.slice(0, 10) >= from) && (!to || e.date.slice(0, 10) <= to));
  const byCurrency = inPeriod.reduce((acc, e) => {
    const c = acc[e.currency] ?? { in: 0, out: 0 };
    return { ...acc, [e.currency]: { ...c, [e.direction]: c[e.direction] + e.amount } };
  }, {});
  return {
    from, to,
    currencies: Object.fromEntries(Object.entries(byCurrency).map(([c, v]) => [c, { ...v, net: v.in - v.out }])),
    byCategory: inPeriod.reduce((acc, e) => ({ ...acc, [e.category]: (acc[e.category] ?? 0) + 1 }), {}),
    entries: inPeriod.length,
    unmatched: inPeriod.filter((e) => e.receipt.kind === 'manual').length,
  };
};

/** Open deadlines falling due within `days` of now, soonest first. pure. */
export const upcoming = (deadlines, nowMs, days = 60) => deadlines
  .filter((d) => !d.met && Date.parse(d.due) - nowMs <= days * 86_400_000)
  .sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
