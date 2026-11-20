/**
 * revenue/* — the Mercator office's filed acts (Design note, 2026-10-29: the sales
 * seat): `revenue/deal` opens a deal once the buyer is qualified (SPIN's
 * problem and need-payoff known), `revenue/move` carries it to proposed, won
 * or lost with why. A deal from a lead moves that lead on the CMO's ledger
 * too — the handoff the two offices share, every touch on its history.
 *
 * THE OFFICE LAW: every validate re-verifies that the filing lane IS the
 * house's seated Mercator (cro-designation.js). Tier `allowed`
 * (tool-policy-defaults.js): a record in the house's own office — outreach
 * itself rides the gated channels, a contract is the operator's to sign.
 */
import { croDesignation } from '../revenue/cro-designation.js';
import { makeDeal } from '../revenue/deal-shape.js';
import { openDeal, moveDeal, readDeals } from '../revenue/deal-store.js';
import { readCompany } from '../company-line/company-store.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { createLogger } from '../logger.js';

const log = createLogger('Revenue.Acts');
const officerRefusal = { ok: false, status: 'denied', reason: 'deals are the Mercator office\'s — only the seated Mercator opens and moves them (house/post reaches them; the operator seats the office)' };

// impure — the filing lane, when it is this house's seated Mercator.
export const officeContext = async (connection) => {
  const laneId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!laneId || !wallet) return null;
  const officer = await croDesignation.getOfficer(wallet).catch(() => null);
  return officer?.laneId === laneId ? { laneId, wallet } : null;
};

// impure — move the deal's lead on the CMO's ledger; a ledger that will not move never costs the deal.
const touchLead = async (wallet, leadId, change) => {
  if (!leadId) return;
  try {
    await (await leadLedgerFor(wallet)).touch(leadId, change);
  } catch (err) {
    log.warn('The lead ledger did not take the deal\'s move — the deal stands', { leadId, err: err.message });
  }
};

export const revenueDealIntent = Object.freeze({
  name: 'revenue/deal',
  policyTool: 'revenue.deal',
  fieldsForPrompt: '{company, buyer, value: {amount, currency}, spin: {situation?, problem, implication?, needPayoff}, nextStep, leadId?}',
  descriptionForPrompt: 'THE MERCATOR OFFICE. Open a deal once the buyer is qualified: company is the company line [id] it is for; spin.problem is where it hurts them and spin.needPayoff what fixing it is worth, in their own words; value the honest size; nextStep the one clear next step; leadId the lead it came from, if any (the lead moves to qualified, yours to work). A buyer who said no rests thirty days.',

  availableFor: async ({ connection }) => ((await officeContext(connection).catch(() => null)) ? {} : null),

  validate: async (payload, { connection }) => {
    const context = await officeContext(connection).catch(() => null);
    if (!context) return officerRefusal;
    const company = await readCompany(context.wallet, String(payload?.company ?? '').trim()).catch(() => null);
    if (!company) return { ok: false, status: 'invalid', reason: `"${payload?.company ?? ''}" is not a company of this house — the COMPANY LINE briefing names each by its [id]` };
    if (payload?.leadId) {
      const leads = await (await leadLedgerFor(context.wallet)).load().catch(() => []);
      if (!leads.some((l) => l.id === payload.leadId)) return { ok: false, status: 'invalid', reason: `lead "${payload.leadId}" is not on the house's lead ledger` };
    }
    try {
      return { ok: true, value: { context, deal: makeDeal({ ...payload, companyId: company.id, openedBy: context.laneId, now: new Date().toISOString() }) } };
    } catch (err) {
      return { ok: false, status: 'invalid', reason: err.message };
    }
  },

  summarize: (payload) => `open a deal with ${String(payload?.buyer ?? '?').slice(0, 60)}`,

  execute: async ({ context, deal }) => {
    const opened = await openDeal(context.wallet, deal);
    if (!opened.ok) return { ok: false, reason: opened.reason };
    await touchLead(context.wallet, deal.leadId, { status: 'qualified', ownerNeumaId: context.laneId, note: `deal [${deal.id}] opened by the Mercator`, by: context.laneId });
    return { ok: true, detail: `Deal [${deal.id}] with ${deal.buyer} is open (qualified, ${deal.value.amount} ${deal.value.currency}). Next: ${deal.nextStep}.` };
  },
});

export const revenueMoveIntent = Object.freeze({
  name: 'revenue/move',
  policyTool: 'revenue.move',
  fieldsForPrompt: '{id, stage, note, value?, nextStep?}',
  descriptionForPrompt: 'THE MERCATOR OFFICE. Move a deal: stage proposed (note: what you offered, on what terms), won or lost (note: why — the compass asks every time). value updates its size; nextStep the one clear next step. A closed deal does not move.',

  availableFor: revenueDealIntent.availableFor,

  validate: async (payload, { connection }) => {
    const context = await officeContext(connection).catch(() => null);
    if (!context) return officerRefusal;
    const id = String(payload?.id ?? '').trim();
    if (!(await readDeals(context.wallet)).deals.some((d) => d.id === id)) {
      return { ok: false, status: 'invalid', reason: `deal "${id}" is not in this house — your MERCATOR OFFICE briefing names each by its [id]` };
    }
    return { ok: true, value: { context, id, move: { stage: payload?.stage, note: payload?.note, value: payload?.value, nextStep: payload?.nextStep, by: context.laneId, now: new Date().toISOString() } } };
  },

  summarize: (payload) => `deal ${payload?.id ?? '?'} → ${payload?.stage ?? '?'}`,

  execute: async ({ context, id, move }) => {
    const moved = await moveDeal(context.wallet, id, move);
    if (!moved.ok) return { ok: false, reason: moved.reason };
    const deal = (await readDeals(context.wallet)).deals.find((d) => d.id === id);
    if (['won', 'lost'].includes(move.stage)) await touchLead(context.wallet, deal?.leadId, { status: move.stage, note: `deal [${id}] ${move.stage}: ${moved.event.note}`, by: context.laneId });
    return { ok: true, detail: `Deal [${id}] is ${move.stage}.` };
  },
});

export const revenueIntents = Object.freeze([revenueDealIntent, revenueMoveIntent]);
