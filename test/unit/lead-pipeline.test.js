/**
 * THE LEAD PIPELINE (lead-pipeline.js) — Design note, 2026-11-16/17: […]; […]; […].
 * Where an audience's companies stand step by step, its one next step, exactly what stands at each
 * step by id, and the same road on the seat's briefing and the operator's desk. Pure, over the record
 * shapes the house keeps.
 */
import { describe, expect, it } from 'vitest';
import { audiencePipeline, pipelineLine, stepItems, PIPELINE_RULE, STEPS } from '../../backend/services/sales/lead-pipeline.js';
import { segmentRows, roadSteps } from '../../frontend/app/RelinkShell/company-line/lead-engine-view.js';
import { leadEngineText } from '../../backend/services/sales/sales-briefing.js';
import { outboxText, foldOutbox } from '../../backend/services/sales/email-outbox.js';
import { outboxStats } from '../../frontend/app/RelinkShell/company-line/outbox-view.js';

const segment = { id: 's-1', name: 'Umbrae token teams', state: 'approved', countries: ['US'], positiveCriteria: ['Has a token on Base'], targetRole: 'Founder', offer: 'A pool', customerProblem: 'Thin', why: 'x' };
const alive = { alive: true, description: 'A DeFi protocol', emails: [] };
const at = (personal) => ({ personal, generic: 0, total: personal });
const candidates = [
  { domain: 'raw.xyz', name: 'Raw', segmentId: 's-1', hunterEmails: at(9) },
  { domain: 'passed.xyz', name: 'Passed', segmentId: 's-1', shortlist: 'passed' },
  { domain: 'kept.xyz', name: 'Kept', segmentId: 's-1', shortlist: 'kept', hunterEmails: at(4) },
  { domain: 'dead.xyz', name: 'Dead', segmentId: 's-1', shortlist: 'kept', siteRead: { alive: false, why: 'no answer' } },
  { domain: 'live.xyz', name: 'Live', segmentId: 's-1', shortlist: 'kept', siteRead: alive },
  { domain: 'fit.xyz', name: 'Fit', segmentId: 's-1', siteRead: alive },
  { domain: 'lead.xyz', name: 'Lead', segmentId: 's-1', siteRead: alive },
  { domain: 'staged.xyz', name: 'Staged', segmentId: 's-1', siteRead: alive },
];
const scored = (domain, match, extra = {}) => ({ id: `p-${domain}`, segmentId: 's-1', domain, name: domain, match, stage: 'found', fit: [], people: [], ...extra });
const prospects = [
  scored('fit.xyz', 3),
  scored('lead.xyz', 2, { stage: 'promoted', leadId: 'L1', people: [{ name: 'Ari', role: 'Founder', email: 'ari@lead.xyz' }] }),
  scored('staged.xyz', 3, { stage: 'promoted', leadId: 'L2', people: [{ name: 'Bo', role: 'CEO', email: 'bo@staged.xyz' }] }),
];
const leads = [{ id: 'L1', status: 'cold', contact: 'ari@lead.xyz', name: 'Ari' }, { id: 'L2', status: 'cold', contact: 'bo@staged.xyz', name: 'Bo' }];
const drafts = [{ id: 'd-1', to: ['bo@staged.xyz'], subject: 'Pools', state: 'waiting' }, { id: 'd-0', to: ['old@x.io'], subject: 'Hi', state: 'sent', sentAt: '2026-11-16T10:00:00Z' }];
const state = { segment, candidates, prospects, leads, drafts, searches: [{ segmentId: 's-1', source: 'hunter-discover' }] };

describe('an audience on the road, step by step: gather, filter, verify, score …', () => {
  it('every company counted where it stands', () => {
    expect(STEPS.map((s) => s.label)).toEqual(['GATHER', 'FILTER', 'VERIFY', 'SCORE', 'CONTACTS', 'LEADS', 'APPROVE', 'OUTREACH']);
    expect(audiencePipeline(state).steps).toEqual({
      discover: { searches: 1, gathered: 8, due: 0 },
      filter: { kept: 3, passed: 1, unsorted: 1, due: 1 },
      verify: { unread: 1, alive: 4, dead: 1, due: 1 },
      score: { toScore: 1, strong: 2, weak: 1, none: 0, due: 1 },
      contacts: { fits: 3, withPeople: 2, due: 1 },
      leads: { toFile: 0, leads: 2, due: 0 },
      approve: { waiting: 3, approved: 0, due: 0 },
      // the email staged for the operator is written: it waits on them, not on the seat
      outreach: { unwritten: 1, staged: 1, written: 0, replied: 0, due: 1 },
    });
  });

  it('the next step is the work closest to a sent email, then back up the road: score before reading more, read the shortlist before filtering more', () => {
    const next = (over) => audiencePipeline({ ...state, ...over }).next;
    expect(next({})).toMatchObject({ id: 'outreach', count: 1 });
    const done = { leads: leads.map((l) => ({ ...l, status: 'contacted' })) };
    expect(next(done)).toMatchObject({ id: 'contacts', count: 1 });
    expect(next({ ...done, prospects: [] })).toMatchObject({ id: 'score', count: 4 });
    expect(next({ ...done, prospects: [], candidates: candidates.slice(0, 4) })).toMatchObject({ id: 'verify', count: 1 });
    expect(next({ ...done, prospects: [], candidates: candidates.slice(0, 2) })).toMatchObject({ id: 'filter', count: 1 });
    expect(next({ ...done, prospects: [], candidates: [candidates[1]] }).words).toMatch(/^GATHER: every company found so far is worked — search again/);
    expect(next({ prospects: [], leads: [], candidates: [], searches: [] }).words).toMatch(/^GATHER: this audience has no search of its own yet/);
    expect(audiencePipeline({ segment: { ...segment, state: 'draft' }, candidates }).next.words).toMatch(/pitch waits for the operator's approval/);
  });

  it('exactly what stands at each step, by id — the companies to filter (most addresses first), the fits to file with their top person, the leads to write and which have an email staged', () => {
    expect(stepItems(state, 'filter').map((c) => c.domain)).toEqual(['raw.xyz']);
    expect(stepItems(state, 'verify').map((c) => c.domain)).toEqual(['kept.xyz']);
    expect(stepItems(state, 'score').map((c) => c.domain)).toEqual(['live.xyz']);
    expect(stepItems(state, 'contacts').map((p) => p.id)).toEqual(['p-fit.xyz']);
    const held = new Map([['fit.xyz', [{ name: 'Cy', role: 'Founder', email: 'cy@fit.xyz', sourceUrl: 'https://fit.xyz/team' }]]]);
    expect(stepItems({ ...state, held }, 'leads')).toMatchObject([{ id: 'p-fit.xyz', top: { name: 'Cy', email: 'cy@fit.xyz' } }]);
    expect(stepItems(state, 'outreach').map((l) => [l.id, l.domain, l.staged, l.draft])).toEqual([['L1', 'lead.xyz', false, null], ['L2', 'staged.xyz', true, 'd-1']]);
  });
});

describe('the same road on the seat\'s briefing and the operator\'s desk', () => {
  it('the briefing states the rule (filter before a site is read, score what was read, sales/pipeline to see by id) and each audience on one line', () => {
    expect(PIPELINE_RULE).toMatch(/^THE PIPELINE — every audience walks the same road, step by step, never skipping one: 1 GATHER/);
    expect(PIPELINE_RULE).toContain('Narrow the wide net before reading a single site');
    expect(PIPELINE_RULE).toContain('every company read alive is SCORED right after');
    expect(PIPELINE_RULE).toContain('sales/pipeline lists exactly what stands at any step');
    const text = leadEngineText({ segments: [segment], prospects, leads, suppressions: [], candidates, outbox: { review: true, drafts }, now: Date.parse('2026-11-17T00:00:00Z') });
    expect(text).toContain('- [s-1] Umbrae token teams · 1 GATHER 8 found (0 searches) · 2 FILTER 3 shortlisted, 1 passed over, 1 not filtered · 3 VERIFY 4 alive, 1 dead, 1 shortlisted unread · 4 SCORE 2 strong, 1 weak, 0 no fit, 1 to score · 5 CONTACTS people at 2 of 3 fits · 6 LEADS 2 on the list · 7 APPROVE 3 wait for the operator · 8 OUTREACH 0 sent, 0 replied, 1 staged for the operator\'s review, 1 to write — NEXT: OUTREACH:');
  });

  it('the briefing never hides staged emails: past eight, it says how many more and where the whole list is', () => {
    const many = Array.from({ length: 24 }, (_, i) => ({ id: `d-${i}`, to: [`p${i}@x.io`], subject: 's', state: 'waiting' }));
    expect(outboxText({ review: true, drafts: many })).toContain('; and 16 more) — sales/pipeline {step: "outbox"} lists every one, whole.');
  });

  it('the seat changes its own staged email in place (Design note, 2026-11-17: a revision replaces the waiting or returned one, a withdrawn one never goes', () => {
    const draft = (to, subject) => ({ to: [to], subject, text: 'words', by: 'cro' });
    const { drafts } = foldOutbox([
      { type: 'staged', id: 'm-1', draft: draft('a@x.io', 'First') },
      { type: 'revised', id: 'm-1', draft: draft('a@x.io', 'Second') },
      { type: 'staged', id: 'm-2', draft: draft('b@x.io', 'Hello') },
      { type: 'returned', id: 'm-2', note: 'warmer' },
      { type: 'revised', id: 'm-2', draft: draft('c@x.io', 'Hello, Cy') },
      { type: 'staged', id: 'm-3', draft: draft('d@x.io', 'Gone') },
      { type: 'withdrawn', id: 'm-3', why: 'not a fit' },
      { type: 'revised', id: 'm-3', draft: draft('d@x.io', 'Back?') },
    ]);
    expect(drafts.map((d) => [d.id, d.to[0], d.subject, d.state, d.revised ?? 0, d.note ?? d.why ?? null])).toEqual([
      ['m-3', 'd@x.io', 'Gone', 'withdrawn', 0, 'not a fit'], ['m-2', 'c@x.io', 'Hello, Cy', 'waiting', 1, null], ['m-1', 'a@x.io', 'Second', 'waiting', 1, null],
    ]);
    expect(outboxText({ review: true, drafts })).toContain('To change one, stage it again: it REPLACES the waiting email in place (same id, checked again) — the operator never has to return it first. sales/withdraw-email takes one back.');
  });

  it('an uncertain outbox event leaves nothing waiting to resend and says maybe sent', () => {
    const box = foldOutbox([
      { type: 'staged', id: 'm-u', draft: { to: ['uma@x.io'], subject: 'Hello', text: 'words', by: 'cro' } },
      { type: 'uncertain', id: 'm-u', from: 'sales@x.io', at: '2026-11-17T00:00:00.000Z' },
      { type: 'edited', id: 'm-u', subject: 'A blind retry' },
    ]);
    expect(box.drafts[0]).toMatchObject({ id: 'm-u', state: 'uncertain', subject: 'Hello' });
    expect(outboxText(box)).toMatch(/MAYBE SENT \[m-u\][\s\S]*do not resend this draft/);
    expect(outboxStats(box.drafts)).toContainEqual({ text: '1 MAYBE SENT', tone: 'alert' });
  });

  it('the desk draws the eight steps, the next one lit, the operator\'s own marked (the list to approve, the emails to review)', () => {
    const [row] = segmentRows({ segments: [segment], prospects, candidates, leads, searches: [], pulled: ['fit.xyz'], outbox: { drafts } });
    expect(pipelineLine(row.road)).toContain('5 CONTACTS people at 3 of 3 fits');
    expect(row.listableIds).toEqual(['p-fit.xyz', 'p-lead.xyz', 'p-staged.xyz']);
    expect(row.listable).toBe(row.listableIds.length);
    const drawn = roadSteps(row.road);
    expect(drawn.map((s) => [s.label, s.next, Boolean(s.you)])).toEqual([
      ['GATHER', false, false], ['FILTER', false, false], ['VERIFY', false, false], ['SCORE', false, false], ['CONTACTS', false, false],
      ['LEADS', false, false], ['APPROVE', false, true], ['OUTREACH', true, true],
    ]);
    expect(drawn[1].words).toBe('3 SHORTLISTED · 1 PASSED · 1 TO FILTER');
    expect(drawn[7].words).toBe('0 SENT · 0 REPLIED · 1 FOR YOUR REVIEW · 1 TO WRITE');
  });

  it('the approval ids are exactly the eligible companies, never the whole displayed pool', () => {
    const extra = [
      scored('none.xyz', 1), scored('dropped.xyz', 3, { stage: 'dropped' }),
      scored('listed.xyz', 3, { listApproved: true }), scored('foreign.xyz', 3, { segmentId: 's-2' }),
    ];
    const [row] = segmentRows({ segments: [segment], prospects: [...prospects, ...extra] });
    expect(row.pool.map((p) => p.id)).toContain('p-none.xyz');
    expect(row.listableIds).toEqual(['p-fit.xyz', 'p-lead.xyz', 'p-staged.xyz']);
    expect(segmentRows({ segments: [{ ...segment, state: 'draft' }], prospects }).every((r) => r.listableIds.length === 0)).toBe(true);
  });
});
