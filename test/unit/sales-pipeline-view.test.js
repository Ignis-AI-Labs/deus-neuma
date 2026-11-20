/**
 * THE SALES HUB AS ONE STRAIGHT LINE (sales-pipeline-view.js) — Design note, 2026-11-18: […]; […]. Eight stages counted over ALL campaigns or one, the stage that waits on the operator marked, and the
 * rows that stand at each. Pure, over the shapes the lead engine route really returns.
 */
import { describe, expect, it } from 'vitest';
import { STAGES, MORE, ALL, LOOSE, pipelineOf, campaignChoices, discoverRows, filterRows, validateRows, listApprovals, sentRows, replyRows, messagesOf, channelOf, emailedBefore } from '../../frontend/app/RelinkShell/company-line/sales-pipeline-view.js';
import { leadThread } from '../../backend/services/sales/lead-thread.js';
import { hubTabs, pickTab } from '../../frontend/app/RelinkShell/positions/positions-view.js';
import { recordNames } from '../../backend/services/sales/record-names.js';

const seg = (id, campaign, state = 'approved', extra = {}) => ({ id, name: `Audience ${id}`, campaign, company: 'umbrae', state, countries: ['US'], positiveCriteria: ['Has a token'], targetRole: 'Founder', offer: 'A pool', customerProblem: 'Thin', why: 'x', ...extra });
const at = (personal, total = personal) => ({ personal, generic: total - personal, total });
const cand = (domain, segmentId, extra = {}) => ({ id: `c-${domain}`, domain, name: domain, segmentId, hunterEmails: at(2), ...extra });
const prospect = (domain, segmentId, match, extra = {}) => ({ id: `p-${domain}`, segmentId, domain, name: domain, match, stage: 'found', people: [], fit: [{ criterion: 'Has a token', score: 4, reasoning: 'it does' }], misfit: [], ...extra });
const lead = (id, status, campaignId, extra = {}) => ({ id, name: `Lead ${id}`, contact: `${id}@x.io`, status, kind: 'buyer', origin: campaignId ? { campaignId, campaign: `Campaign ${campaignId}`, audienceId: 's-1', audience: 'Audience s-1' } : null, ...extra });

const engine = {
  campaigns: [{ id: 'k-ua', name: 'Umbrae UA', company: 'umbrae', state: 'open', channels: [] }, { id: 'k-fund', name: 'Umbrae Funding', company: 'umbrae', state: 'open', channels: [] }],
  segments: [seg('s-1', 'k-ua'), seg('s-2', 'k-fund', 'draft'), seg('s-3', null)],
  candidates: [
    cand('raw.xyz', 's-1', { hunterEmails: at(9, 12) }), cand('kept.xyz', 's-1', { shortlist: 'kept' }), cand('passed.xyz', 's-1', { shortlist: 'passed' }),
    cand('read.xyz', 's-1', { shortlist: 'kept', siteRead: { alive: true } }), cand('dead.xyz', 's-1', { shortlist: 'kept', siteRead: { alive: false } }),
    cand('lead.xyz', 's-1', { siteRead: { alive: true } }), cand('loose.xyz', 's-3'),
  ],
  prospects: [prospect('fit.xyz', 's-1', 3, { people: [{ name: 'Ari', role: 'Founder', email: 'ari@fit.xyz' }] }), prospect('lead.xyz', 's-1', 2, { stage: 'promoted', leadId: 'L1', listApproved: true, people: [{ name: 'Bo', role: 'CEO', email: 'L1@x.io' }] })],
  leads: [lead('L1', 'cold', 'k-ua'), lead('L2', 'contacted', 'k-ua'), lead('L3', 'replied', 'k-ua'), lead('L4', 'contacted', 'k-fund')],
  outbox: { review: true, drafts: [{ id: 'm-1', to: ['L1@x.io'], subject: 'Hi', text: 'words', state: 'waiting' }, { id: 'm-2', to: ['L4@x.io'], subject: 'Hi', text: 'words', state: 'returned', note: 'warmer' }] },
  upkeep: [{ kind: 'follow-up', leadId: 'L2' }, { kind: 'answer', leadId: 'L3', hours: 5, promised: 'two ideas' }],
  searches: [{ segmentId: 's-1', source: 'hunter-discover' }, { segmentId: 's-1', source: 'hunter-discover' }],
  pulled: [],
};
const setup = { done: 12, total: 12, steps: [] };
const deals = [{ id: 'd1', stage: 'proposed' }, { id: 'd2', stage: 'won' }];
const by = (stages) => Object.fromEntries(stages.map((s) => [s.id, s]));

describe('the line: eight stages in order, each counted, the operator\'s marked', () => {
  it('reads SETUP → DISCOVER → FILTER → VALIDATE → EMAILS → SENT → REPLIES → DEALS, and keeps what is not a stage under MORE', () => {
    expect(STAGES.map((s) => s.label)).toEqual(['SETUP', 'DISCOVER', 'FILTER', 'VALIDATE', 'EMAILS', 'SENT', 'REPLIES', 'DEALS']);
    expect(MORE.map((m) => m.label)).toEqual(['CAMPAIGNS', 'ALL PEOPLE', 'COMPANY FACTS', 'MAILBOX', 'SETTINGS', 'THEIR EYES']);
  });

  it('over every campaign: what each stage holds, and where it waits on the operator', () => {
    const s = by(pipelineOf({ engine, view: ALL, setup, deals }));
    expect(s.setup).toMatchObject({ head: 'DONE', you: false });
    expect(s.discover).toMatchObject({ head: '7', unit: 'FOUND', lines: ['2 SEARCHES', '3 AUDIENCES'], you: true, yours: '1 TO APPROVE' });
    expect(s.filter).toMatchObject({ head: '3', unit: 'SHORTLISTED', lines: ['2 TO FILTER', '1 PASSED'], you: false });
    expect(s.validate).toMatchObject({ unit: 'LEADS', you: true, yours: '1 TO APPROVE' });
    expect(s.emails).toMatchObject({ head: '1', unit: 'TO REVIEW', you: true, lines: expect.arrayContaining(['1 RETURNED']) });
    expect(s.sent).toMatchObject({ head: '3', unit: 'WRITTEN', lines: ['1 TO FOLLOW UP'] });
    expect(s.validate.lines).toEqual(['1 TO READ', '1 TO SCORE', '1 TO FILE']);
    expect(s.replies).toMatchObject({ head: '1', unit: 'REPLIED', lines: ['1 TO ANSWER'] });
    expect(s.deals).toMatchObject({ head: '1', unit: 'OPEN', lines: ['1 WON'] });
  });

  it('one campaign at a time: only its audiences, its leads and the emails to them count', () => {
    const fund = by(pipelineOf({ engine, view: 'k-fund', setup, deals }));
    expect(fund.discover).toMatchObject({ head: '0', you: true });
    expect(fund.emails).toMatchObject({ head: '0', you: false, lines: expect.arrayContaining(['1 RETURNED']) });
    expect(fund.sent.head).toBe('1');
    expect(by(pipelineOf({ engine, view: LOOSE, setup })).discover.head).toBe('1');
    // The choices: ALL, each open campaign, and the audiences under none; each marked when something in it waits on the operator.
    expect(campaignChoices(engine).map((c) => [c.id, c.label, c.you])).toEqual([[ALL, 'ALL', true], ['k-ua', 'Umbrae UA', true], ['k-fund', 'Umbrae Funding', true], [LOOSE, 'NO CAMPAIGN', false]]);
  });
});

describe('what stands at each stage, one sheet a stage', () => {
  it('DISCOVER: one row an audience, with its searches and what they found', () => {
    expect(discoverRows(engine, 'k-ua').map((r) => [r.id, r.campaign, r.searches, r.found, r.named])).toEqual([['s-1', 'Umbrae UA', 2, 6, 6]]);
  });

  it('FILTER: the companies at the filter, by where it left them, the most addresses first', () => {
    expect(filterRows(engine, 'k-ua').map((c) => c.domain)).toEqual(['raw.xyz']);
    expect(filterRows(engine, 'k-ua', 'kept').map((c) => c.domain)).toEqual(['kept.xyz', 'read.xyz', 'dead.xyz']);
    expect(filterRows(engine, 'k-ua', 'passed').map((c) => c.domain)).toEqual(['passed.xyz']);
  });

  it('VALIDATE: each company past the filter, its site, its fit, its person, and what is next for it', () => {
    expect(validateRows(engine, 'k-ua').map((r) => [r.domain, r.site, r.fit, r.person?.name ?? null, r.standing])).toEqual([
      // What waits on the operator — a fit not yet on the approved list — stands first, and says so.
      ['fit.xyz', 'ALIVE', 'STRONG MATCH', 'Ari', 'WAITS FOR YOUR APPROVAL'],
      ['lead.xyz', 'ALIVE', 'WEAK MATCH', 'Bo', 'ON THE LIST'],
      ['kept.xyz', 'TO READ', '—', null, 'READ ITS SITE'],
      ['read.xyz', 'ALIVE', 'TO SCORE', null, 'SCORE IT'],
      ['dead.xyz', 'DEAD', '—', null, 'DEAD END'],
    ]);
    // The operator's one press here: the list, by the exact companies when the engine names them, else by its count.
    expect(listApprovals(engine, 'k-ua')).toEqual([expect.objectContaining({ segment: expect.objectContaining({ id: 's-1' }), count: 1 })]);
  });

  it('SENT and REPLIES: everyone written to with what is due, everyone who answered with what was promised', () => {
    expect(sentRows(engine, 'k-ua').map((l) => [l.id, l.due?.kind ?? null])).toEqual([['L2', 'follow-up']]);
    expect(replyRows(engine, ALL).map((l) => [l.id, l.due?.promised])).toEqual([['L3', 'two ideas']]);
  });
});

describe('each message, and the channel it went through (Design note, 2026-11-18', () => {
  const touches = (list) => list.map(([at, extra]) => ({ at, by: 'cro', ...extra }));
  const emailed = { id: 'E1', name: 'Rox', contact: 'rox@doppler.finance', channelId: 'email', status: 'contacted', touches: touches([
    ['2026-11-15T09:00:00Z', { status: 'cold', note: 'filed' }],
    ['2026-11-17T10:00:00Z', { status: 'contacted', direction: 'out', from: 'sales@umbrae.io', note: 'emailed: "A pool for xdp"' }],
    ['2026-11-18T08:00:00Z', { direction: 'in', note: 'Sounds good, send it' }],
  ]) };
  const onX = { id: 'X1', name: 'Lynx_Protocol', contact: 'x.com/Lynx_Protocol', channelId: 'other', status: 'contacted', touches: touches([['2026-11-16T12:00:00Z', { status: 'contacted', note: 'DM on X: a Lynx pool on Umbrae?' }]]) };

  it('the lead\'s history says which way each message went and through what: an email says so; anything else went the lead\'s own way (an x.com contact is X)', () => {
    expect(leadThread(emailed)).toEqual([
      { at: '2026-11-17T10:00:00Z', way: 'out', channel: 'email', note: 'emailed: "A pool for xdp"', from: 'sales@umbrae.io', by: 'cro' },
      { at: '2026-11-18T08:00:00Z', way: 'in', channel: 'email', note: 'Sounds good, send it', from: null, by: 'cro' },
    ]);
    expect(leadThread(onX)).toEqual([{ at: '2026-11-16T12:00:00Z', way: 'out', channel: 'x', note: 'DM on X: a Lynx pool on Umbrae?', from: null, by: 'cro' }]);
  });

  it('an email sent from the outbox opens whole on its row — subject, words, promise; one the history never named still stands', () => {
    const outbox = { review: true, drafts: [
      { id: 'm-2', to: ['rox@doppler.finance'], subject: 'A follow-up', text: 'Second words', state: 'sent', sentAt: '2026-11-19T10:00:00Z', at: '2026-11-19T09:00:00Z' },
      { id: 'm-1', to: ['rox@doppler.finance'], subject: 'A pool for xdp', text: 'Hello Rox,\n\nthe whole email.', promise: 'two short ideas', state: 'sent', sentAt: '2026-11-17T10:00:00Z', at: '2026-11-17T09:00:00Z' },
      { id: 'm-3', to: ['rox@doppler.finance'], subject: 'Waiting', text: 'not sent', state: 'waiting', at: '2026-11-19T11:00:00Z' },
    ] };
    const eng = { outbox, leads: [{ ...emailed, thread: leadThread(emailed) }, { ...onX, channel: 'x', thread: leadThread(onX) }] };
    expect(messagesOf(eng, eng.leads[0]).map((m) => [m.way, m.channel, m.subject, m.text, m.promise])).toEqual([
      ['out', 'email', 'A pool for xdp', 'Hello Rox,\n\nthe whole email.', 'two short ideas'],
      ['in', 'email', null, null, null],
      ['out', 'email', 'A follow-up', 'Second words', null],
    ]);
    expect(channelOf(eng, eng.leads[0])).toBe('email');
    expect(channelOf(eng, eng.leads[1])).toBe('x');
    expect(messagesOf(eng, eng.leads[1])).toMatchObject([{ way: 'out', channel: 'x', note: 'DM on X: a Lynx pool on Umbrae?', text: null }]);
    // A lead nobody wrote to through any record still names the way it is reached.
    expect(channelOf(eng, { contact: 'a@b.io', channel: 'email', thread: [] })).toBe('email');
  });
});

describe('never the same first email twice, on screen (Design note, 2026-11-18', () => {
  it('a staged email to someone already emailed shows when (an outbox send, or one on their lead); none once they wrote last', () => {
    const drafts = [
      { id: 'm-1', to: ['a@x.io'], subject: 'First', state: 'sent', sentAt: '2026-11-17T09:00:00Z' },
      { id: 'm-2', to: ['a@x.io'], subject: 'First, changed', state: 'waiting', at: '2026-11-18T09:00:00Z' },
      { id: 'm-3', to: ['b@y.io'], subject: 'Hi', state: 'waiting' },
      { id: 'm-4', to: ['c@z.io'], subject: 'Hi', state: 'waiting' },
    ];
    const leads = [
      { contact: 'a@x.io', thread: [{ at: '2026-11-17T09:00:00Z', way: 'out', note: 'emailed: "First"' }] },
      { contact: 'b@y.io', thread: [] },
      { contact: 'c@z.io', thread: [{ at: '2026-11-16T09:00:00Z', way: 'out', note: 'emailed: "Hello"' }, { at: '2026-11-17T09:00:00Z', way: 'in', note: 'tell me more' }] },
    ];
    expect(emailedBefore(drafts[1], drafts, leads)).toEqual({ at: '2026-11-17T09:00:00Z', subject: 'First' });
    expect(emailedBefore(drafts[2], drafts, leads)).toBe(null);
    expect(emailedBefore(drafts[3], drafts, leads)).toBe(null);
  });
});

describe('the hub stands on its stages', () => {
  const cro = (done) => ({ office: 'cro', functions: [], connections: [], setup: { done, total: 12 } });
  it('the sales hub\'s tabs are its stages then MORE; it opens on SETUP until set up, then on DISCOVER; older doors still land', () => {
    expect(hubTabs(cro(12)).map((t) => t.id)).toEqual(['setup', 'discover', 'filter', 'validate', 'emails', 'sent', 'replies', 'deals', 'campaigns', 'leads', 'model', 'mailbox', '_switches', '_eyes']);
    expect(pickTab(cro(3), null)).toBe('setup');
    expect(pickTab(cro(12), null)).toBe('discover');
    expect(pickTab(cro(12), '_setup')).toBe('setup');
    expect(pickTab(cro(12), 'emails')).toBe('emails');
    expect(pickTab(cro(12), 'nonsense')).toBe('discover');
  });

  it('a record named in a member\'s words answers to its own name', () => {
    expect(recordNames({ segments: [{ id: 's-1', name: 'Base teams' }], prospects: [{ id: 'p-1', name: 'Polychain' }], campaigns: [{ id: 'k-1', name: 'Funding' }, { id: 'k-2' }] })).toEqual({ 's-1': 'Base teams', 'p-1': 'Polychain', 'k-1': 'Funding' });
  });
});
