// THE RAISE ROOM — a standing company raising its own capital
// (docs/planning/proposals/governance/house-company-line.md §8). Founder,
// 2026-10-29: […]
//
// The foundation the outreach stands on:
//   - THE MANDATE: the Quaestor drafts it (amount, instrument, valuation range
//     and how it was reached, use of funds, the legal route, outreach limits,
//     the smallest check). It holds NO payment details — the operator enters
//     the receiving account when they SIGN it, attesting counsel chose the
//     route. Signed, it is the fence every ask stands inside.
//   - THE FACTS SHEET: the Numerarius files it — every figure with its
//     source, every forward-looking line marked as one. Counsel reviews it once
//     (the operator records the answer); only a reviewed sheet backs an ask.
// Events: { type: 'mandate', mandate, at }   { type: 'signed', id, account, by, at }
//         { type: 'paused'|'resumed'|'closed', note, by, at }
//         { type: 'facts', sheet, at }        { type: 'reviewed', sheetId, verdict, note, by, at }
//         { type: 'investor', investor, at }  { type: 'cleared', id, verdict, note, by, at }
//         { type: 'reach', id, to, subject, text, messageId, by, at }   { type: 'update', id, status, note, by, at }
//         { type: 'terms', id, amount, valuation, notes, by, at }       { type: 'terms-check', id, verdict, note, by, at }
//         { type: 'closed-in', id, amount, received, by, at }
// Outreach (the speculator lists, the Praetor clears under the route, the
// Mercator reaches): a declined investor ends the thread (MAKOTO), and the
// mandate's limits bound the pace.
// PURE, but for the random ids.

import crypto from 'crypto';
import { sourceLaw } from '../company-line/source-law.js';
import { EMAIL_ADDRESS_PATTERN } from '../email/smtp-sender.js';

export const INSTRUMENTS = Object.freeze(['safe', 'priced', 'convertible']);
export const ROUTES = Object.freeze(['506c', '506b', 'reg-cf', 'other']);
const { isSource, words: SOURCE_WORDS } = sourceLaw(['ledger', 'books', 'document', 'dataset', 'interview']);
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);
const count = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const id = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex')}`;

/**
 * The Quaestor's draft, or a thrown reason. Pure but for its id.
 * @param {object} fields
 */
export const makeMandate = ({ amount, currency, instrument, valuation, useOfFunds, route, limits, minCheck, by, now }) => {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount: how much this raise seeks, above zero');
  if (!/^[A-Z]{2,6}$/.test(String(currency))) throw new Error('currency: USD, EUR, ETH, USDC …');
  if (!INSTRUMENTS.includes(instrument)) throw new Error(`instrument is one of ${INSTRUMENTS.join(', ')}`);
  const v = valuation ?? {};
  if (!Number.isFinite(v.low) || !Number.isFinite(v.high) || v.low <= 0 || v.high < v.low) throw new Error('valuation: {low, high} — the range the house will accept, high at least low');
  if (clean(v.basis, 600).length < 20) throw new Error('valuation.basis: how the range was reached — the model and the comparables, cited');
  if (clean(useOfFunds, 1000).length < 20) throw new Error('useOfFunds: what the money will do');
  if (!ROUTES.includes(route?.kind)) throw new Error(`route.kind is the legal route counsel chose: ${ROUTES.join(', ')}`);
  if (clean(route?.jurisdiction, 80).length < 2) throw new Error('route.jurisdiction: where the offering is made (US, a state, a country)');
  if (!count(limits?.perDay, 1, 50) || !count(limits?.followUps, 0, 5)) throw new Error('limits: {perDay 1–50 messages a day, followUps 0–5 per investor}');
  if (!Number.isFinite(minCheck) || minCheck < 0) throw new Error('minCheck: the smallest check accepted (0 for none)');
  return Object.freeze({
    id: id('m'), amount, currency, instrument,
    valuation: Object.freeze({ low: v.low, high: v.high, basis: clean(v.basis, 600) }),
    useOfFunds: clean(useOfFunds, 1000),
    route: Object.freeze({ kind: route.kind, jurisdiction: clean(route.jurisdiction, 80) }),
    limits: Object.freeze({ perDay: limits.perDay, followUps: limits.followUps }),
    minCheck, by, draftedAt: now,
  });
};

/**
 * The operator's signature on a draft, judged: the receiving account they
 * enter, and their word that counsel chose the route. pure.
 * @param {?object} state - foldRaise's
 * @param {{mandateId: unknown, account: unknown, counselChoseRoute: unknown, now: string}} sign
 * @returns {{ok: true, event: object} | {ok: false, reason: string}}
 */
export const judgeSign = (state, { mandateId, account, counselChoseRoute, now }) => {
  if (!state?.draft || state.draft.id !== mandateId) return { ok: false, reason: 'sign the mandate on screen — its draft has changed or is gone' };
  if (counselChoseRoute !== true) return { ok: false, reason: 'counsel chooses the legal route before a mandate is signed — confirm they have' };
  const a = account ?? {};
  if (a.kind === 'wallet') {
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(a.address))) return { ok: false, reason: 'the receiving wallet is a 0x address' };
    return { ok: true, event: { type: 'signed', id: mandateId, account: { kind: 'wallet', address: a.address, network: clean(a.network, 30) || 'ethereum' }, by: 'operator', at: now } };
  }
  if (a.kind === 'bank') {
    if (clean(a.bankName, 80).length < 2 || clean(a.accountName, 120).length < 2 || clean(a.details, 200).length < 6) return { ok: false, reason: 'the receiving bank needs its name, the account\'s name, and the wire details' };
    return { ok: true, event: { type: 'signed', id: mandateId, account: { kind: 'bank', bankName: clean(a.bankName, 80), accountName: clean(a.accountName, 120), details: clean(a.details, 200) }, by: 'operator', at: now } };
  }
  if (a.kind === 'portal') {
    try {
      if (new URL(a.url).protocol !== 'https:' || clean(a.portal, 80).length < 2) throw new Error('bad');
    } catch {
      return { ok: false, reason: 'a funding portal needs its name and its https link' };
    }
    return { ok: true, event: { type: 'signed', id: mandateId, account: { kind: 'portal', portal: clean(a.portal, 80), url: a.url }, by: 'operator', at: now } };
  }
  return { ok: false, reason: 'the receiving account is a wallet, a bank, or a registered funding portal' };
};

/** The Numerarius's facts sheet, or a thrown reason. Pure but for its id. */
export const makeFactsSheet = ({ facts, dataRoom, by, now }) => {
  const list = Array.isArray(facts) ? facts : [];
  if (list.length < 3) throw new Error('facts: at least three — what an investor may be told, each sourced');
  const problems = list.flatMap((f, i) => [
    ...(clean(f?.claim, 400).length < 10 ? [`facts[${i}].claim: state the fact`] : []),
    ...(f?.figure != null && !(Number.isFinite(f.figure.value) && clean(f.figure.unit, 16)) ? [`facts[${i}].figure: {value, unit}, or leave it out`] : []),
    ...(!isSource(f?.source) ? [`facts[${i}].source: ${SOURCE_WORDS}`] : []),
  ]);
  if (problems.length) throw new Error(problems.slice(0, 8).join('; '));
  return Object.freeze({
    id: id('f'),
    facts: Object.freeze(list.map((f, i) => Object.freeze({
      n: i + 1, claim: clean(f.claim, 400), figure: f.figure ? Object.freeze({ value: f.figure.value, unit: clean(f.figure.unit, 16) }) : null,
      source: clean(f.source, 300), forwardLooking: f.forwardLooking === true,
    }))),
    dataRoom: Object.freeze((Array.isArray(dataRoom) ? dataRoom : []).map((r) => clean(r, 300)).filter(isSource)),
    by, filedAt: now,
  });
};

/** Counsel's review of the latest sheet, as the operator records it. pure. */
export const judgeReview = (state, { sheetId, verdict, note, now }) => {
  if (!state?.sheet || state.sheet.id !== sheetId) return { ok: false, reason: 'review the facts sheet on screen — a newer one was filed, or none' };
  if (!['approved', 'returned'].includes(verdict)) return { ok: false, reason: 'counsel\'s verdict is approved or returned' };
  const n = clean(note, 600);
  if (verdict === 'returned' && n.length < 5) return { ok: false, reason: 'say what counsel wants changed' };
  return { ok: true, event: { type: 'reviewed', sheetId, verdict, note: n || null, by: 'operator', at: now } };
};

/**
 * The raise as it stands. The account rides the state for the system's own
 * use (filling an ask's payment line); a reader for a being never sees it. pure.
 * @param {Array<object>} events
 */
export const foldRaise = (events) => events.reduce((s, e) => {
  if (e?.type === 'mandate' && e.mandate?.id) return { ...s, draft: e.mandate };
  if (e?.type === 'signed' && s.draft?.id === e.id) return { ...s, mandate: s.draft, account: e.account, status: 'active', signedAt: e.at };
  if (e?.type === 'paused' && s.status === 'active') return { ...s, status: 'paused' };
  if (e?.type === 'resumed' && s.status === 'paused') return { ...s, status: 'active' };
  if (e?.type === 'closed' && ['active', 'paused'].includes(s.status)) return { ...s, status: 'closed' };
  if (e?.type === 'facts' && e.sheet?.id) return { ...s, sheet: e.sheet, review: null };
  if (e?.type === 'reviewed' && s.sheet?.id === e.sheetId) return { ...s, review: { verdict: e.verdict, note: e.note, at: e.at }, approved: e.verdict === 'approved' ? s.sheet : s.approved };
  if (e?.type === 'investor' && e.investor?.id && !s.investors.some((i) => i.id === e.investor.id)) {
    return { ...s, investors: [...s.investors, { ...e.investor, status: 'listed', note: null, thread: [] }] };
  }
  const who = INVESTOR_EVENTS.includes(e?.type) && s.investors.find((i) => i.id === e.id);
  if (who) {
    const next = e.type === 'cleared' ? { status: e.verdict === 'cleared' ? 'cleared' : 'refused', note: e.note }
      : e.type === 'reach' ? { status: who.status === 'interested' ? 'interested' : 'contacted', thread: [...who.thread, { to: e.to, subject: e.subject, text: e.text, messageId: e.messageId, by: e.by, at: e.at }] }
        : e.type === 'terms' ? { status: 'terms', terms: { amount: e.amount, valuation: e.valuation, notes: e.notes, at: e.at }, note: null }
          : e.type === 'terms-check' ? { status: e.verdict === 'sound' ? 'sound' : 'interested', note: e.note }
            : e.type === 'closed-in' ? { status: 'closed', closed: { amount: e.amount, received: e.received, at: e.at } }
              : { status: e.status, note: e.note };
    return { ...s, investors: s.investors.map((i) => (i === who ? { ...i, ...next } : i)) };
  }
  return { ...s, skipped: s.skipped + 1 };
}, { draft: null, mandate: null, account: null, status: 'none', signedAt: null, sheet: null, review: null, approved: null, investors: [], skipped: 0 });

const INVESTOR_EVENTS = Object.freeze(['cleared', 'reach', 'update', 'terms', 'terms-check', 'closed-in']);
const DOLLARS = Object.freeze(['USD', 'USDC', 'USDT', 'DAI']);

/** What the raise has closed, and what is promised in terms not yet closed. pure. */
export const raised = (state) => ({
  closed: state.investors.filter((i) => i.status === 'closed').reduce((n, i) => n + i.closed.amount, 0),
  promised: state.investors.filter((i) => ['terms', 'sound'].includes(i.status)).reduce((n, i) => n + i.terms.amount, 0),
});

/**
 * The Quaestor's terms with one interested investor, judged inside the signed
 * mandate: its instrument, its valuation range, its smallest check, and never
 * past the amount the mandate seeks. pure.
 */
export const judgeTerms = (state, { investorId, amount, valuation, notes, by, now }) => {
  if (state.status !== 'active') return { ok: false, reason: `the mandate is ${state.status === 'none' ? 'not signed' : state.status} — no terms are agreed` };
  const i = state.investors.find((x) => x.id === investorId);
  if (!i) return { ok: false, reason: 'no such investor on this raise\'s list' };
  if (i.status !== 'interested') return { ok: false, reason: `${i.name} is ${i.status} — terms are agreed with an interested investor` };
  const m = state.mandate;
  if (!Number.isFinite(amount) || amount < m.minCheck) return { ok: false, reason: `amount: at least the mandate's smallest check, ${m.minCheck} ${m.currency}` };
  const { closed, promised } = raised(state);
  if (closed + promised + amount > m.amount) return { ok: false, reason: `the mandate seeks ${m.amount} ${m.currency}; ${closed + promised} is closed or promised — at most ${m.amount - closed - promised} remains` };
  if (!Number.isFinite(valuation) || valuation < m.valuation.low || valuation > m.valuation.high) return { ok: false, reason: `valuation: inside the mandate's range, ${m.valuation.low}–${m.valuation.high}` };
  return { ok: true, event: { type: 'terms', id: investorId, amount, valuation, notes: clean(notes, 600) || null, by, at: now } };
};

/** The Praetor's word on the terms: sound, or returned with why. pure. */
export const judgeTermsCheck = (state, { investorId, verdict, note, by, now }) => {
  const i = state.investors.find((x) => x.id === investorId);
  if (!i || i.status !== 'terms') return { ok: false, reason: 'no terms wait on this investor' };
  if (!['sound', 'returned'].includes(verdict)) return { ok: false, reason: 'the terms are sound, or returned' };
  const n = clean(note, 400);
  if (verdict === 'returned' && n.length < 5) return { ok: false, reason: 'say what is wrong with the terms' };
  return { ok: true, event: { type: 'terms-check', id: investorId, verdict, note: n || null, by, at: now } };
};

/**
 * The close, as only the operator signs it: the papers signed, accreditation
 * verified on a 506(c) route, and the money landed where the mandate says —
 * for a wallet, a receipt the house's money-in ledger holds AT the mandate's
 * own address, for at least the agreed amount (the Praefectus's check); for a
 * bank or a portal, the operator's word with its reference. pure.
 * @param {object} state
 * @param {{investorId: string, signedPapers: unknown, accreditedVerified: unknown, receipt: ?object, reference: unknown, now: string}} close
 */
export const judgeCloseInvestor = (state, { investorId, signedPapers, accreditedVerified, receipt, reference, now }) => {
  const i = state.investors.find((x) => x.id === investorId);
  if (!i || i.status !== 'sound') return { ok: false, reason: 'only an investor whose terms the Praetor found sound is closed' };
  if (signedPapers !== true) return { ok: false, reason: 'the papers are signed before a close' };
  if (state.mandate.route.kind === '506c' && accreditedVerified !== true) return { ok: false, reason: 'a 506(c) close needs the investor verified accredited' };
  const a = state.account;
  if (a.kind === 'wallet') {
    if (!receipt) return { ok: false, reason: 'no such receipt in the house\'s money-in ledger — the money has not landed' };
    if (state.investors.some((x) => x.closed?.received?.ref === receipt.key)) return { ok: false, reason: 'that receipt already closed another investor — one receipt, one close' };
    if (String(receipt.to).toLowerCase() !== String(a.address).toLowerCase() || receipt.network !== a.network) {
      return { ok: false, reason: `that receipt landed at ${receipt.to} on ${receipt.network}, not the mandate's ${a.address} on ${a.network}` };
    }
    const sameMoney = receipt.asset === state.mandate.currency || (DOLLARS.includes(state.mandate.currency) && DOLLARS.includes(receipt.asset));
    if (!sameMoney || Number(receipt.amount) < i.terms.amount) return { ok: false, reason: `the receipt holds ${receipt.amount} ${receipt.asset}; the terms are ${i.terms.amount} ${state.mandate.currency}` };
    return { ok: true, event: { type: 'closed-in', id: investorId, amount: i.terms.amount, received: { kind: 'money-in', ref: receipt.key }, by: 'operator', at: now } };
  }
  const ref = clean(reference, 200);
  if (ref.length < 5) return { ok: false, reason: `the ${a.kind === 'bank' ? 'wire' : 'portal'} reference the money arrived under` };
  return { ok: true, event: { type: 'closed-in', id: investorId, amount: i.terms.amount, received: { kind: a.kind, ref }, by: 'operator', at: now } };
};

/** One investor the Speculator lists, or a thrown reason. Pure but for its id. */
export const makeInvestor = ({ name, firm, email, thesis, why, relationship, by, now }) => {
  if (clean(name, 120).length < 2) throw new Error('name the investor');
  if (!EMAIL_ADDRESS_PATTERN.test(String(email ?? ''))) throw new Error('email: the address the house would write to');
  if (clean(thesis, 400).length < 10) throw new Error('thesis: what they invest in, from their own published words');
  if (clean(why, 400).length < 10) throw new Error('why: why this company fits them');
  return Object.freeze({
    id: id('i'), name: clean(name, 120), firm: clean(firm, 120) || null, email: String(email), thesis: clean(thesis, 400), why: clean(why, 400),
    relationship: clean(relationship, 400) || null, by, listedAt: now,
  });
};

/** The Praetor's word on whether the route allows asking this investor. pure. */
export const judgeClear = (state, { investorId, verdict, note, by, now }) => {
  const i = state.investors.find((x) => x.id === investorId);
  if (!i) return { ok: false, reason: 'no such investor on this raise\'s list' };
  if (i.status !== 'listed') return { ok: false, reason: `this investor is already ${i.status}` };
  if (!['cleared', 'refused'].includes(verdict)) return { ok: false, reason: 'the Praetor clears or refuses' };
  const n = clean(note, 400);
  if (verdict === 'refused' && n.length < 5) return { ok: false, reason: 'say why the route does not allow it' };
  if (verdict === 'cleared' && state.mandate?.route.kind === '506b' && !i.relationship) {
    return { ok: false, reason: 'a 506(b) offering may only ask those the company already knows — the listing names no prior relationship' };
  }
  return { ok: true, event: { type: 'cleared', id: investorId, verdict, note: n || null, by, at: now } };
};

/**
 * May the house write to this investor now? The mandate active, the facts
 * approved, the investor cleared and not declined, the day's pace and the
 * thread's follow-ups inside the mandate's limits. pure.
 */
export const judgeReach = (state, { investorId, now }) => {
  if (state.status !== 'active') return { ok: false, reason: `the mandate is ${state.status === 'none' ? 'not signed' : state.status} — no investor is written to` };
  if (!state.approved) return { ok: false, reason: 'counsel has not approved a facts sheet — no investor is written to' };
  const i = state.investors.find((x) => x.id === investorId);
  if (!i) return { ok: false, reason: 'no such investor on this raise\'s list' };
  if (i.status === 'declined') return { ok: false, reason: `${i.name} declined — a clear no ends the thread (MAKOTO)` };
  if (!['cleared', 'contacted', 'interested'].includes(i.status)) return { ok: false, reason: `${i.name} is ${i.status} — only an investor the Praetor cleared is written to` };
  if (i.thread.length > state.mandate.limits.followUps) return { ok: false, reason: `the mandate allows ${state.mandate.limits.followUps} follow-ups after the first message — wait for ${i.name} to answer` };
  const today = String(now).slice(0, 10);
  const sentToday = state.investors.flatMap((x) => x.thread).filter((m) => String(m.at).slice(0, 10) === today).length;
  if (sentToday >= state.mandate.limits.perDay) return { ok: false, reason: `the mandate's pace is ${state.mandate.limits.perDay} messages a day — today's are sent` };
  return { ok: true, investor: i };
};

/** The Mercator's word on where an investor stands after their answer. pure. */
export const judgeUpdate = (state, { investorId, status, note, by, now }) => {
  const i = state.investors.find((x) => x.id === investorId);
  if (!i) return { ok: false, reason: 'no such investor on this raise\'s list' };
  if (!['interested', 'declined'].includes(status)) return { ok: false, reason: 'an investor is interested or declined' };
  if (clean(note, 400).length < 5) return { ok: false, reason: 'note: what they said' };
  return { ok: true, event: { type: 'update', id: investorId, status, note: clean(note, 400), by, at: now } };
};

/** What the house's beings may read of a raise: everything but the receiving account. pure. */
export const raiseForBeings = (state) => {
  const { account, ...rest } = state;
  return { ...rest, account: account ? { kind: account.kind } : null };
};
