// THE SALES FACTS — what the house may tell a buyer, each fact with its
// source, approved once by the operator; and the check every email to a lead
// passes before it can leave (MAKOTO: persuade only with what is true). An
// email to anyone on the lead ledger goes only when:
//   - the operator has approved a facts sheet;
//   - every number in it stands on that sheet (dates and bare years aside) —
//     the house cannot hallucinate a figure into a buyer's inbox;
//   - it applies no false urgency.
// Every problem is named at once. Words without numbers are not machine-
// checked: the sheet rides the Mercator's briefing, and the operator approved
// the pitch they come from.
// The record is append-only events, folded here:
//   { type: 'facts', sheet, at }   { type: 'reviewed', sheetId, verdict, note, by, at }
// PURE, but for makeSalesSheet's random id.

import crypto from 'crypto';
import { figuresIn, URGENCY } from '../raise/facts-gate.js';
import { sourceLaw } from '../company-line/source-law.js';

const { isSource, words: SOURCE_WORDS } = sourceLaw(['document', 'customer', 'operator']);
const FACTS_MAX = 40;

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);

/**
 * A facts sheet, or a thrown reason naming every problem at once.
 * @param {{facts: unknown, by: string, now: string}} f
 */
export const makeSalesSheet = ({ facts, by, now }) => {
  const list = Array.isArray(facts) ? facts.slice(0, FACTS_MAX) : [];
  if (list.length < 3) throw new Error('facts: at least three — what a buyer may be told about the house, each sourced');
  const problems = list.flatMap((f, i) => [
    ...(!clean(f?.company, 40) ? [`facts[${i}].company: the id of the house company this fact is true of`] : []),
    ...(clean(f?.claim, 400).length < 10 ? [`facts[${i}].claim: state the fact`] : []),
    ...(f?.figure != null && !(Number.isFinite(f.figure.value) && clean(f.figure.unit, 16)) ? [`facts[${i}].figure: {value, unit}, or leave it out`] : []),
    ...(!isSource(f?.source) ? [`facts[${i}].source: ${SOURCE_WORDS}`] : []),
  ]);
  if (problems.length) throw new Error(problems.slice(0, 8).join('; '));
  return Object.freeze({
    id: `fs-${crypto.randomBytes(4).toString('hex')}`,
    facts: Object.freeze(list.map((f, i) => Object.freeze({
      n: i + 1,
      company: clean(f.company, 40).toLowerCase(),
      claim: clean(f.claim, 400),
      figure: f.figure ? Object.freeze({ value: f.figure.value, unit: clean(f.figure.unit, 16) }) : null,
      source: clean(f.source, 300),
    }))),
    by,
    filedAt: now,
  });
};

/**
 * The approved sheet as ONE company may use it: only that company's facts (a
 * fact filed before facts named a company counts for every company). null
 * company: the whole sheet. pure.
 */
export const factsFor = (approved, company) => (!approved || !company ? approved
  : { ...approved, facts: approved.facts.filter((f) => !f.company || f.company === company) });

// AN APPROVED FACT STAYS APPROVED (Design note, 2026-11-18: […]). A fact is the same fact while its company, its words and
// its figure are — what a buyer reads; a fresh date in its source is not a new fact. On a new sheet, every fact the
// operator approved before is CARRIED, already approved; only the new or reworded ones wait. A sheet with nothing new
// on it (a fact taken off, the same facts filed again) stands approved the moment it is filed.
export const factKey = (f) => [f.company || '', String(f.claim ?? '').replace(/\s+/g, ' ').trim().toLowerCase(), f.figure ? `${f.figure.value} ${String(f.figure.unit).toLowerCase()}` : ''].join('|');

/**
 * The latest sheet, its review, the sheet the operator last approved, and which facts of the latest sheet were
 * approved before (carried: their numbers). pure.
 */
export const foldSalesFacts = (events) => events.reduce((s, e) => {
  if (e?.type === 'facts' && e.sheet?.id) {
    const before = new Set((s.approved?.facts ?? []).map(factKey));
    const carried = e.sheet.facts.filter((f) => before.has(factKey(f))).map((f) => f.n);
    if (carried.length && carried.length === e.sheet.facts.length) {
      return { ...s, sheet: e.sheet, carried, approved: e.sheet, review: { verdict: 'approved', note: null, at: e.sheet.filedAt ?? null, held: [], carried: true } };
    }
    return { ...s, sheet: e.sheet, carried, review: null };
  }
  if (e?.type === 'reviewed' && s.sheet?.id === e.sheetId) {
    // Approved in part (`only`: the facts the operator checked): those stand, with every fact carried as approved
    // before; the rest are HELD for the seat to fix.
    const only = e.verdict === 'approved' && Array.isArray(e.only) ? new Set([...e.only, ...(s.carried ?? [])]) : null;
    const held = only ? s.sheet.facts.filter((f) => !only.has(f.n)) : [];
    const approved = e.verdict !== 'approved' ? s.approved : only ? { ...s.sheet, facts: s.sheet.facts.filter((f) => only.has(f.n)) } : s.sheet;
    return { ...s, review: { verdict: e.verdict, note: e.note, at: e.at, held }, approved };
  }
  return s;
}, { sheet: null, review: null, approved: null, carried: [] });

/** The facts of the latest sheet that wait for the operator: all but those carried as approved before. pure. */
export const factsToReview = (state) => (state?.sheet?.facts ?? []).filter((f) => !(state.carried ?? []).includes(f.n));

/**
 * The operator changes ONE fact of the sheet on screen: rewrites it, or takes
 * it off. The answer is a new sheet (the same facts with that change, numbered
 * again) which waits for the operator's approval like any other; the sheet
 * approved before stands until then. pure, but for the new sheet's id.
 * @param {object} state - foldSalesFacts' answer
 * @param {{sheetId: string, n: number, remove?: boolean, claim?: string, source?: string, figure?: ?{value: number, unit: string}, now: string}} change
 * @returns {{ok: true, sheet: object} | {ok: false, reason: string}}
 */
export const editSheetFact = (state, { sheetId, n, remove = false, claim, source, figure, now }) => {
  if (!state?.sheet || state.sheet.id !== sheetId) return { ok: false, reason: 'change the facts sheet on screen — a newer one was filed, or none' };
  const at = state.sheet.facts.findIndex((f) => f.n === Number(n));
  if (at < 0) return { ok: false, reason: `there is no fact ${n} on this sheet` };
  const facts = state.sheet.facts.map((f) => ({ company: f.company, claim: f.claim, figure: f.figure, source: f.source }));
  if (remove) facts.splice(at, 1);
  else facts[at] = { ...facts[at], ...(claim !== undefined ? { claim } : {}), ...(source !== undefined ? { source } : {}), ...(figure !== undefined ? { figure } : {}) };
  try {
    return { ok: true, sheet: makeSalesSheet({ facts, by: 'operator', now }) };
  } catch (err) {
    return { ok: false, reason: remove && facts.length < 3 ? 'a sheet holds at least three facts — return the sheet instead, or ask the seat for more' : err.message };
  }
};

/** The operator's review of the latest sheet, or the refusal. pure. */
export const judgeSheetReview = (state, { sheetId, verdict, note, only, now }) => {
  if (!state?.sheet || state.sheet.id !== sheetId) return { ok: false, reason: 'review the facts sheet on screen — a newer one was filed, or none' };
  if (state.review) return { ok: false, reason: `this sheet was already ${state.review.verdict}` };
  if (!['approved', 'returned'].includes(verdict)) return { ok: false, reason: 'the verdict is approved or returned' };
  const n = clean(note, 600);
  if (verdict === 'returned' && n.length < 5) return { ok: false, reason: 'say what should change' };
  // `only`: approve just the facts checked; the others go back to the seat. Every fact that waits checked is a plain
  // approval (the facts carried as approved before stand either way).
  const all = state.sheet.facts.map((f) => f.n);
  const waits = factsToReview(state).map((f) => f.n);
  const picked = verdict === 'approved' && Array.isArray(only) ? [...new Set(only.map(Number))].filter((x) => all.includes(x)).sort((a, b) => a - b) : null;
  if (picked && !picked.some((x) => waits.includes(x))) return { ok: false, reason: 'check at least one fact to approve, or return the sheet' };
  const part = picked && !waits.every((x) => picked.includes(x)) ? { only: picked.filter((x) => waits.includes(x)) } : {};
  return { ok: true, event: { type: 'reviewed', sheetId, verdict, ...part, note: n || null, by: 'operator', at: now } };
};

/**
 * Judge one email to a lead. pure.
 * @param {{subject: string, text: string, approved: ?object}} args
 * @returns {{ok: true} | {ok: false, problems: string[]}}
 */
export const checkSalesEmail = ({ subject, text, approved }) => {
  if (approved && !approved.facts.length) return { ok: false, problems: ['no approved fact is filed for this lead\'s company — file its facts with sales/facts and have the operator approve them'] };
  if (!approved) return { ok: false, problems: ['the operator has not approved a facts sheet — file one with sales/facts; no lead is written to before it is approved'] };
  const all = `${subject}\n${text}`;
  const allowed = new Set(approved.facts.filter((f) => f.figure).map((f) => f.figure.value));
  const strays = [...new Set(figuresIn(all).filter((v) => !allowed.has(v)))];
  const problems = [
    ...strays.map((v) => `${v} is not on the approved facts sheet — a buyer reads no figure the sheet does not hold (write dates as 2026-11-14)`),
    ...(URGENCY.test(all) ? ['no false urgency (MAKOTO) — a buyer decides in their own time'] : []),
  ];
  return problems.length ? { ok: false, problems } : { ok: true };
};
