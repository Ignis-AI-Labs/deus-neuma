/**
 * The MARKETING overview's folds (overview-fold.js, results-fold.js) on the
 * real store shapes — the house's companies (tree-settled), its accounts,
 * the house check's rows, v2 campaigns, queue entries, the stats sweep's
 * results and the link map. Pure: real inputs, real outputs, no mock.
 */
import { describe, it, expect } from 'vitest';
import { scopeOf, gridOf, bandCounts, postRows, accountMark } from '../../frontend/app/RelinkShell/marketing-overview/overview-fold.js';
import {
  linkTotals, postFacts, campaignCard, treeRollup, angleMatrix, funnelOf,
} from '../../frontend/app/RelinkShell/marketing-overview/results-fold.js';
import { num, whyAbsent } from '../../frontend/app/RelinkShell/marketing-overview/overview-words.js';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const COMPANIES = [
  { id: 'northwind', name: 'Northwind', parentId: null, rootId: 'northwind', depth: 0 },
  { id: 'labs', name: 'Northwind Labs', parentId: 'northwind', rootId: 'northwind', depth: 1 },
  { id: 'brookmere', name: 'Brookmere', parentId: null, rootId: 'brookmere', depth: 0 },
];
const ACCOUNTS = [
  { id: 'bluesky-1', channelId: 'bluesky', channelName: 'Bluesky', companyId: 'northwind' },
  { id: 'x-1', channelId: 'x', channelName: 'X (Twitter)', companyId: 'northwind' },
  { id: 'x-2', channelId: 'x', channelName: 'X (Twitter)', companyId: 'labs' },
  { id: 'x-3', channelId: 'x', channelName: 'X (Twitter)', companyId: 'brookmere' },
  { id: 'x-4', channelId: 'x', channelName: 'X (Twitter)', companyId: null },
];
const CHECK = { accounts: [{ id: 'x-1', inUse: true, clear: true }, { id: 'x-2', inUse: true, clear: false }, { id: 'x-3', inUse: false, clear: null }] };
const CAMPAIGNS = [
  { id: 'c-nw', name: 'Launch', companyId: 'northwind', status: 'active', goal: { kind: 'downloads', label: '' },
    kpi: { metric: 'conversions', target: 100, by: '2026-11-15' }, window: { start: '2026-10-20', end: '2026-10-29' },
    angles: [{ id: 'proof', name: 'proof' }], subs: [{ accountId: 'x-1' }, { accountId: 'bluesky-1' }],
    asks: [{ id: 'a1', from: 'cmo', state: 'open' }] },
  { id: 'c-bm', name: 'Client push', companyId: 'brookmere', status: 'active', angles: [{ id: 'calm', name: 'calm' }], subs: [{ accountId: 'x-3' }], asks: [] },
];
const sent = (id, accountId, extra = {}) => ({ id, channelId: accountId.split('-')[0], accountId, status: 'sent', text: id, sentAt: '2026-10-23T00:00:00Z', ...extra });
const QUEUE = [
  sent('p1', 'x-1', { campaignId: 'c-nw', angleId: 'proof', pillar: 'proof' }),
  sent('p2', 'bluesky-1', { campaignId: 'c-nw', angleId: 'proof', pillar: 'proof' }),
  sent('p3', 'x-3', { campaignId: 'c-bm', angleId: 'calm', pillar: 'calm' }),
  { id: 'd1', channelId: 'x', accountId: 'x-1', status: 'draft', groupId: 'launch', campaignId: 'c-nw', scheduledFor: '2026-10-26T09:00:00Z', text: 'd1', createdAt: '2026-10-24T00:00:00Z' },
  { id: 'd2', channelId: 'x', accountId: 'x-2', status: 'draft', groupId: 'launch', text: 'd2', createdAt: '2026-10-24T00:00:00Z', legal: { open: 1 } },
  { id: 'f1', channelId: 'x', accountId: 'x-1', status: 'failed', text: 'f1', createdAt: '2026-10-22T00:00:00Z' },
];
const RESULTS = {
  posts: {
    p1: { latest: { at: '2026-10-24T06:00:00Z', metrics: { views: 4100, likes: 61, replies: 4, shares: 9 } }, series: [{ at: '2026-10-23T06:00:00Z', metrics: { views: 900 } }, { at: '2026-10-24T06:00:00Z', metrics: { views: 4100 } }] },
    p2: { latest: { at: '2026-10-24T06:00:00Z', metrics: { likes: 8, replies: 1, shares: 2 } }, series: [] },
    p3: { latest: { at: '2026-10-24T06:00:00Z', metrics: { views: 50000, likes: 900 } }, series: [] },
  },
  unavailable: {}, capability: { bluesky: { why: 'Bluesky counts no views' } },
  links: { counts: [{ code: 'k7q2xm', kind: 'click', day: '2026-10-24', count: 61 }, { code: 'k7q2xm', kind: 'download', day: '2026-10-24', count: 22 }] },
};
const LINKS = [{ code: 'k7q2xm', entryId: 'p1', destination: 'https://deusneuma.ai/download/' }];
const totals = linkTotals(LINKS, RESULTS.links.counts);
const factsOf = (e) => postFacts(e, RESULTS, totals);

describe('the pick and the grid', () => {
  it('a core company covers its tree; a subsidiary only itself; ALL is everything', () => {
    expect([...scopeOf(COMPANIES, 'northwind')].sort()).toEqual(['labs', 'northwind']);
    expect([...scopeOf(COMPANIES, 'labs')]).toEqual(['labs']);
    expect(scopeOf(COMPANIES, '')).toBeNull();
  });

  it('one mark per account as the house check found it; platforms from the accounts; unsorted only under ALL', () => {
    const grid = gridOf({ companies: COMPANIES, accounts: ACCOUNTS, check: CHECK, campaigns: CAMPAIGNS, scope: null });
    expect(grid.platforms).toEqual(['bluesky', 'x']);
    expect(grid.rows.map((r) => [r.name, r.cells.x.map((c) => c.mark), r.active])).toEqual([
      ['Northwind', ['clear'], 1], ['Northwind Labs', ['failing'], 0], ['Brookmere', ['idle'], 1],
    ]);
    expect(grid.unsorted[0].cells.x).toEqual([{ accountId: 'x-4', mark: 'idle' }]);
    expect(gridOf({ companies: COMPANIES, accounts: ACCOUNTS, check: CHECK, campaigns: CAMPAIGNS, scope: scopeOf(COMPANIES, 'brookmere') }).unsorted).toEqual([]);
    expect(accountMark('bluesky-1', CHECK)).toBe('idle');
  });

  it('WAITING ON YOU counts, each a door', () => {
    const waiting = { items: [{ kind: 'post' }, { kind: 'post' }, { kind: 'campaign-ask' }, { kind: 'approval' }] };
    expect(bandCounts(waiting, QUEUE, ACCOUNTS)).toEqual({ drafts: 2, groups: 1, asks: 1, legal: 1, failed: 1, unsorted: 1 });
  });

  it('the post filter narrows to what a door counted, within the pick', () => {
    const ctx = { scope: null, companyOfAccount: (id) => ACCOUNTS.find((a) => a.id === id)?.companyId ?? null };
    expect(postRows(QUEUE, { status: 'draft', group: true }, ctx).map((e) => e.id).sort()).toEqual(['d1', 'd2']);
    expect(postRows(QUEUE, { status: 'draft', legal: true }, ctx).map((e) => e.id)).toEqual(['d2']);
    expect(postRows(QUEUE, {}, { ...ctx, scope: scopeOf(COMPANIES, 'brookmere') }).map((e) => e.id)).toEqual(['p3']);
  });
});

describe('what the posts did', () => {
  it('a post\'s facts: unreported is null; clicks and downloads come from its codes', () => {
    expect(factsOf(QUEUE[0])).toMatchObject({ reach: 4100, engaged: 74, clicked: 61, converted: 22 });
    expect(factsOf(QUEUE[1])).toMatchObject({ reach: null, engaged: 11, clicked: null, converted: null });
    expect(num(factsOf(QUEUE[1]).reach)).toBe('—');
    expect(whyAbsent(QUEUE[1], RESULTS)).toBe('Bluesky counts no views');
  });

  it('a campaign card: the funnel says how many posts reported each step; the KPI reads downloads; time against the window; subs lit when staged', () => {
    const card = campaignCard(CAMPAIGNS[0], { queue: QUEUE, results: RESULTS, totals, now: NOW });
    expect(card.funnel).toEqual({
      reach: { value: 4100, reporting: 1, of: 2 }, engaged: { value: 85, reporting: 2, of: 2 },
      clicked: { value: 61, reporting: 1, of: 2 }, converted: { value: 22, reporting: 1, of: 2 },
    });
    expect(card.kpi).toEqual({ metric: 'conversions', target: 100, by: '2026-11-15', value: 22, ratio: 0.22 });
    expect(card.time).toBeCloseTo((NOW - Date.parse('2026-10-20T00:00:00Z')) / (10 * 864e5), 6);
    expect(card.subs).toEqual([{ accountId: 'x-1', staged: true }, { accountId: 'bluesky-1', staged: false }]);
    expect(card.asksForYou).toBe(1);
    // A KPI nobody measures reads null, never a drawn zero.
    expect(campaignCard({ ...CAMPAIGNS[0], kpi: { metric: 'followers', target: 10 } }, { queue: QUEUE, results: RESULTS, totals, now: NOW }).kpi.value).toBeNull();
  });

  it('a tree rolls up within itself only — nothing sums across two trees', () => {
    const cards = CAMPAIGNS.map((c) => campaignCard(c, { queue: QUEUE, results: RESULTS, totals, now: NOW }));
    expect(treeRollup(cards, COMPANIES)).toEqual([
      { rootId: 'northwind', name: 'Northwind', campaigns: 1, reach: 4100, clicked: 61, converted: 22 },
      { rootId: 'brookmere', name: 'Brookmere', campaigns: 1, reach: 50000, clicked: null, converted: null },
    ]);
  });

  it('ANGLE × ACCOUNT: actions per 1,000 seen only where both were reported', () => {
    const m = angleMatrix(CAMPAIGNS, QUEUE, factsOf);
    expect(m.cols).toEqual(['bluesky-1', 'x-1', 'x-3']);
    const proof = m.rows.find((r) => r.angle === 'proof');
    expect(proof.cells.find((c) => c.accountId === 'x-1')).toMatchObject({ posts: 1, reach: 4100, converted: 22, per1k: (22 / 4100) * 1000 });
    expect(proof.cells.find((c) => c.accountId === 'bluesky-1')).toMatchObject({ posts: 1, reach: null, per1k: null });
    expect(funnelOf([]).reach).toEqual({ value: null, reporting: 0, of: 0 });
  });
});
