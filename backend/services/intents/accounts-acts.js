/**
 * accounts/* — the Logista office's filed acts (the sixteenth seat, Founder
 * 2026-10-29): `accounts/book` records one entry in a company's books — from a
 * receipt the house holds (its figures taken from the receipt) or, for money
 * with no receipt here, by hand with its source; `accounts/void` withdraws a
 * wrong entry with why; `accounts/deadline` sets a tax or filing date with its
 * source and whether a licensed CPA must sign; `accounts/deadline-met` closes one.
 *
 * THE OFFICE LAW: every validate re-verifies that the filing lane IS the
 * house's seated Logista — and is NOT its seated Quaestor (TREASURY is not
 * ACCOUNTS: whoever approves money never keeps its books). Tier `allowed`
 * (tool-policy-defaults.js): records in the company's own books, no money moves.
 */
import { caoDesignation } from '../accounts/cao-designation.js';
import { cfoDesignation } from '../treasury/cfo-designation.js';
import { makeEntry, makeDeadline } from '../accounts/books-shape.js';
import { bookEntry, voidEntry, setDeadline, meetDeadline } from '../accounts/books-store.js';
import { houseReceipts, matchedFigures } from '../accounts/house-receipts.js';
import { readCompany } from '../company-line/company-store.js';

const officerRefusal = { ok: false, status: 'denied', reason: 'the books are the Logista office\'s — only the seated Logista keeps them (house/post reaches them; the operator seats the office)' };
const splitRefusal = { ok: false, status: 'denied', reason: 'you hold the Quaestor\'s seat too — whoever approves money never keeps its books (TREASURY is not ACCOUNTS); the operator must seat another being as Logista' };

// impure — the filing lane, when it is this house's seated Logista and not its Quaestor; or the refusal.
const officeContext = async (connection) => {
  const laneId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!laneId || !wallet) return { refusal: officerRefusal };
  const [cao, cfo] = await Promise.all([caoDesignation.getOfficer(wallet).catch(() => null), cfoDesignation.getOfficer(wallet).catch(() => null)]);
  if (cao?.laneId !== laneId) return { refusal: officerRefusal };
  if (cfo?.laneId === laneId) return { refusal: splitRefusal };
  return { laneId, wallet };
};

// impure — the company named, or the refusal.
const companyOf = async (wallet, id) => {
  const company = await readCompany(wallet, String(id ?? '').trim()).catch(() => null);
  return company ? { company } : { refusal: { ok: false, status: 'invalid', reason: `"${id ?? ''}" is not a company of this house — the LOGISTA OFFICE briefing names each by its [id]` } };
};

const available = async ({ connection }) => ((await officeContext(connection).catch(() => ({}))).laneId ? {} : null);
const now = () => new Date().toISOString();

// One act's validate: the office, the company, then the act's own shape.
const office = (shape) => async (payload, { connection }) => {
  const context = await officeContext(connection).catch(() => ({ refusal: officerRefusal }));
  if (context.refusal) return context.refusal;
  const { company, refusal } = await companyOf(context.wallet, payload?.company);
  if (refusal) return refusal;
  try {
    return { ok: true, value: { ...context, company, ...(await shape(payload, context)) } };
  } catch (err) {
    return { ok: false, status: 'invalid', reason: err.message };
  }
};

const settled = (result, detail) => (result.ok ? { ok: true, detail } : { ok: false, reason: result.reason });

export const accountsBookIntent = Object.freeze({
  name: 'accounts/book',
  policyTool: 'accounts.book',
  fieldsForPrompt: '{company, receipt: {kind: money-in|spend, ref} | {kind: manual, direction: in|out, amount, currency, date, source}, category, memo}',
  descriptionForPrompt: 'THE LOGISTA OFFICE. Book one entry in a company\'s books. From a receipt the house holds (the unbooked ones are listed in your briefing by ref) the figures come from the receipt itself; money with no receipt here is booked by hand with its source and stands unmatched. category: revenue, investment, cost-of-sales, compute, software, fees, taxes, contractors, other. A receipt is booked once in the whole house.',
  availableFor: available,
  validate: office(async (payload, { laneId, wallet }) => {
    const receipt = payload?.receipt ?? {};
    const matched = receipt.kind === 'manual' ? null : matchedFigures(await houseReceipts(wallet), receipt.kind, receipt.ref);
    return { entry: makeEntry({ receipt, matched, category: payload?.category, memo: payload?.memo, by: laneId, now: now() }) };
  }),
  summarize: (payload) => `book ${payload?.receipt?.kind ?? '?'} ${payload?.receipt?.ref ?? payload?.receipt?.amount ?? ''} in ${payload?.company ?? '?'}`,
  execute: async ({ wallet, company, entry }) => settled(await bookEntry(wallet, company.id, entry),
    `Booked [${entry.id}]: ${entry.direction} ${entry.amount} ${entry.currency} (${entry.category}) in ${company.name}'s books${entry.receipt.kind === 'manual' ? ' — unmatched until a receipt backs it' : ''}.`),
});

export const accountsVoidIntent = Object.freeze({
  name: 'accounts/void',
  policyTool: 'accounts.void',
  fieldsForPrompt: '{company, id, reason}',
  descriptionForPrompt: 'THE LOGISTA OFFICE. Void a wrong entry (it is never edited): reason says what was wrong. Book it again if it belongs.',
  availableFor: available,
  validate: office(async (payload) => {
    const reason = String(payload?.reason ?? '').trim();
    if (reason.length < 5) throw new Error('reason: what was wrong with the entry');
    return { entryId: String(payload?.id ?? '').trim(), reason };
  }),
  summarize: (payload) => `void ${payload?.id ?? '?'} in ${payload?.company ?? '?'}`,
  execute: async ({ wallet, company, entryId, reason, laneId }) => settled(await voidEntry(wallet, company.id, entryId, { reason, by: laneId, at: now() }), `Voided [${entryId}] in ${company.name}'s books.`),
});

export const accountsDeadlineIntent = Object.freeze({
  name: 'accounts/deadline',
  policyTool: 'accounts.deadline',
  fieldsForPrompt: '{company, what, due, authority, source, needsCpa?}',
  descriptionForPrompt: 'THE LOGISTA OFFICE. Set a tax or filing deadline: what falls due, the date, who it is owed to, the source the date comes from, and needsCpa: true when a licensed CPA must sign — then ask the operator for one with company/hands.',
  availableFor: available,
  validate: office(async (payload, { laneId }) => ({ deadline: makeDeadline({ ...payload, by: laneId, now: now() }) })),
  summarize: (payload) => `deadline "${String(payload?.what ?? '').slice(0, 60)}" due ${payload?.due ?? '?'}`,
  execute: async ({ wallet, company, deadline }) => settled(await setDeadline(wallet, company.id, deadline), `Deadline [${deadline.id}] set: ${deadline.what}, due ${deadline.due}${deadline.needsCpa ? ' — needs a licensed CPA' : ''}.`),
});

export const accountsDeadlineMetIntent = Object.freeze({
  name: 'accounts/deadline-met',
  policyTool: 'accounts.deadline-met',
  fieldsForPrompt: '{company, id, note}',
  descriptionForPrompt: 'THE LOGISTA OFFICE. Close a deadline that was met: note says how (filed, paid, the confirmation).',
  availableFor: available,
  validate: office(async (payload) => {
    const note = String(payload?.note ?? '').trim();
    if (note.length < 5) throw new Error('note: how it was met');
    return { deadlineId: String(payload?.id ?? '').trim(), note };
  }),
  summarize: (payload) => `deadline ${payload?.id ?? '?'} met`,
  execute: async ({ wallet, company, deadlineId, note, laneId }) => settled(await meetDeadline(wallet, company.id, deadlineId, { note, by: laneId, at: now() }), `Deadline [${deadlineId}] met.`),
});

export const accountsIntents = Object.freeze([accountsBookIntent, accountsVoidIntent, accountsDeadlineIntent, accountsDeadlineMetIntent]);
