// A DEAL — the Mercator's record of one buyer moving toward a yes
// (docs/planning/proposals/governance/house-company-line.md §7). A deal opens
// QUALIFIED, and only on the two answers SPIN must have drawn out first: the
// buyer's problem, and what fixing it is worth to them in their own words
// (qualify hard). It moves to PROPOSED (what was offered), then WON or LOST,
// each with why (the Mercator's compass: […]).
//
// MAKOTO's […] holds here: a buyer who said no is not
// opened again for THREAD_REST_DAYS.
//
// The record is append-only events, folded here:
//   { type: 'opened', deal, at }    { type: 'moved', id, stage, note, value?, nextStep?, by, at }
// PURE, but for makeDeal's random id.

import crypto from 'crypto';

export const DEAL_STAGES = Object.freeze(['qualified', 'proposed', 'won', 'lost']);
export const OPEN_STAGES = Object.freeze(['qualified', 'proposed']);
export const THREAD_REST_DAYS = 30;
const DAY_MS = 86_400_000;
const TEXT_MAX = 600;

const clean = (v, max = TEXT_MAX) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);

// pure — {amount, currency}, or null when it is not a value.
const valueOf = (v) => (v && Number.isFinite(v.amount) && v.amount >= 0 && /^[A-Z]{3}$/.test(String(v.currency))
  ? Object.freeze({ amount: v.amount, currency: v.currency }) : null);

/** Who a deal is with, for the rest law: the lead it came from, else the buyer's name. pure. */
export const buyerKey = (deal) => (deal.leadId ? `lead:${deal.leadId}` : `buyer:${clean(deal.buyer).toLowerCase()}`);

/**
 * Open a deal, or a thrown reason. Pure but for its random id.
 * @param {{companyId: string, buyer: unknown, leadId?: unknown, value: unknown, spin: unknown,
 *   nextStep: unknown, openedBy: string, now: string}} fields
 */
export const makeDeal = ({ companyId, buyer, leadId, value, spin, nextStep, openedBy, now }) => {
  const who = clean(buyer, 120);
  if (who.length < 2) throw new Error('name the buyer');
  const worth = valueOf(value);
  if (!worth) throw new Error('value is {amount, currency}: the deal\'s honest size, a three-letter currency');
  const problem = clean(spin?.problem);
  const needPayoff = clean(spin?.needPayoff);
  if (problem.length < 10 || needPayoff.length < 10) {
    throw new Error('qualify first: spin.problem (where it hurts the buyer) and spin.needPayoff (what fixing it is worth, in their own words)');
  }
  const next = clean(nextStep, 200);
  if (next.length < 5) throw new Error('nextStep: the one clear next step');
  return Object.freeze({
    id: `d-${crypto.randomBytes(4).toString('hex')}`,
    companyId,
    buyer: who,
    leadId: clean(leadId, 80) || null,
    value: worth,
    spin: Object.freeze({ situation: clean(spin?.situation) || null, problem, implication: clean(spin?.implication) || null, needPayoff }),
    nextStep: next,
    openedBy,
    openedAt: now,
  });
};

/**
 * May a deal open with this buyer now? A clear no rests the thread. pure.
 * @param {object} deal - makeDeal's
 * @param {ReadonlyArray<object>} deals - foldDeals' deals
 * @returns {null | string} the refusal, or null
 */
export const restRefusal = (deal, deals) => {
  const key = buyerKey(deal);
  if (deals.some((d) => buyerKey(d) === key && OPEN_STAGES.includes(d.stage))) return `a deal with ${deal.buyer} is already open — move that one`;
  const no = deals.filter((d) => buyerKey(d) === key && d.stage === 'lost')
    .find((d) => Date.parse(deal.openedAt) - Date.parse(d.movedAt) < THREAD_REST_DAYS * DAY_MS);
  return no ? `${deal.buyer} said no on ${no.movedAt.slice(0, 10)} — a clear no ends the thread (MAKOTO); not before ${THREAD_REST_DAYS} days have passed` : null;
};

/**
 * Judge a move. pure.
 * @param {?object} deal - the folded deal
 * @param {{stage: unknown, note: unknown, value?: unknown, nextStep?: unknown, by: string, now: string}} move
 * @returns {{ok: true, event: object} | {ok: false, reason: string}}
 */
export const judgeMove = (deal, { stage, note, value, nextStep, by, now }) => {
  if (!deal) return { ok: false, reason: 'no such deal in this house — your MERCATOR OFFICE briefing names each by its [id]' };
  if (!OPEN_STAGES.includes(deal.stage)) return { ok: false, reason: `this deal is ${deal.stage} — a closed deal does not move` };
  if (!['proposed', 'won', 'lost'].includes(stage)) return { ok: false, reason: 'a move is to proposed, won or lost' };
  if (stage === deal.stage) return { ok: false, reason: `the deal is already ${stage}` };
  const why = clean(note);
  if (why.length < 10) return { ok: false, reason: stage === 'proposed' ? 'note: what was offered, and on what terms' : `note: why we ${stage === 'won' ? 'won' : 'lost'} — the compass asks it every time` };
  const worth = value === undefined ? null : valueOf(value);
  if (value !== undefined && !worth) return { ok: false, reason: 'value is {amount, currency}, or leave it out' };
  return {
    ok: true,
    event: { type: 'moved', id: deal.id, stage, note: why, ...(worth ? { value: worth } : {}), ...(clean(nextStep, 200) ? { nextStep: clean(nextStep, 200) } : {}), by, at: now },
  };
};

/**
 * Fold the record into deals, oldest first. pure.
 * @param {Array<object>} events
 * @returns {{deals: Array<object>, skipped: number}}
 */
export const foldDeals = (events) => events.reduce((acc, e) => {
  if (e?.type === 'opened' && e.deal?.id && !acc.deals.some((d) => d.id === e.deal.id)) {
    return { ...acc, deals: [...acc.deals, { ...e.deal, stage: 'qualified', movedAt: e.at, notes: [] }] };
  }
  const deal = e?.type === 'moved' && acc.deals.find((d) => d.id === e.id);
  if (deal && OPEN_STAGES.includes(deal.stage) && DEAL_STAGES.includes(e.stage)) {
    const moved = { ...deal, stage: e.stage, movedAt: e.at, value: e.value ?? deal.value, nextStep: e.nextStep ?? deal.nextStep, notes: [...deal.notes, { stage: e.stage, note: e.note, at: e.at }] };
    return { ...acc, deals: acc.deals.map((d) => (d === deal ? moved : d)) };
  }
  return { ...acc, skipped: acc.skipped + 1 };
}, { deals: [], skipped: 0 });

/**
 * The pipeline at a glance: per stage, how many deals and their value per currency. pure.
 * @param {ReadonlyArray<object>} deals
 */
export const pipeline = (deals) => Object.fromEntries(DEAL_STAGES.map((stage) => {
  const here = deals.filter((d) => d.stage === stage);
  const value = here.reduce((acc, d) => ({ ...acc, [d.value.currency]: (acc[d.value.currency] ?? 0) + d.value.amount }), {});
  return [stage, { count: here.length, value }];
}));
