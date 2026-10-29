/**
 * The MARKETING window's zoom down the company tree (zoom-fold.js), the
 * subtree scope and the scoped WAITING band (overview-fold.js), the social
 * check narrowed to a company (social-check-view.js) and the seat's title
 * (use-cmo-seat.js) — on the real store shapes: tree-settled companies with a
 * three-level holding company and a separate client, accounts (one under no
 * company), the house check's rows, v2 campaigns, queue entries, the desk's
 * waiting items. Pure: real inputs, real outputs, no mock.
 */
import { describe, it, expect } from 'vitest';
import {
  HOUSE, TABS, settlePlace, pathOf, houseTiles, childTiles, landingPlace,
} from '../../frontend/app/RelinkShell/marketing/zoom-fold.js';
import { subtreeOf, scopeOf, bandCounts } from '../../frontend/app/RelinkShell/marketing-overview/overview-fold.js';
import { narrowCheck, overviewRows } from '../../frontend/app/RelinkShell/social-check/social-check-view.js';
import { seatTitle } from '../../frontend/app/RelinkShell/marketing/use-cmo-seat.js';

const COMPANIES = [
  { id: 'brookmere', name: 'Brookmere', parentId: null, rootId: 'brookmere', depth: 0, legalEntity: null },
  { id: 'northwind', name: 'Northwind', parentId: null, rootId: 'northwind', depth: 0, legalEntity: { name: 'Northwind Holdings LLC', jurisdiction: 'Delaware' } },
  { id: 'labs', name: 'Northwind Labs', parentId: 'northwind', rootId: 'northwind', depth: 1, legalEntity: null },
  { id: 'studio', name: 'Northwind Studio', parentId: 'labs', rootId: 'northwind', depth: 2, legalEntity: { name: 'Studio GmbH', jurisdiction: null } },
];
const ACCOUNTS = [
  { id: 'x-1', channelId: 'x', companyId: 'northwind' },
  { id: 'x-2', channelId: 'x', companyId: 'labs' },
  { id: 'x-3', channelId: 'x', companyId: 'studio' },
  { id: 'x-4', channelId: 'x', companyId: 'brookmere' },
  { id: 'bluesky-1', channelId: 'bluesky', companyId: null },
];
const CHECK = { accounts: [{ id: 'x-1', inUse: true, clear: true }, { id: 'x-2', inUse: true, clear: false }, { id: 'x-4', inUse: true, clear: true }] };
const CAMPAIGNS = [
  { id: 'c-nw', companyId: 'northwind', status: 'active', asks: [{ id: 'a1', from: 'cmo', state: 'open' }] },
  { id: 'c-st', companyId: 'studio', status: 'draft', asks: [{ id: 'a2', from: 'cmo', state: 'open' }, { id: 'a3', from: 'operator', state: 'open' }] },
  { id: 'c-bm', companyId: 'brookmere', status: 'active', asks: [] },
  { id: 'c-old', companyId: null, status: 'active', asks: [] },
];
const QUEUE = [
  { id: 'd1', channelId: 'x', accountId: 'x-1', status: 'draft' },
  { id: 'd2', channelId: 'x', accountId: 'x-3', status: 'draft', groupId: 'g', legal: { open: 1 } },
  { id: 'd3', channelId: 'x', accountId: 'x-4', status: 'draft' },
  { id: 'ph', channelId: 'x', accountId: 'x-2', status: 'draft', placeholder: true },
  { id: 'f1', channelId: 'x', accountId: 'x-2', status: 'failed' },
  { id: 'f2', channelId: 'bluesky', accountId: 'bluesky-1', status: 'failed' },
];
const HOUSE_READ = { companies: COMPANIES, accounts: ACCOUNTS, check: CHECK, campaigns: CAMPAIGNS, queue: QUEUE };

describe('the subtree scope — a company and everything under it, at any depth', () => {
  it('a holding company covers all three levels; a middle one its own subtree; a leaf itself; ALL is everything', () => {
    expect([...subtreeOf(COMPANIES, 'northwind')].sort()).toEqual(['labs', 'northwind', 'studio']);
    expect([...scopeOf(COMPANIES, 'labs')].sort()).toEqual(['labs', 'studio']);
    expect([...scopeOf(COMPANIES, 'studio')]).toEqual(['studio']);
    expect(scopeOf(COMPANIES, '')).toBeNull();
    // Two trees never mix: the client company's scope holds none of the holding company's.
    expect([...scopeOf(COMPANIES, 'brookmere')]).toEqual(['brookmere']);
  });
});

describe('the path and the place', () => {
  it('the path runs from the top of the tree down to the company; HOUSE has none', () => {
    expect(pathOf(COMPANIES, 'studio')).toEqual([{ id: 'northwind', name: 'Northwind' }, { id: 'labs', name: 'Northwind Labs' }, { id: 'studio', name: 'Northwind Studio' }]);
    expect(pathOf(COMPANIES, null)).toEqual([]);
    expect(pathOf(COMPANIES, 'gone')).toEqual([]);
  });

  it('a place is made true for this house: a company it no longer holds is HOUSE, SEAT only at HOUSE, a campaign only on CAMPAIGNS', () => {
    expect(settlePlace({ companyId: 'labs', tab: 'brand' }, COMPANIES)).toEqual({ companyId: 'labs', tab: 'brand', campaignId: null, account: null });
    expect(settlePlace({ companyId: 'gone', tab: 'leads' }, COMPANIES)).toEqual({ companyId: null, tab: 'leads', campaignId: null, account: null });
    expect(settlePlace({ companyId: 'labs', tab: 'seat' }, COMPANIES)).toEqual({ companyId: 'labs', tab: 'board', campaignId: null, account: null });
    expect(settlePlace({ companyId: null, tab: 'seat' }, COMPANIES).tab).toBe('seat');
    expect(settlePlace({ companyId: 'northwind', tab: 'campaigns', campaignId: 'c-nw' }, COMPANIES).campaignId).toBe('c-nw');
    expect(settlePlace({ companyId: 'northwind', tab: 'board', campaignId: 'c-nw' }, COMPANIES).campaignId).toBeNull();
    expect(settlePlace(null, COMPANIES)).toEqual(HOUSE);
    expect(TABS.house).toContain('seat');
    expect(TABS.company).not.toContain('seat');
  });

  it('a landing: a campaign\'s page on its company\'s CAMPAIGNS (the house\'s with no company); no campaign named = SEAT; unread bench waits', () => {
    expect(landingPlace({ campaignId: 'c-st' }, CAMPAIGNS)).toEqual({ companyId: 'studio', tab: 'campaigns', campaignId: 'c-st', account: null });
    expect(landingPlace({ campaignId: 'c-old' }, CAMPAIGNS)).toEqual({ companyId: null, tab: 'campaigns', campaignId: 'c-old', account: null });
    expect(landingPlace({ campaignId: 'gone' }, CAMPAIGNS)).toEqual({ companyId: null, tab: 'campaigns', campaignId: null, account: null });
    expect(landingPlace({ seat: true }, null)).toEqual({ companyId: null, tab: 'seat', campaignId: null, account: null });
    expect(landingPlace({ campaignId: 'c-nw' }, null)).toBeNull();
    expect(landingPlace(null, CAMPAIGNS)).toBeNull();
    // A door naming a company's tab (the social check's SITE & CODE) lands there, campaigns read or not.
    expect(landingPlace({ companyId: 'studio', tab: 'brand' }, null)).toEqual({ companyId: 'studio', tab: 'brand', campaignId: null, account: null });
    expect(landingPlace({ companyId: null, tab: 'brand' }, CAMPAIGNS)).toEqual({ companyId: null, tab: 'brand', campaignId: null, account: null });
  });
});

describe('the tiles — each top-level company with its tree folded in, never summed across trees', () => {
  it('HOUSE: one tile per top-level company, then NO COMPANY; each tile its own subtree\'s numbers', () => {
    const tiles = houseTiles(HOUSE_READ);
    expect(tiles.map((t) => t.id)).toEqual(['brookmere', 'northwind', null]);
    const north = tiles[1];
    expect(north.legal).toBe('Northwind Holdings LLC · Delaware');
    expect(north.subs).toEqual([{ id: 'labs', name: 'Northwind Labs', depth: 1 }, { id: 'studio', name: 'Northwind Studio', depth: 2 }]);
    expect(north.accounts).toEqual({ clear: 1, failing: 1, idle: 1, total: 3 });
    expect([north.active, north.campaigns]).toEqual([1, 2]);
    // The placeholder is not a decision; the operator's own ask is not one the CMO put to them.
    expect(north.waiting).toEqual({ drafts: 2, asks: 2, failed: 1 });
    expect(tiles[0]).toMatchObject({ name: 'Brookmere', legal: null, subs: [], accounts: { clear: 1, failing: 0, idle: 0, total: 1 }, active: 1, waiting: { drafts: 1, asks: 0, failed: 0 } });
    expect(tiles[2]).toMatchObject({ name: 'NO COMPANY', accountIds: ['bluesky-1'], accounts: { idle: 1, total: 1 }, active: 1, campaigns: 1, waiting: { drafts: 0, asks: 0, failed: 1 } });
    // Nothing anywhere is a sum of two trees: the tiles' drafts are each tree's own.
    expect(tiles.reduce((n, t) => n + t.waiting.drafts, 0)).toBe(3);
  });

  it('a house where every account has a company has no NO COMPANY tile', () => {
    expect(houseTiles({ ...HOUSE_READ, accounts: ACCOUNTS.filter((a) => a.companyId) }).map((t) => t.id)).toEqual(['brookmere', 'northwind']);
  });

  it('under a company: its direct subsidiaries, each carrying the rest of its tree', () => {
    expect(childTiles('northwind', HOUSE_READ).map((t) => [t.id, t.subs.map((s) => [s.id, s.depth])])).toEqual([['labs', [['studio', 1]]]]);
    expect(childTiles('labs', HOUSE_READ)[0]).toMatchObject({ id: 'studio', legal: 'Studio GmbH', waiting: { drafts: 1, asks: 1, failed: 0 } });
    expect(childTiles('studio', HOUSE_READ)).toEqual([]);
  });
});

describe('WAITING ON YOU, narrowed to a company', () => {
  const waiting = { items: [
    { kind: 'post', where: { entryId: 'd1' } }, { kind: 'post', where: { entryId: 'd2' } }, { kind: 'post', where: { entryId: 'd3' } },
    { kind: 'campaign-ask', where: { campaignId: 'c-st' } }, { kind: 'campaign-ask', where: { campaignId: 'c-bm' } },
  ] };
  it('the house counts everything; a company counts its subtree\'s posts and asks only, and never NO COMPANY', () => {
    expect(bandCounts(waiting, QUEUE, ACCOUNTS)).toEqual({ drafts: 3, groups: 1, asks: 2, legal: 1, failed: 2, unsorted: 1 });
    const ctx = (id) => ({ scope: scopeOf(COMPANIES, id), campaigns: CAMPAIGNS });
    expect(bandCounts(waiting, QUEUE, ACCOUNTS, ctx('labs'))).toEqual({ drafts: 1, groups: 1, asks: 1, legal: 1, failed: 1, unsorted: 0 });
    expect(bandCounts(waiting, QUEUE, ACCOUNTS, ctx('brookmere'))).toEqual({ drafts: 1, groups: 0, asks: 1, legal: 0, failed: 0, unsorted: 0 });
  });
});

describe('the social check, narrowed to a company', () => {
  const check = {
    headline: '2 OF 3 ACCOUNTS CLEAR · 1 OPTIONAL',
    trees: [{ rootId: 'northwind', companies: ['northwind', 'labs', 'studio'], clear: 1, total: 2 }, { rootId: 'brookmere', companies: ['brookmere'], clear: 1, total: 1 }],
    companies: [
      { id: 'northwind', name: 'Northwind', depth: 0, clear: 1, total: 1, accounts: ['x-1'] },
      { id: 'labs', name: 'Northwind Labs', depth: 1, clear: 0, total: 1, accounts: ['x-2'] },
      { id: 'studio', name: 'Northwind Studio', depth: 2, clear: 0, total: 0, accounts: [] },
      { id: 'brookmere', name: 'Brookmere', depth: 0, clear: 1, total: 1, accounts: ['x-4'] },
    ],
    unsorted: { clear: 0, total: 1, accounts: ['bluesky-1'] },
    optional: { accounts: ['x-3'], platforms: ['mastodon'] },
    accounts: [
      { id: 'x-1', companyId: 'northwind', inUse: true, clear: true, checks: [] },
      { id: 'x-2', companyId: 'labs', inUse: true, clear: false, checks: [] },
      { id: 'x-3', companyId: 'studio', inUse: false, clear: null, checks: [] },
      { id: 'x-4', companyId: 'brookmere', inUse: true, clear: true, checks: [] },
      { id: 'bluesky-1', companyId: null, inUse: true, clear: false, checks: [] },
    ],
  };
  it('a company sees only its own companies and accounts, its line recounted; the house sees the check as it stands', () => {
    expect(narrowCheck(check, null)).toBe(check);
    const labs = narrowCheck(check, scopeOf(COMPANIES, 'labs'));
    expect(labs.headline).toBe('0 OF 1 ACCOUNTS CLEAR · 1 OPTIONAL');
    expect(overviewRows(labs).map((r) => r.name)).toEqual(['Northwind Labs', 'Northwind Studio']);
    expect(labs.accounts.map((a) => a.id)).toEqual(['x-2', 'x-3']);
    expect(labs.optional).toEqual({ accounts: ['x-3'], platforms: [] });
    const brook = narrowCheck(check, scopeOf(COMPANIES, 'brookmere'));
    expect(brook.headline).toBe('1 OF 1 ACCOUNTS CLEAR');
    expect(overviewRows(brook).map((r) => r.name)).toEqual(['Brookmere']);
  });
});

describe('the title names the seat', () => {
  it('its holder, NO CMO when none is seated, and — while the seat is unread', () => {
    expect(seatTitle({ known: true, cmo: { laneId: 'kestrel' }, name: 'Kestrel' })).toBe('KESTREL');
    expect(seatTitle({ known: true, cmo: { laneId: 'kestrel' }, name: null })).toBe('KESTREL');
    expect(seatTitle({ known: true, cmo: null, name: null })).toBe('NO CMO');
    expect(seatTitle({ known: false, cmo: null, name: null })).toBe('—');
  });
});
