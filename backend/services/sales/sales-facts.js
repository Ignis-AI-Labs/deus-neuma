// THE SALES FACTS — what the house may tell a buyer, each fact with its
// source, approved once by the operator; and the check every email to a lead
// passes before it can leave (MAKOTO: persuade only with what is true). An
// email to anyone on the lead ledger goes only when:
//   - the operator has approved a facts sheet;
//   - every number in it stands on that sheet (dates and bare years aside) —
//     the house cannot hallucinate a figure into a buyer's inbox;
//   - it carries the disclosure line, word for word: it is from an AI, and
//     "stop" ends it;
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

export const SALES_DISCLOSURE = 'I am an AI, writing for the company. Reply "stop" and I will not write again.';
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
    ...(clean(f?.claim, 400).length < 10 ? [`facts[${i}].claim: state the fact`] : []),
    ...(f?.figure != null && !(Number.isFinite(f.figure.value) && clean(f.figure.unit, 16)) ? [`facts[${i}].figure: {value, unit}, or leave it out`] : []),
    ...(!isSource(f?.source) ? [`facts[${i}].source: ${SOURCE_WORDS}`] : []),
  ]);
  if (problems.length) throw new Error(problems.slice(0, 8).join('; '));
  return Object.freeze({
    id: `fs-${crypto.randomBytes(4).toString('hex')}`,
    facts: Object.freeze(list.map((f, i) => Object.freeze({
      n: i + 1,
      claim: clean(f.claim, 400),
      figure: f.figure ? Object.freeze({ value: f.figure.value, unit: clean(f.figure.unit, 16) }) : null,
      source: clean(f.source, 300),
    }))),
    by,
    filedAt: now,
  });
};

/** The latest sheet, its review, and the sheet the operator last approved. pure. */
export const foldSalesFacts = (events) => events.reduce((s, e) => {
  if (e?.type === 'facts' && e.sheet?.id) return { ...s, sheet: e.sheet, review: null };
  if (e?.type === 'reviewed' && s.sheet?.id === e.sheetId) {
    return { ...s, review: { verdict: e.verdict, note: e.note, at: e.at }, approved: e.verdict === 'approved' ? s.sheet : s.approved };
  }
  return s;
}, { sheet: null, review: null, approved: null });

/** The operator's review of the latest sheet, or the refusal. pure. */
export const judgeSheetReview = (state, { sheetId, verdict, note, now }) => {
  if (!state?.sheet || state.sheet.id !== sheetId) return { ok: false, reason: 'review the facts sheet on screen — a newer one was filed, or none' };
  if (state.review) return { ok: false, reason: `this sheet was already ${state.review.verdict}` };
  if (!['approved', 'returned'].includes(verdict)) return { ok: false, reason: 'the verdict is approved or returned' };
  const n = clean(note, 600);
  if (verdict === 'returned' && n.length < 5) return { ok: false, reason: 'say what should change' };
  return { ok: true, event: { type: 'reviewed', sheetId, verdict, note: n || null, by: 'operator', at: now } };
};

/**
 * Judge one email to a lead. pure.
 * @param {{subject: string, text: string, approved: ?object}} args
 * @returns {{ok: true} | {ok: false, problems: string[]}}
 */
export const checkSalesEmail = ({ subject, text, approved }) => {
  if (!approved) return { ok: false, problems: ['the operator has not approved a facts sheet — file one with sales/facts; no lead is written to before it is approved'] };
  const all = `${subject}\n${text}`;
  const allowed = new Set(approved.facts.filter((f) => f.figure).map((f) => f.figure.value));
  const strays = [...new Set(figuresIn(all.replace(SALES_DISCLOSURE, '')).filter((v) => !allowed.has(v)))];
  const problems = [
    ...strays.map((v) => `${v} is not on the approved facts sheet — a buyer reads no figure the sheet does not hold (write dates as 2026-11-14)`),
    ...(String(text).includes(SALES_DISCLOSURE) ? [] : [`carry the disclosure line, word for word, above your name: "${SALES_DISCLOSURE}"`]),
    ...(URGENCY.test(all) ? ['no false urgency (MAKOTO) — a buyer decides in their own time'] : []),
  ];
  return problems.length ? { ok: false, problems } : { ok: true };
};
