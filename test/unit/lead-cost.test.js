// WHAT THE LEADS COST (sales/lead-plans.js, sales/lead-cost.js, the desk's sales-costs-view.js). Design note, 2026-11-20: […] Pure throughout.
import { describe, it, expect } from 'vitest';
import { makePlan, foldPlans, chargesSoFar } from '../../backend/services/sales/lead-plans.js';
import { leadCosts, costLines } from '../../backend/services/sales/lead-cost.js';
import { cash, costRows, costHeadline, conversionRows } from '../../frontend/app/RelinkShell/company-line/sales-costs-view.js';
import { logistaBriefingText } from '../../backend/services/accounts/accounts-briefing.js';

const NOW = '2026-11-20T12:00:00.000Z';
const apollo = makePlan({ partner: 'Apollo', monthly: 100, credits: 4020, since: '2026-09-05' }, NOW);
const hunter = makePlan({ partner: 'Hunter', monthly: 150, since: '2026-11-10' }, NOW);

describe('a plan is the operator\'s own word about their subscription', () => {
  it('keeps the partner, the price a month, the credits it includes and the day it began; a bad one is refused in words', () => {
    expect(apollo).toEqual({ partner: 'Apollo', monthly: 100, currency: 'USD', credits: 4020, since: '2026-09-05' });
    expect(makePlan({ partner: 'Tomba', monthly: '49.99' }, NOW)).toEqual({ partner: 'Tomba', monthly: 49.99, currency: 'USD', credits: null, since: '2026-11-20' });
    expect(() => makePlan({ partner: '', monthly: 10 }, NOW)).toThrow(/partner: who the plan is with/);
    expect(() => makePlan({ partner: 'Apollo', monthly: -1 }, NOW)).toThrow(/monthly: what the plan costs a month/);
    expect(() => makePlan({ partner: 'Apollo', monthly: 10, since: '2027-03-01' }, NOW)).toThrow(/cannot begin in the future/);
    expect(() => makePlan({ partner: 'Apollo', monthly: 10, credits: 1.5 }, NOW)).toThrow(/credits: the whole number/);
  });

  it('the last plan filed for a partner stands; an ended plan is gone', () => {
    const cheaper = makePlan({ partner: 'apollo', monthly: 59 }, NOW);
    expect(foldPlans([{ type: 'plan', plan: apollo }, { type: 'plan', plan: hunter }, { type: 'plan', plan: cheaper }]).map((p) => [p.partner, p.monthly])).toEqual([['apollo', 59], ['Hunter', 150]]);
    expect(foldPlans([{ type: 'plan', plan: apollo }, { type: 'ended', partner: 'APOLLO' }])).toEqual([]);
  });

  it('is charged on the day it began, then on each monthly return of that day', () => {
    const on = (day) => chargesSoFar(apollo, `${day}T12:00:00Z`);
    expect([on('2026-09-04'), on('2026-09-05'), on('2026-10-04'), on('2026-10-05'), on('2026-11-20')]).toEqual([0, 1, 1, 2, 3]);
    // Begun on the 31st: charged on a shorter month's last day.
    const end = makePlan({ partner: 'X1', monthly: 1, since: '2026-01-31' }, NOW);
    expect([chargesSoFar(end, '2026-02-27T00:00:00Z'), chargesSoFar(end, '2026-02-28T00:00:00Z'), chargesSoFar(end, '2026-03-30T00:00:00Z'), chargesSoFar(end, '2026-03-31T00:00:00Z')]).toEqual([1, 2, 2, 3]);
  });
});

const lead = (id, status, extra = {}) => ({ id, name: `Lead ${id}`, contact: `${id}@x.example`, status, touches: [], ...extra });
const inbound = { direction: 'in', at: '2026-11-10T00:00:00Z' };
const leads = [
  lead('a1', 'contacted'), lead('a2', 'replied', { touches: [inbound] }),
  lead('a3', 'qualified', { touches: [inbound, { callAt: '2026-11-23T19:00:00.000Z', callTitle: 'Intro' }] }),
  lead('a4', 'won', { touches: [inbound] }),
  lead('h1', 'cold'), lead('f1', 'replied', { touches: [inbound] }), lead('f2', 'cold'),
];
const provenance = new Map([
  ['a1', { company: 'Apollo', address: 'Apollo' }], ['a2', { company: 'Web search', address: 'Apollo' }], ['a3', { company: 'Apollo', address: 'Company site' }], ['a4', { company: 'Apollo', address: 'Hunter' }],
  ['h1', { company: 'Hunter', address: 'Hunter' }], ['f1', { company: 'DefiLlama', address: 'Company site' }], ['f2', { company: 'Added by hand', address: null }],
]);
const lookups = [{ source: 'apollo-find', spent: 12, at: '2026-11-03T00:00:00Z' }, { source: 'apollo', at: '2026-11-04T00:00:00Z' }, { source: 'apollo-find', spent: 40, at: '2026-10-30T00:00:00Z' }, { source: 'hunter-find', spent: 3, at: '2026-11-12T00:00:00Z' }];
const booked = [{ memo: 'Apollo, September plan', amount: 100, currency: 'USD' }, { memo: 'apollo october', amount: 100, currency: 'USD' }, { memo: 'GPU hours', amount: 900, currency: 'USD' }];
const sheet = leadCosts({ plans: [apollo, hunter], leads, provenance, lookups, booked, now: Date.parse(NOW) });

describe('what was paid, divided by what it bought', () => {
  it('each partner: paid so far, the leads it found or addressed, and the cost of a lead, a reply, a call and a deal', () => {
    const [a, h] = sheet.partners;
    expect(a).toMatchObject({ partner: 'Apollo', charges: 3, paid: 300, leads: 4, written: 4, replied: 3, calls: 1, won: 1, perLead: 75, perReply: 100, perCall: 300, perWon: 300 });
    // One lead found by Apollo and addressed by Hunter counts for both: each was paid for its part.
    expect(h).toMatchObject({ partner: 'Hunter', charges: 1, paid: 150, leads: 2, replied: 1, won: 1, perLead: 75, perReply: 150, perCall: null, perWon: 150 });
  });

  it('credits are this month\'s, against what the plan includes; a lookup with no count spent one', () => {
    expect(sheet.partners[0].credits).toEqual({ used: 13, included: 4020, perCredit: 0.0249 });
    expect(sheet.partners[1].credits).toEqual({ used: 3, included: null, perCredit: null });
  });

  it('the books stand beside it: what is booked to the partner by name, and what was paid and is not booked yet', () => {
    expect(sheet.partners[0]).toMatchObject({ booked: 200, unbooked: 100 });
    expect(sheet.partners[1]).toMatchObject({ booked: 0, unbooked: 150 });
    expect(sheet).toMatchObject({ currency: 'USD', monthly: 250, paid: 450, booked: 200 });
  });

  it('the whole house against everything paid, and what came through no paid partner', () => {
    expect(sheet.all).toMatchObject({ leads: 7, replied: 4, calls: 1, won: 1, perLead: 64.29, perReply: 112.5, perCall: 450, perWon: 450 });
    expect(sheet.free).toMatchObject({ leads: 2, replied: 1, share: 29 });
  });

  it('nothing bought yet is never a number: no leads reads null, no plan reads an empty sheet', () => {
    expect(leadCosts({ plans: [apollo], leads: [], now: Date.parse(NOW) }).partners[0]).toMatchObject({ paid: 300, leads: 0, perLead: null, perWon: null });
    const none = leadCosts({ plans: [], leads, provenance, now: Date.parse(NOW) });
    expect(none).toMatchObject({ currency: null, monthly: 0, paid: 0, partners: [] });
    expect(costLines(none)).toEqual([]);
  });

  it('both briefings carry the same lines; the accounts member is told what was paid and is not in the books', () => {
    const lines = costLines(sheet);
    expect(lines[0]).toBe('LEAD DATA COSTS — $250 a month in plans, $450 paid so far: $64.29 a lead, $112.50 a reply, $450 a call booked, $450 a deal won (— means none yet). 2 of 7 leads came through no paid partner.');
    expect(lines[1]).toBe('- Apollo: $100 a month since 2026-09-05 ($300 paid) — 4 lead(s) $75 each, 3 replied, 1 call(s), 1 won; credits this month 13 of 4020');
    const text = logistaBriefingText({ year: '2026', books: [], unbooked: [] }, Date.parse(NOW), sheet);
    expect(text).toContain(lines[0]);
    expect(text).toContain('NOT IN THE BOOKS: Apollo — 100 USD of 300 paid (3 charge(s) of 100 since 2026-09-05). Book each charge when its receipt or statement line is in hand (accounts/book, category software, the memo naming Apollo); never book one on this estimate alone.');
    expect(logistaBriefingText({ year: '2026', books: [], unbooked: [] }, Date.parse(NOW))).not.toContain('LEAD DATA COSTS');
  });
});

describe('the COSTS sheet on the desk', () => {
  const engine = { costs: sheet, spentBy: { Apollo: 53, Tomba: 7 }, leads: [], segments: [], prospects: [], candidates: [] };

  it('a row a partner: the plans, the most paid first, then every paid partner still without one', () => {
    const rows = costRows(engine);
    expect(rows.map((r) => [r.partner, r.filed])).toEqual([['Apollo', true], ['Hunter', true], ['Tomba', false]]);
    expect(rows[2]).toMatchObject({ monthly: null, paid: null, perLead: null, credits: { used: 7, included: null } });
    expect(costRows({}).map((r) => r.partner)).toEqual(['Apollo', 'Hunter', 'Tomba']);
  });

  it('money is said in its currency; nothing yet is a dash', () => {
    expect([cash('USD', 1250), cash('USD', 12.5), cash('EUR', 40), cash('USD', null)]).toEqual(['$1,250', '$12.50', 'EUR 40', '—']);
    expect(costHeadline(engine).map((h) => `${h.k}: ${h.v}`)).toEqual(['A MONTH IN PLANS: $250', 'PAID SO FAR: $450', 'A LEAD: $64.29', 'A REPLY: $112.50', 'A CALL BOOKED: $450', 'A DEAL WON: $450', 'LEADS THROUGH NO PAID PARTNER: 2 · 29%']);
    expect(costHeadline({})).toBeNull();
  });

  it('WHERE IT GOES: each stage against the one before it, and against everything found', () => {
    const L = (id, status, extra = {}) => ({ id, status, contact: `${id}@x.example`, origin: null, ...extra });
    const line = { ...engine, leads: [L('1', 'contacted'), L('2', 'replied'), L('3', 'qualified', { call: { at: '2026-11-23T19:00:00.000Z', title: 'Intro' } }), L('4', 'won'), L('5', 'cold')] };
    const rows = conversionRows(line);
    expect(rows.map((r) => r.label)).toEqual(['COMPANIES FOUND', 'SHORTLISTED', 'LEADS', 'WRITTEN TO', 'REPLIED', 'CALLS BOOKED', 'WON']);
    const by = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(by['WRITTEN TO']).toMatchObject({ n: 4 });
    expect(by.REPLIED).toMatchObject({ n: 2, ofPrior: 50 });
    expect(by['CALLS BOOKED']).toMatchObject({ n: 1, ofPrior: 50 });
    expect(by.WON).toMatchObject({ n: 1, ofPrior: 100 });
    expect(by['COMPANIES FOUND']).toMatchObject({ ofPrior: null, ofFound: null });
    expect(by.SHORTLISTED.ofPrior).toBeNull(); // nothing found: no share is invented
  });
});
