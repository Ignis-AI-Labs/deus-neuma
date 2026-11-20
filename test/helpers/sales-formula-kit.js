// THE EMAIL FORMULA's setup for a test that stages first emails (backend/services/sales/email-formula.js): an
// audience under a campaign whose email plan the seat filed and the operator locked in, and each person researched and
// a fit — all through the seat's real acts (RULE 0). `actAs(type, payload)` files one intent and sweeps it.

import { expect } from 'vitest';
import { fileSegment, openCampaign, setSegmentCampaign, reviewEmailPlan } from '../../backend/services/sales/sales-store.js';
import { makeSegment } from '../../backend/services/sales/segment-shape.js';
import { makeCampaign } from '../../backend/services/sales/campaign-shape.js';

export const PLAN_PROMISE = 'the session outline';

/** The formula's parts for a first email (to Otto at Outbox, unless overridden). */
export const formula = (o = {}) => ({ subject: 'Your build', hook: 'Your Outbox field app shipped an offline mode this month.', why: 'Crews adopting it in the field learn fastest one to one.', offer: 'A 60 minute session is 250 dollars, one to one.', askIndex: 0, ask: 'Shall I send the session outline?', ...o });
/** What formula() assembles to for Otto, signed by the plan below. */
export const OTTO = 'Hi Otto,\n\nYour Outbox field app shipped an offline mode this month. Crews adopting it in the field learn fastest one to one.\n\nA 60 minute session is 250 dollars, one to one.\n\nShall I send the session outline?\n\nThe Mercator';

/** An audience for "ignis" under an open campaign whose email plan is locked in. @returns {Promise<object>} the audience */
export const lockedCampaign = async ({ house, lane, actAs }) => {
  const now = new Date().toISOString();
  const segment = makeSegment({
    name: 'Crew software founders', offer: 'One-to-one sessions to build with AI tools', company: 'ignis', customerProblem: 'They cannot build what they know',
    targetRole: 'Founder', targetGeography: 'United States', countries: ['US'], positiveCriteria: ['Building a software product'], why: 'Raw AI tools leave them stuck', by: lane, now,
  });
  await fileSegment(house, segment);
  const campaign = makeCampaign({ name: 'Builder sessions', company: 'ignis', goal: 'Founders booking one-to-one build sessions', by: 'operator', now });
  expect((await openCampaign(house, campaign)).ok).toBe(true);
  expect((await setSegmentCampaign(house, segment.id, campaign.id, 'operator')).ok).toBe(true);
  const plan = await actAs('sales/email-plan', { campaign: campaign.id, objective: 'customers', need: 'Founders who know their trade need hands-on help building their own product.', offer: 'One-to-one sessions with the founder, 60 minutes, 250 US dollars an hour.', asks: [{ ask: 'Shall I send the session outline?', delivers: PLAN_PROMISE }], signature: 'The Mercator' });
  expect(plan.status, plan.error).toBe('ok');
  expect((await reviewEmailPlan(house, campaign.id, { verdict: 'approved', note: '', by: 'operator' })).ok).toBe(true);
  return segment;
};

/** A lead of that audience, for ledger.add. */
export const leadIn = (segment, lane, name, contact) => ({ name, contact, channelId: 'email', kind: 'buyer', status: 'cold', addedBy: lane, source: `lead engine [${segment.id}]` });

/** The seat researches one person, a fit. */
export const research = async (actAs, email, name, company, now) => {
  const r = await actAs('sales/research', { email, name, role: 'Founder', company, what: `${company} builds software for working crews.`, now, where: 'United States', need: 'Their crews need hands-on help adopting what they build.', sources: [`https://${email.split('@')[1]}/news`], fit: { verdict: 'yes', why: 'they build a product and need hands-on help' } });
  expect(r.status, r.error).toBe('ok');
};
