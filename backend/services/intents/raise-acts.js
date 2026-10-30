/**
 * raise/* — the raise room's filed acts, the foundation slice (Design note, 2026-10-29:
 * a house […]):
 * `raise/mandate` — the Quaestor drafts the mandate (no payment details: the
 * operator enters the receiving account when they sign it); `raise/facts` —
 * the Numerarius files the facts sheet, every figure sourced, for counsel's
 * one review. A raise is for a STANDING company — a share of a company that
 * does not exist yet is not sold.
 *
 * THE SEAT LAW: each act is its stage's master's (company-line/stage-holders.js:
 * the seat's office, else the founding seat). Tier `allowed`: a draft in the
 * company's own record — nothing leaves the house, and the operator signs.
 */
import { seatHolders } from '../company-line/stage-holders.js';
import { readCompany, readLine } from '../company-line/company-store.js';
import { makeMandate, makeFactsSheet, makeInvestor, judgeClear, judgeReach, judgeUpdate, judgeTerms, judgeTermsCheck } from '../raise/raise-shape.js';
import { applyRaise, readRaise, reachUnderChain } from '../raise/raise-store.js';
import { checkMessage, paymentLine, PAYMENT_PLACEHOLDER } from '../raise/facts-gate.js';
import { mailboxFor, sendThrough } from '../raise/raise-mailbox.js';
import { announceRaise } from '../raise/raise-notices.js';
import { checkOutboundSecrets } from '../security/outbound-secrets.js';

// impure — the filer as the holder of `seat` in its own house, and the standing company named; or the refusal.
const raiseContext = async (connection, seat, companyId) => {
  const laneId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!laneId || !wallet) return { refusal: { ok: false, status: 'denied', reason: 'the raise room is open to its operator\'s own house' } };
  if ((await seatHolders(wallet))[seat] !== laneId) {
    return { refusal: { ok: false, status: 'denied', reason: `this is the ${seat}'s act in the raise room — pass your part to them by house post` } };
  }
  const company = await readCompany(wallet, String(companyId ?? '').trim()).catch(() => null);
  if (!company) return { refusal: { ok: false, status: 'invalid', reason: `"${companyId ?? ''}" is not a company of this house` } };
  if ((await readLine(wallet, company.id)).status !== 'standing') {
    return { refusal: { ok: false, status: 'denied', reason: `${company.name} is still on its founding line — a raise sells a share of a company that stands` } };
  }
  return { laneId, wallet, company };
};

const advertisedTo = (seat) => async ({ connection }) => {
  const wallet = connection.walletAddress;
  return wallet && (await seatHolders(wallet).catch(() => ({})))[seat] === connection.companion?.neumaId ? {} : null;
};

export const raiseMandateIntent = Object.freeze({
  name: 'raise/mandate',
  policyTool: 'raise.mandate',
  fieldsForPrompt: '{company, amount, currency, instrument: safe|priced|convertible, valuation: {low, high, basis}, useOfFunds, route: {kind: 506c|506b|reg-cf|other, jurisdiction}, limits: {perDay, followUps}, minCheck}',
  descriptionForPrompt: 'THE RAISE ROOM (the Quaestor). Draft the mandate for a standing company: how much, the instrument, the valuation range and how you reached it (cite the model and the comparables), what the money will do, the legal route counsel chose, outreach limits, the smallest check. Never put payment details in it — the operator enters the receiving account when they sign. Nothing is asked of any investor until the operator signs and counsel has reviewed the facts sheet.',
  availableFor: advertisedTo('Quaestor'),
  validate: async (payload, { connection }) => {
    const context = await raiseContext(connection, 'Quaestor', payload?.company);
    if (context.refusal) return context.refusal;
    const secret = checkOutboundSecrets('the mandate', [payload?.useOfFunds, payload?.valuation?.basis], 'nothing was drafted');
    if (!secret.ok) return { ok: false, status: 'denied', reason: secret.reason };
    try {
      return { ok: true, value: { ...context, mandate: makeMandate({ ...payload, by: context.laneId, now: new Date().toISOString() }) } };
    } catch (err) {
      return { ok: false, status: 'invalid', reason: err.message };
    }
  },
  summarize: (payload) => `draft a raise mandate: ${payload?.amount ?? '?'} ${payload?.currency ?? ''} (${payload?.instrument ?? '?'})`,
  execute: async ({ wallet, company, mandate }) => {
    const filed = await applyRaise(wallet, company.id, () => ({ ok: true, event: { type: 'mandate', mandate, at: mandate.draftedAt } }));
    await announceRaise({ wallet, company, title: `${company.name}: the raise mandate waits for your signature`, detail: `${mandate.amount} ${mandate.currency} by ${mandate.instrument}, ${mandate.route.kind} in ${mandate.route.jurisdiction}`, by: mandate.by, ref: { mandateId: mandate.id } });
    return filed.ok ? { ok: true, detail: `Mandate [${mandate.id}] drafted for ${company.name}; it waits for the operator's signature.` } : { ok: false, reason: filed.reason };
  },
});

export const raiseFactsIntent = Object.freeze({
  name: 'raise/facts',
  policyTool: 'raise.facts',
  fieldsForPrompt: '{company, facts: [{claim, figure?: {value, unit}, source, forwardLooking?}], dataRoom?: [repos/… or https]}',
  descriptionForPrompt: 'THE RAISE ROOM (the Numerarius). File the facts sheet for a standing company: everything an investor may be told, each fact with its source (a ledger, the books, a document), each forward-looking line marked forwardLooking: true. Counsel reviews it once; an outbound message may carry no figure the reviewed sheet does not hold.',
  availableFor: advertisedTo('Numerarius'),
  validate: async (payload, { connection }) => {
    const context = await raiseContext(connection, 'Numerarius', payload?.company);
    if (context.refusal) return context.refusal;
    const secret = checkOutboundSecrets('the facts sheet', (Array.isArray(payload?.facts) ? payload.facts : []).map((f) => f?.claim), 'nothing was filed');
    if (!secret.ok) return { ok: false, status: 'denied', reason: secret.reason };
    try {
      return { ok: true, value: { ...context, sheet: makeFactsSheet({ ...payload, by: context.laneId, now: new Date().toISOString() }) } };
    } catch (err) {
      return { ok: false, status: 'invalid', reason: err.message };
    }
  },
  summarize: (payload) => `file a facts sheet (${Array.isArray(payload?.facts) ? payload.facts.length : 0} facts)`,
  execute: async ({ wallet, company, sheet }) => {
    const filed = await applyRaise(wallet, company.id, () => ({ ok: true, event: { type: 'facts', sheet, at: sheet.filedAt } }));
    await announceRaise({ wallet, company, title: `${company.name}: the facts sheet waits for counsel's review`, detail: `${sheet.facts.length} facts, ${sheet.facts.filter((f) => f.forwardLooking).length} forward-looking`, by: sheet.by, ref: { sheetId: sheet.id } });
    return filed.ok ? { ok: true, detail: `Facts sheet [${sheet.id}] filed for ${company.name}; counsel reviews it before any investor is asked.` } : { ok: false, reason: filed.reason };
  },
});

const now = () => new Date().toISOString();

// One outreach act: the seat's context, then the act's own judgment of the raise as it stands.
const outreach = (seat, judge) => async (payload, { connection }) => {
  const context = await raiseContext(connection, seat, payload?.company);
  if (context.refusal) return context.refusal;
  try {
    const judged = await judge(payload, context, await readRaise(context.wallet, context.company.id));
    return judged.ok ? { ok: true, value: { ...context, ...judged } } : { ok: false, status: judged.status ?? 'invalid', reason: judged.reason };
  } catch (err) {
    return { ok: false, status: 'invalid', reason: err.message };
  }
};

const landed = (filed, detail) => (filed.ok ? { ok: true, detail } : { ok: false, reason: filed.reason });

export const raiseInvestorIntent = Object.freeze({
  name: 'raise/investor',
  policyTool: 'raise.investor',
  fieldsForPrompt: '{company, name, email, thesis, why, firm?, relationship?}',
  descriptionForPrompt: 'THE RAISE ROOM (the Speculator). List an investor who fits: their thesis from their own published words, why this company fits them, the address to write to, and — for a 506(b) offering — the company\'s prior relationship with them. The Praetor clears each one under the route before anyone writes.',
  availableFor: advertisedTo('Speculator'),
  validate: outreach('Speculator', async (payload, { laneId }) => ({ ok: true, investor: makeInvestor({ ...payload, by: laneId, now: now() }) })),
  summarize: (payload) => `list investor ${String(payload?.name ?? '?').slice(0, 60)}`,
  execute: async ({ wallet, company, investor }) => landed(await applyRaise(wallet, company.id, () => ({ ok: true, event: { type: 'investor', investor, at: investor.listedAt } })),
    `Listed [${investor.id}] ${investor.name}; the Praetor clears them under the route before anyone writes.`),
});

export const raiseClearIntent = Object.freeze({
  name: 'raise/clear',
  policyTool: 'raise.clear',
  fieldsForPrompt: '{company, investor, verdict: cleared|refused, note?}',
  descriptionForPrompt: 'THE RAISE ROOM (the Praetor). Clear a listed investor under the mandate\'s legal route, or refuse with why: a 506(b) offering asks only those the company already knows; a 506(c) offering asks anyone, and every investor is verified accredited before the close.',
  availableFor: advertisedTo('Praetor'),
  validate: outreach('Praetor', async (payload, { laneId }, state) => {
    const judged = judgeClear(state, { investorId: payload?.investor, verdict: payload?.verdict, note: payload?.note, by: laneId, now: now() });
    return judged.ok ? { ok: true, event: judged.event } : judged;
  }),
  summarize: (payload) => `${payload?.verdict ?? '?'} investor ${payload?.investor ?? '?'}`,
  execute: async ({ wallet, company, event }) => landed(await applyRaise(wallet, company.id, (state) => judgeClear(state, { investorId: event.id, verdict: event.verdict, note: event.note, by: event.by, now: event.at })),
    `Investor [${event.id}] ${event.verdict}.`),
});

export const raiseReachIntent = Object.freeze({
  name: 'raise/reach',
  policyTool: 'raise.reach',
  fieldsForPrompt: '{company, investor, subject, body}',
  descriptionForPrompt: `THE RAISE ROOM (the Mercator). Write to a cleared investor through the house mailbox, the MAKOTO way. The facts gate reads every message first: every figure must stand on the facts sheet counsel approved or in the signed mandate; every forward-looking sentence is marked "(forward-looking)"; the disclosure line rides word for word ("We are a team of AI agents building <company>; we work under <company> and its human operator, who reviews and signs everything."); no payment detail — write ${PAYMENT_PLACEHOLDER} and the platform fills the mandate's own; no false urgency. The mandate's pace and follow-ups hold; a declined investor is never written to again.`,
  availableFor: advertisedTo('Mercator'),
  validate: outreach('Mercator', async (payload, { laneId, company }, state) => {
    const subject = String(payload?.subject ?? '').trim();
    const body = String(payload?.body ?? '').trim();
    if (!subject || body.length < 40) return { ok: false, reason: 'a message needs a subject and a body' };
    const pace = judgeReach(state, { investorId: payload?.investor, now: now() });
    if (!pace.ok) return { ok: false, status: 'denied', reason: pace.reason };
    const gate = checkMessage({ subject, body, sheet: state.approved, mandate: state.mandate, companyName: company.name });
    if (!gate.ok) return { ok: false, reason: `the facts gate holds this message — ${gate.problems.slice(0, 8).join('; ')}` };
    const secret = checkOutboundSecrets('the message', [subject, body], 'nothing was sent');
    if (!secret.ok) return { ok: false, status: 'denied', reason: secret.reason };
    const mailbox = await mailboxFor(laneId);
    if (mailbox.refusal) return { ok: false, status: 'denied', reason: mailbox.refusal };
    return { ok: true, investorId: payload.investor, subject, body, credentials: mailbox.credentials };
  }),
  summarize: (payload) => `write to investor ${payload?.investor ?? '?'}: "${String(payload?.subject ?? '').slice(0, 60)}"`,
  execute: async ({ wallet, company, laneId, investorId, subject, body, credentials }, { signal } = {}) => {
    const reached = await reachUnderChain(wallet, company.id, { investorId, subject, body, by: laneId, now: now() },
      (investor, account) => sendThrough(credentials, { to: investor.email, subject, text: body.replace(PAYMENT_PLACEHOLDER, paymentLine(account)) }, signal));
    return reached.ok ? { ok: true, detail: `Sent to ${reached.event.to} — kept in the investor's thread.` } : { ok: false, reason: reached.reason };
  },
});

export const raiseUpdateIntent = Object.freeze({
  name: 'raise/update',
  policyTool: 'raise.update',
  fieldsForPrompt: '{company, investor, status: interested|declined, note}',
  descriptionForPrompt: 'THE RAISE ROOM (the Mercator). Record where an investor stands after their answer: interested, or declined (a clear no ends the thread — the house never writes to them again). note: what they said.',
  availableFor: advertisedTo('Mercator'),
  validate: outreach('Mercator', async (payload, { laneId }, state) => {
    const judged = judgeUpdate(state, { investorId: payload?.investor, status: payload?.status, note: payload?.note, by: laneId, now: now() });
    return judged.ok ? { ok: true, event: judged.event } : judged;
  }),
  summarize: (payload) => `investor ${payload?.investor ?? '?'} → ${payload?.status ?? '?'}`,
  execute: async ({ wallet, company, event }) => landed(await applyRaise(wallet, company.id, () => ({ ok: true, event })), `Investor [${event.id}] is ${event.status}.`),
});

export const raiseTermsIntent = Object.freeze({
  name: 'raise/terms',
  policyTool: 'raise.terms',
  fieldsForPrompt: '{company, investor, amount, valuation, notes?}',
  descriptionForPrompt: 'THE RAISE ROOM (the Quaestor). Record the terms agreed with an interested investor, inside the signed mandate: its instrument, a valuation within its range, at least its smallest check, never past what it seeks. The Praetor checks them; the operator signs the close.',
  availableFor: advertisedTo('Quaestor'),
  validate: outreach('Quaestor', async (payload, { laneId }, state) => judgeTerms(state, { investorId: payload?.investor, amount: payload?.amount, valuation: payload?.valuation, notes: payload?.notes, by: laneId, now: now() })),
  summarize: (payload) => `terms with ${payload?.investor ?? '?'}: ${payload?.amount ?? '?'} at ${payload?.valuation ?? '?'}`,
  execute: async ({ wallet, company, event }) => landed(await applyRaise(wallet, company.id, (state) => judgeTerms(state, { investorId: event.id, amount: event.amount, valuation: event.valuation, notes: event.notes, by: event.by, now: event.at })),
    `Terms recorded with [${event.id}]: ${event.amount} at a ${event.valuation} valuation; the Praetor checks them next.`),
});

export const raiseTermsCheckIntent = Object.freeze({
  name: 'raise/terms-check',
  policyTool: 'raise.terms-check',
  fieldsForPrompt: '{company, investor, verdict: sound|returned, note?}',
  descriptionForPrompt: 'THE RAISE ROOM (the Praetor). Check the terms the Quaestor recorded: sound (the close then waits for the operator\'s signature) or returned with what is wrong.',
  availableFor: advertisedTo('Praetor'),
  validate: outreach('Praetor', async (payload, { laneId }, state) => judgeTermsCheck(state, { investorId: payload?.investor, verdict: payload?.verdict, note: payload?.note, by: laneId, now: now() })),
  summarize: (payload) => `terms of ${payload?.investor ?? '?'} → ${payload?.verdict ?? '?'}`,
  execute: async ({ wallet, company, event }) => {
    const filed = await applyRaise(wallet, company.id, (state) => judgeTermsCheck(state, { investorId: event.id, verdict: event.verdict, note: event.note, by: event.by, now: event.at }));
    if (filed.ok && event.verdict === 'sound') {
      const inv = filed.state.investors.find((i) => i.id === event.id);
      await announceRaise({ wallet, company, title: `${company.name}: ${inv.name}'s close waits for your signature`, detail: `${inv.terms.amount} at a ${inv.terms.valuation} valuation — the terms are sound`, by: event.by, ref: { investorId: event.id } });
    }
    return landed(filed, `The terms of [${event.id}] are ${event.verdict}.`);
  },
});

export const raiseIntents = Object.freeze([raiseMandateIntent, raiseFactsIntent, raiseInvestorIntent, raiseClearIntent, raiseReachIntent, raiseUpdateIntent, raiseTermsIntent, raiseTermsCheckIntent]);
