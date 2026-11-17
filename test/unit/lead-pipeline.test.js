/**
 * THE LEAD PIPELINE (lead-pipeline.js) — Design note, 2026-11-16: […] Where an audience's companies stand step by step, its one next step, and the same road on
 * the seat's briefing and the operator's desk. Pure, over the record shapes the house keeps.
 */
import { describe, expect, it } from 'vitest';
import { audiencePipeline, pipelineLine, PIPELINE_RULE, STEPS } from '../../backend/services/sales/lead-pipeline.js';
import { segmentRows, roadSteps } from '../../frontend/app/RelinkShell/company-line/lead-engine-view.js';
import { leadEngineText } from '../../backend/services/sales/sales-briefing.js';

const segment = { id: 's-1', name: 'Umbrae token teams', state: 'approved', countries: ['US'], positiveCriteria: ['Has a token on Base'], targetRole: 'Founder', offer: 'A pool', customerProblem: 'Thin', why: 'x' };
const alive = { alive: true, description: 'A DeFi protocol', emails: [] };
const candidates = [
  { domain: 'unread.xyz', name: 'Unread', segmentId: 's-1' },
  { domain: 'dead.xyz', name: 'Dead', segmentId: 's-1', siteRead: { alive: false, why: 'no answer' } },
  { domain: 'live.xyz', name: 'Live', segmentId: 's-1', siteRead: alive },
  { domain: 'fit.xyz', name: 'Fit', segmentId: 's-1', siteRead: alive },
  { domain: 'lead.xyz', name: 'Lead', segmentId: 's-1', siteRead: alive },
];
const scored = (domain, match, extra = {}) => ({ id: `p-${domain}`, segmentId: 's-1', domain, name: domain, match, stage: 'found', people: [], ...extra });
const prospects = [
  scored('fit.xyz', 3),
  scored('lead.xyz', 2, { stage: 'promoted', leadId: 'L1', people: [{ name: 'Ari', role: 'Founder', email: 'ari@lead.xyz' }] }),
];
const leads = [{ id: 'L1', status: 'cold', contact: 'ari@lead.xyz' }];

describe('an audience on the road, step by step', () => {
  it('every company counted where it stands', () => {
    const { steps } = audiencePipeline({ segment, candidates, prospects, leads, searches: [{ segmentId: 's-1', source: 'hunter-discover' }] });
    expect(steps).toEqual({
      discover: { searches: 1, gathered: 5, due: 0 },
      verify: { unread: 1, alive: 3, dead: 1, due: 1 },
      research: { toScore: 1, strong: 1, weak: 1, none: 0, due: 1 },
      contacts: { fits: 2, withPeople: 1, due: 1 },
      leads: { toFile: 0, leads: 1, due: 0 },
      approve: { waiting: 2, approved: 0, due: 0 },
      outreach: { unwritten: 1, written: 0, replied: 0, due: 1 },
    });
  });

  it('the next step is the work closest to a sent email, then down the road to a new search', () => {
    const next = (over) => audiencePipeline({ segment, candidates, prospects, leads, ...over }).next;
    expect(next({})).toMatchObject({ id: 'outreach', count: 1 });
    expect(next({ leads: [{ ...leads[0], status: 'contacted' }] })).toMatchObject({ id: 'contacts', count: 1 });
    // People at the fit (pulled, top first): it goes on the lead list next.
    expect(next({ leads: [{ ...leads[0], status: 'contacted' }], held: new Map([['fit.xyz', [{ email: 'bo@fit.xyz' }]]]) })).toMatchObject({ id: 'leads', count: 1 });
    expect(next({ prospects: [], leads: [] })).toMatchObject({ id: 'research', count: 3 });
    expect(next({ prospects: [], leads: [], candidates: candidates.slice(0, 2) })).toMatchObject({ id: 'verify', count: 1 });
    expect(next({ prospects: [], leads: [], candidates: [] }).words).toMatch(/^DISCOVER: this audience has no search of its own yet/);
    expect(next({ prospects: [], leads: [], candidates: [candidates[1]] }).words).toMatch(/^DISCOVER: every company found so far is worked — search again/);
    expect(audiencePipeline({ segment: { ...segment, state: 'draft' }, candidates }).next.words).toMatch(/pitch waits for the operator's approval/);
    expect(audiencePipeline({ segment: { ...segment, state: 'paused' }, candidates }).next).toBeNull();
  });

  it('a company gathered before searches were kept on record still counts as found by one', () => {
    expect(audiencePipeline({ segment, candidates, prospects: [], leads: [] }).steps.discover).toEqual({ searches: 0, gathered: 5, due: 0 });
  });
});

describe('the same road on the seat\'s briefing and the operator\'s desk', () => {
  it('the briefing states the rule and each audience on one line with its NEXT step', () => {
    const text = leadEngineText({ segments: [segment], prospects, leads, suppressions: [], candidates, now: Date.parse('2026-11-17T00:00:00Z') });
    expect(text).toContain(PIPELINE_RULE);
    expect(PIPELINE_RULE).toMatch(/^THE PIPELINE — every audience walks the same road, step by step, never skipping one: 1 DISCOVER/);
    expect(STEPS.map((s) => s.id)).toEqual(['discover', 'verify', 'research', 'contacts', 'leads', 'approve', 'outreach']);
    expect(text).toContain('- [s-1] Umbrae token teams · 1 DISCOVER 5 found (0 searches) · 2 VERIFY 3 alive, 1 dead, 1 unread · 3 RESEARCH 1 strong, 1 weak, 0 no fit, 1 to score · 4 CONTACTS people at 1 of 2 fits · 5 LEADS 1 on the list · 6 APPROVE 2 wait for the operator · 7 OUTREACH 0 written, 0 replied, 1 to write — NEXT: OUTREACH:');
  });

  it('the desk draws the seven steps with their counts, the next one lit and the operator\'s own marked', () => {
    const [row] = segmentRows({ segments: [segment], prospects, candidates, leads, searches: [], pulled: ['fit.xyz'] });
    expect(pipelineLine(row.road)).toContain('4 CONTACTS people at 2 of 2 fits');
    const drawn = roadSteps(row.road);
    expect(drawn.map((s) => [s.label, s.next, Boolean(s.you)])).toEqual([
      ['DISCOVER', false, false], ['VERIFY', false, false], ['RESEARCH', false, false], ['CONTACTS', false, false],
      ['LEADS', false, false], ['APPROVE', false, true], ['OUTREACH', true, false],
    ]);
    expect(drawn[1].words).toBe('3 ALIVE · 1 DEAD · 1 UNREAD');
  });
});
