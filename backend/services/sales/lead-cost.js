// WHAT THE LEADS COST — each paid plan (lead-plans.js) against what its partner actually gave (lead-provenance.js):
// paid so far, and that divided by the leads, the replies, the calls and the deals it led to. One read for the desk's
// COSTS sheet and for both briefings (the sales member's, the Logista's), so they never disagree. PURE.
//
// What is counted, and how:
//   paid so far   the plan's monthly price, once for each charge since the day it began (lead-plans.js chargesSoFar)
//   a partner's   every lead whose COMPANY it found or whose ADDRESS it gave (a lead counts once per partner). A lead
//   leads         found by one partner and addressed by another counts for both: each was paid for its part.
//   replied       they wrote back (a message from them is on the lead, or the lead stands replied or further)
//   calls         a call was booked with them (booked or held; one called off does not count)
//   won           the lead reads won
//   credits       this calendar month's lookups at the partner, against what the plan includes
//   booked        what the books hold as paid to that partner (money out whose memo names it) — beside "paid so far",
//                 so a charge nobody booked, or a plan nobody filed, shows as the gap between the two.
// A division by zero is never a number: with no leads yet the cost per lead reads null ("—"), not 0.
import { chargesSoFar } from './lead-plans.js';
import { partnerOf } from './lead-provenance.js';
import { callOf } from './booked-calls.js';

const low = (v) => String(v ?? '').trim().toLowerCase();
const per = (paid, n) => (n > 0 ? Math.round((paid / n) * 100) / 100 : null);
const round = (v) => Math.round(v * 100) / 100;
// The same reading the pipeline's REPLIED count uses, so the two never disagree: a message from them, or a lead that stands replied or further.
const wroteBack = (lead) => (lead.touches ?? []).some((t) => t.direction === 'in') || ['replied', 'qualified', 'won'].includes(lead.status);
const written = (lead) => (lead.touches ?? []).some((t) => t.direction === 'out') || ['contacted', 'replied', 'qualified', 'won'].includes(lead.status);

const counts = (leads) => ({
  leads: leads.length, written: leads.filter(written).length, replied: leads.filter(wroteBack).length,
  calls: leads.filter((l) => callOf(l)).length, won: leads.filter((l) => l.status === 'won').length,
});
const costs = (paid, c) => ({ perLead: per(paid, c.leads), perReply: per(paid, c.replied), perCall: per(paid, c.calls), perWon: per(paid, c.won) });

/**
 * pure — the cost sheet.
 * @param {{plans: object[], leads: object[], provenance: Map<string, {company: ?string, address: ?string}>,
 *   lookups?: object[], booked?: Array<{memo: string, amount: number, currency: string}>, now: number}} state
 * @returns {{currency: ?string, monthly: number, paid: number, booked: number, partners: object[], free: object, all: object}}
 */
export const leadCosts = ({ plans = [], leads = [], provenance = new Map(), lookups = [], booked = [], now }) => {
  const month = new Date(now).toISOString().slice(0, 7);
  const givenBy = (partner) => leads.filter((l) => { const p = provenance.get(l.id); return p && (low(p.company) === low(partner) || low(p.address) === low(partner)); });
  const creditsOf = (partner) => lookups.filter((l) => low(partnerOf(l.source)) === low(partner) && String(l.at ?? '').startsWith(month))
    .reduce((n, l) => n + (Number.isFinite(Number(l.spent)) ? Number(l.spent) : 1), 0);
  const currency = plans[0]?.currency ?? null;
  const partners = plans.map((plan) => {
    const charges = chargesSoFar(plan, now);
    const paid = round(plan.monthly * charges);
    const c = counts(givenBy(plan.partner));
    const used = creditsOf(plan.partner);
    const inBooks = round(booked.filter((b) => b.currency === plan.currency && low(b.memo).includes(low(plan.partner))).reduce((n, b) => n + b.amount, 0));
    return {
      partner: plan.partner, monthly: plan.monthly, currency: plan.currency, since: plan.since, charges, paid, ...c, ...costs(paid, c),
      credits: { used, included: plan.credits, perCredit: plan.credits ? Math.round((plan.monthly / plan.credits) * 10000) / 10000 : null },
      booked: inBooks, unbooked: round(Math.max(0, paid - inBooks)),
    };
  });
  const paidNames = new Set(plans.map((p) => low(p.partner)));
  const viaPaid = leads.filter((l) => { const p = provenance.get(l.id); return p && (paidNames.has(low(p.company)) || paidNames.has(low(p.address))); });
  const paid = round(partners.reduce((n, p) => n + p.paid, 0));
  const all = counts(leads);
  const free = counts(leads.filter((l) => !viaPaid.includes(l)));
  return {
    currency, monthly: round(plans.reduce((n, p) => n + p.monthly, 0)), paid, booked: round(partners.reduce((n, p) => n + p.booked, 0)), partners,
    // Every lead the house has, against everything paid: the one number to say out loud.
    all: { ...all, ...costs(paid, all) },
    // What came without a paid partner's part — the company's own pages, free lists, what was added by hand.
    free: { ...free, share: all.leads ? Math.round((free.leads / all.leads) * 100) : null },
  };
};

const cash = (currency, v) => (v === null || v === undefined ? '—' : `${currency === 'USD' ? '$' : `${currency} `}${Number(v).toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`);

/** pure — the lines both briefings carry: what is paid a month, and what a lead, a reply, a call and a deal have cost. */
export const costLines = (sheet) => {
  if (!sheet?.partners?.length) return [];
  const c = sheet.currency;
  return [
    `LEAD DATA COSTS — ${cash(c, sheet.monthly)} a month in plans, ${cash(c, sheet.paid)} paid so far: ${cash(c, sheet.all.perLead)} a lead, ${cash(c, sheet.all.perReply)} a reply, ${cash(c, sheet.all.perCall)} a call booked, ${cash(c, sheet.all.perWon)} a deal won (— means none yet). ${sheet.free.leads} of ${sheet.all.leads} leads came through no paid partner.`,
    ...sheet.partners.map((p) => `- ${p.partner}: ${cash(c, p.monthly)} a month since ${p.since} (${cash(c, p.paid)} paid) — ${p.leads} lead(s) ${cash(c, p.perLead)} each, ${p.replied} replied, ${p.calls} call(s), ${p.won} won; credits this month ${p.credits.used}${p.credits.included !== null ? ` of ${p.credits.included}` : ''}`),
  ];
};
