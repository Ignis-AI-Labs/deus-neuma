/**
 * THE PIPELINE REVIEW (sales/pipeline-standard.js, sales/pipeline-review.js) — Design note, 2026-11-22: […]
 * Pure: the records are plain data in the shapes the stores fold (the route and the seat's act are proved on a real
 * house in integration/sales-office.test.js). The cases are the faults found on the live house the day it was built.
 */
import { describe, test, expect } from 'vitest';
import { gradeLead, generalMailbox, roleOfLead, STANDARD, STAGES } from '../../backend/services/sales/pipeline-standard.js';
import { reviewBatch, reviewWords, timeWords, discoveryOf } from '../../backend/services/sales/pipeline-review.js';
import { makeEmailPlan, makeResearch, assembleEmail } from '../../backend/services/sales/email-formula.js';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const at = (h) => new Date(NOW - h * 3_600_000).toISOString();
const plan = makeEmailPlan({ objective: 'funding', need: 'A live venue they can check before they commit', offer: 'A live DLMM on Base where the provider keeps the fee', asks: [{ ask: 'Shall I send the deck and the terms of the round?', delivers: 'the deck and the terms of the round' }], signature: 'Merc\nSales, Umbrae' });
const campaign = { id: 'k-1', name: 'Umbrae — Funding & Raise', company: 'umbrae', goal: 'Secure funding from investors and VCs', state: 'open', emailPlan: { approved: plan } };
const segment = { id: 's-1', name: 'Crypto funds', company: 'umbrae', campaign: 'k-1', state: 'approved', targetRole: 'Partner or founder of a fund', countries: ['US'], positiveCriteria: ['Active crypto fund'], required: [{ sign: 'It invests in crypto', evidence: ['crypto'] }] };
const fields = { hook: 'You led the June 2026 round for the lending protocol Morpho.', why: 'A venue the provider can check fits that thesis today.', offer: 'Umbrae is a live DLMM on Base where the provider keeps the swap fee.', ask: 'Shall I send the deck and the terms of the round?', askIndex: 0 };

// One lead, right at every stage; `over` breaks one thing at a time.
const good = (domain, over = {}) => {
  const email = over.email ?? `ada@${domain}`;
  const card = { ...makeResearch({ email, name: 'Ada Lovelace', role: 'General Partner', company: domain, what: 'A venture fund that invests in crypto networks', now: 'Led the June 2026 round for the lending protocol Morpho', need: 'A live venue they can check before they commit', sources: [`https://${domain}/`, 'https://news.example/morpho-round'] }), at: at(40), ...over.card };
  return {
    prospect: { id: `p-${domain}`, segmentId: 's-1', domain, name: 'Fund One', country: 'US', match: 3, fit: [{ criterion: 'Active crypto fund', score: 5, reasoning: 'Its page says "we invest in crypto networks".' }], misfit: [], stage: 'promoted', leadId: `l-${domain}`, foundAt: at(48), promotedAt: at(47.99), listApproved: true, proofs: [{ sign: 'It invests in crypto', met: true }], ...over.prospect },
    lead: { id: `l-${domain}`, name: `Ada Lovelace, General Partner at ${domain}`, contact: email, status: 'cold', createdAt: at(47.99), touches: [{ at: at(47.99), note: `[p-${domain}] strong match — filed by lead run run-abc` }], ...over.lead },
    check: over.check === null ? null : { email, status: 'valid', checker: 'Apollo', live: true, at: at(47.99), ...over.check },
    card: over.card === null ? null : card,
    fit: over.fit === null ? null : { email, campaignId: 'k-1', verdict: 'yes', why: 'a crypto thesis', ...over.fit },
    entity: over.entity === null ? null : { domain, entityType: 'vc-fund', quote: 'we invest in crypto networks', verified: true, ...over.entity },
    draft: over.draft === null ? null : { id: `m-${domain}`, to: [email], subject: 'Umbrae: Raising Our Seed Round', text: assembleEmail({ card, plan, ...fields }), state: 'waiting', at: at(39.98), revised: 0, formula: { campaignId: 'k-1', ...fields }, ...over.draft },
  };
};
const read = (leads, more = {}) => ({
  segments: [segment], campaigns: [campaign], candidates: more.candidates ?? [], runs: more.runs ?? [], facts: null, companyNames: new Map([['umbrae', 'Umbrae']]),
  prospects: [...leads.map((l) => l.prospect), ...(more.prospects ?? [])], leads: leads.map((l) => l.lead), checks: leads.map((l) => l.check).filter(Boolean),
  drafts: leads.map((l) => l.draft).filter(Boolean),
  research: { cards: new Map(leads.filter((l) => l.card).map((l) => [l.card.email, l.card])), fits: new Map(leads.filter((l) => l.fit).map((l) => [`${l.fit.email}|k-1`, l.fit])), entities: new Map(leads.filter((l) => l.entity).map((l) => [l.entity.domain, l.entity])) },
});
const review = (leads, ask = {}, more = {}) => reviewBatch(read(leads, more), { segmentId: 's-1', now: NOW, ...ask });
const failsOf = (r, domain) => r.rows.find((x) => x.domain === domain).fails.map((f) => f.check);

describe('the pipeline review', () => {
  test('the standard is written down: every check has its stage, its weight and a sentence', () => {
    expect(STAGES.map((s) => s.id)).toEqual(['filter', 'address', 'validate', 'research', 'email']);
    for (const c of STANDARD) expect(c, c.id).toMatchObject({ stage: expect.stringMatching(/^(filter|address|validate|research|email)$/), must: expect.any(Boolean), says: expect.stringMatching(/\.$/) });
    expect(new Set(STANDARD.map((c) => c.id)).size).toBe(STANDARD.length);
  });

  test('a lead right at every stage meets every stage; a general partner is a person, a general address is not', () => {
    const r = review([good('one.example')]);
    expect(r.rows[0]).toMatchObject({ grades: { filter: 'meets', address: 'meets', validate: 'meets', research: 'meets', email: 'meets' }, fails: [] });
    expect(r.whole).toEqual({ reachedEmail: 1, clean: 1, noMustFailed: 1 });
    expect(r.findings).toEqual([]);
    expect([generalMailbox('info@a.vc'), generalMailbox('hello2@a.vc'), generalMailbox('jock@a.vc'), generalMailbox('partnerships@a.vc')]).toEqual([true, true, false, true]);
    expect(roleOfLead({ name: 'Jock Percy, General Partner at Lightning Capital' })).toBe('General Partner');
  });

  test('FILTER: what should not have got through fails, what got through thin is weak', () => {
    const r = review([
      good('bare.example', { prospect: { match: 2, fit: [{ criterion: 'Active crypto fund', score: 3, reasoning: 'It lists portfolio companies, but it does not explicitly state it is a crypto fund.' }], country: null } }),
      good('hedged.example', { prospect: { fit: [{ criterion: 'Active crypto fund', score: 5, reasoning: 'It is a fund, but it does not explicitly state that it invests in crypto.' }] } }),
      good('general.example', { prospect: { proofs: [{ sign: 'It invests in crypto', met: false }] } }),
      good('unproved.example', { prospect: { proofs: [] } }),
      good('product.example', { entity: { entityType: 'product-company' } }),
      good('abroad.example', { prospect: { country: 'GB' } }),
    ]);
    expect(failsOf(r, 'bare.example')).toEqual(['fit.firm']);
    expect(reviewBatch({ ...read([good('never.example', { email: 'ada@never.co.il' })]), never: ['IL'] }, { segmentId: 's-1', now: NOW }).rows[0].fails[0]).toMatchObject({ check: 'fit.never', must: true, why: 'the address ada@never.co.il is at a domain of Israel' });
    expect(failsOf(r, 'hedged.example')).toEqual(['fit.shown']);
    expect(r.rows.find((x) => x.domain === 'bare.example').grades.filter).toBe('weak');
    expect(failsOf(r, 'general.example')).toContain('fit.required');
    expect(r.rows.find((x) => x.domain === 'unproved.example').fails[0]).toMatchObject({ check: 'fit.required', must: true, why: 'not proved yet: It invests in crypto' });
    expect(r.rows.find((x) => x.domain === 'product.example').fails[0]).toMatchObject({ check: 'fit.investor', why: 'on record as product-company, not an investor' });
    expect(r.rows.find((x) => x.domain === 'abroad.example').fails[0]).toMatchObject({ check: 'fit.country', why: 'it is in GB' });
    const filter = r.stages.find((s) => s.id === 'filter');
    expect(filter).toMatchObject({ reached: 6, meets: 0, weak: 2, fails: 4, rate: 0 });
    expect(filter.checks.find((c) => c.id === 'fit.required')).toMatchObject({ failed: 2, must: true, examples: [expect.objectContaining({ domain: 'general.example' }), expect.objectContaining({ domain: 'unproved.example' })] });
  });

  test('ADDRESS and VALIDATION: a general mailbox, the wrong role, another domain; an address no checker confirmed', () => {
    const r = review([
      good('team.example', { email: 'hello@team.example', lead: { name: 'Team Example team, general address at Team Example' }, card: { name: 'Team Example team', role: 'general address' } }),
      good('analyst.example', { lead: { name: 'Bo Chen, Financial Analyst at Analyst' } }),
      good('other.example', { email: ['ada', 'gmail.com'].join('@') }),
      good('hashkey.capital', { email: 'ada@hashkey.com' }),
      good('unknown.example', { check: { status: 'unknown' } }),
      good('never.example', { check: null }),
      good('stored.example', { check: { live: false, at: at(24 * 100) } }),
    ]);
    expect(failsOf(r, 'team.example')).toEqual(expect.arrayContaining(['who.person', 'card.person']));
    expect(r.rows.find((x) => x.domain === 'analyst.example').fails[0]).toMatchObject({ check: 'who.top', why: '"Financial Analyst" is neither the top nor the role aimed at' });
    expect(failsOf(r, 'other.example')).toContain('who.domain');
    expect(failsOf(r, 'hashkey.capital')).not.toContain('who.domain');
    expect(r.rows.find((x) => x.domain === 'unknown.example')).toMatchObject({ grades: { validate: 'fails' }, fails: expect.arrayContaining([expect.objectContaining({ check: 'addr.valid', why: 'Apollo: unknown' })]) });
    expect(r.rows.find((x) => x.domain === 'never.example').fails.find((f) => f.check === 'addr.valid').why).toBe('never checked');
    expect(failsOf(r, 'stored.example')).toEqual(expect.arrayContaining(['addr.live', 'addr.fresh']));
    expect(r.rows.find((x) => x.domain === 'stored.example').grades.validate).toBe('weak');
  });

  test('RESEARCH and EMAIL: no fit on record, a thin card; another campaign\'s pitch, a point made twice, a company greeted', () => {
    const r = review([
      good('nofit.example', { fit: { verdict: 'no', why: 'no crypto thesis' } }),
      good('thin.example', { card: { now: 'Investing across infrastructure with a wide portfolio', when: '', sources: ['https://elsewhere.example/'] } }),
      good('wrong.example', { draft: { formula: { campaignId: 'k-other', ...fields } } }),
      good('twice.example', { draft: { formula: { campaignId: 'k-1', ...fields, offer: 'Umbrae is a live DLMM on Base where the provider keeps the swap fee. Umbrae is a live DLMM on Base today.' } } }),
      good('greet.example', { draft: { text: 'Hi Fund,\n\nA line.', revised: 4 } }),
      good('waiting.example', { card: null, fit: null, draft: null }),
    ]);
    expect(r.rows.find((x) => x.domain === 'nofit.example')).toMatchObject({ grades: { research: 'fails' }, fails: expect.arrayContaining([expect.objectContaining({ check: 'card.fit', why: 'on record as NOT a fit: no crypto thesis' })]) });
    expect(failsOf(r, 'thin.example')).toEqual(expect.arrayContaining(['card.own-site', 'card.dated']));
    expect(r.rows.find((x) => x.domain === 'wrong.example').fails.find((f) => f.check === 'mail.campaign').why).toBe('written for campaign k-other, and its audience serves Umbrae — Funding & Raise');
    expect(failsOf(r, 'twice.example')).toEqual(['mail.once']);
    expect(failsOf(r, 'greet.example')).toEqual(['mail.greeting', 'mail.first-draft']);
    expect(r.rows.find((x) => x.domain === 'waiting.example').grades).toMatchObject({ validate: 'meets', research: 'none', email: 'none' });
    expect(r.findings).toEqual(['1 of 6 leads have a confirmed address and no research yet: the oldest has waited 48 h']);
    expect(r.whole).toEqual({ reachedEmail: 5, clean: 0, noMustFailed: 1 }); // the greeted one; the thin card's hook no longer stands on it
  });

  test('a small batch: the newest, or the leads of one run; the time each step took; where the companies came from', () => {
    const older = good('older.example', { prospect: { promotedAt: at(90), foundAt: at(91) }, lead: { createdAt: at(90), touches: [{ at: at(90), note: 'filed by lead run run-old' }] }, card: { at: at(80) }, draft: { at: at(79), sentAt: at(78.5), state: 'sent' } });
    const leads = [good('one.example'), good('two.example'), older];
    expect(review(leads, { size: 2 })).toMatchObject({ size: 2, of: 3, rows: [{ domain: 'one.example' }, { domain: 'two.example' }] });
    const run = review(leads, { run: 'run-old' });
    expect(run).toMatchObject({ size: 1, of: 1, run: 'run-old', rows: [{ domain: 'older.example', times: { address: 3600, research: 36000, email: 3600, sent: 1800 } }] });
    expect(run.steps.map((s) => [s.id, s.median, s.whose])).toEqual([['address', 3600, 'the run'], ['research', 36000, 'the sales member'], ['email', 3600, 'the sales member'], ['sent', 1800, 'you']]);
    expect([timeWords(8), timeWords(600), timeWords(36000), timeWords(259200), timeWords(null)]).toEqual(['8 s', '10 min', '10 h', '3 days', 'not measured']);
    expect(reviewBatch(read(leads), { segmentId: 's-nope' })).toBeNull();
    // Discovery: a source is judged once fifty of its companies were screened.
    const candidates = [...Array.from({ length: 60 }, (_, i) => ({ source: 'hunter-discover', domain: `h${i}.example`, segmentId: 's-1', state: 'scored' })), ...Array.from({ length: 50 }, (_, i) => ({ source: 'apollo-search', domain: `a${i}.example`, segmentId: 's-1', state: 'scored' })), { source: 'tomba-search', domain: 't.example', segmentId: 's-1', state: 'waiting' }];
    const scored = (domain, fit) => ({ segmentId: 's-1', domain, match: fit ? 3 : 1, fit: [{ score: fit ? 5 : 0 }] });
    const prospects = [...candidates.slice(0, 60).map((c, i) => scored(c.domain, i < 2)), ...candidates.slice(60, 110).map((c, i) => scored(c.domain, i < 20))];
    const d = discoveryOf({ candidates, prospects, segmentId: 's-1' });
    expect(d).toMatchObject({ scored: 110, fit: 22, rate: 0.2, grade: 'meets', waiting: 1 });
    expect(d.sources.map((s) => [s.source, s.fit, s.scored, s.grade])).toEqual([['hunter-discover', 2, 60, 'fails'], ['apollo-search', 20, 50, 'meets'], ['tomba-search', 0, 0, 'none']]);
  });

  test('the review in words names every failed check with its companies, and cuts nothing without saying so', () => {
    const words = reviewWords(review([good('one.example'), good('unknown.example', { check: { status: 'unknown' } }), good('never.example', { check: null })]), { examples: 1 });
    expect(words).toMatch(/^PIPELINE REVIEW — "Crypto funds" \(Umbrae — Funding & Raise\): 3 lead\(s\) graded, the newest of 3\./);
    expect(words).toContain('VALIDATION — 1 of 3 meet the standard (33%), 0 weak, 2 FAIL.');
    expect(words).toContain('  · MUST — A checker confirmed the address exists (valid). FAILED BY 2: unknown.example (Apollo: unknown) | and 1 more');
    expect(words).toContain('THE WHOLE ROAD — 3 of 3 have an email; 1 of those fail no MUST at any stage; 1 meet every check of every stage.');
    expect(words).toMatch(/TIME — screened as a fit → lead filed with a confirmed address: 36 s typical/);
    expect(gradeLead({ lead: { name: 'x' } }).grades).toEqual({ filter: 'none', address: 'none', validate: 'none', research: 'none', email: 'none' });
  });
});
