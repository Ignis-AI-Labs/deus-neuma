// zoom-fold.js — the MARKETING window's zoom down the company tree
// (marketing-panel-plan.md §2): where the operator stands (HOUSE, or a
// company at any depth), the path back up, the tiles a level shows (each
// top-level company at HOUSE, each subsidiary under a company), which tabs a
// level carries, and where a card's landing puts them. Pure.
//
// Trees never sum together (results-fold.js treeRollup's rule): a tile's
// numbers are its own subtree's only, and two top-level companies are two
// tiles, never one total.

import { subtreeOf, inScope, accountOf, accountMark } from '../marketing-overview/overview-fold.js';
import { settleAccount } from './account-level.js';

/** The tabs of a level: every level narrows the same five; SEAT (the CMO and the mandate) is the house's alone. */
export const TABS = Object.freeze({
  house: Object.freeze(['board', 'campaigns', 'accounts', 'brand', 'leads', 'seat']),
  company: Object.freeze(['board', 'campaigns', 'accounts', 'brand', 'leads']),
});

export const TAB_LABELS = Object.freeze({
  board: 'BOARD', campaigns: 'CAMPAIGNS', accounts: 'ACCOUNTS', brand: 'BRAND', leads: 'LEADS', seat: 'SEAT',
});

/** The house level, on its board. */
export const HOUSE = Object.freeze({ companyId: null, tab: 'board', campaignId: null, account: null });

/**
 * A place made true for this house: a company the house no longer holds, or a
 * tab its level does not carry, falls back (to HOUSE, to BOARD) — never a
 * dead view. An account level (account-level.js) stands under the account's
 * own company. Pure.
 * @param {?{companyId?: ?string, tab?: string, campaignId?: ?string, account?: ?object}} place
 * @param {Array<{id: string}>} companies
 * @param {Array<object>} [accounts] - the house's accounts (an account level needs them)
 */
export const settlePlace = (place, companies, accounts = []) => {
  const at = place?.account ? settleAccount(place.account, { accounts, companies }) : null;
  if (at) return { companyId: at.companyId, tab: 'board', campaignId: null, account: at.account };
  const companyId = place?.companyId && companies.some((c) => c.id === place.companyId) ? place.companyId : null;
  const tabs = companyId ? TABS.company : TABS.house;
  const tab = tabs.includes(place?.tab) ? place.tab : 'board';
  return { companyId, tab, campaignId: tab === 'campaigns' ? place?.campaignId || null : null, account: null };
};

/**
 * The path from the top of the tree down to a company: each crumb a door
 * back up. HOUSE is not in it (the window draws it first, always). Pure.
 * @param {Array<{id: string, name: string, parentId: ?string}>} companies
 * @param {?string} companyId
 * @returns {Array<{id: string, name: string}>}
 */
export const pathOf = (companies, companyId) => {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const out = [];
  for (let c = byId.get(companyId); c && !out.some((x) => x.id === c.id); c = byId.get(c.parentId)) out.unshift({ id: c.id, name: c.name });
  return out;
};

/** A company's legal form as recorded on its kit, or null. */
const legalWords = (company) => (company?.legalEntity
  ? [company.legalEntity.name, company.legalEntity.jurisdiction].filter(Boolean).join(' · ')
  : null);

/** One subtree's numbers: its accounts' marks, its active campaigns, what waits on the operator there. */
const numbersOf = ({ inIt, accounts, check, campaigns, queue }) => {
  const own = accounts.filter((a) => inIt(a.companyId));
  const marks = { clear: 0, failing: 0, idle: 0 };
  for (const a of own) marks[accountMark(a.id, check)] += 1;
  const ownIds = new Set(own.map((a) => a.id));
  const entries = (queue || []).filter((e) => ownIds.has(accountOf(e)));
  const theirs = campaigns.filter((c) => inIt(c.companyId));
  return {
    accounts: { ...marks, total: own.length },
    active: theirs.filter((c) => c.status === 'active').length,
    campaigns: theirs.length,
    waiting: {
      drafts: entries.filter((e) => e.status === 'draft' && !e.placeholder).length,
      asks: theirs.reduce((n, c) => n + (c.asks || []).filter((a) => a.state === 'open' && a.from === 'cmo').length, 0),
      failed: entries.filter((e) => e.status === 'failed').length,
    },
  };
};

/**
 * One company's tile: its name, its legal form, the companies under it
 * (indented by depth below it), and its subtree's numbers. Pure.
 * @param {object} company - a settled company
 * @param {{companies: object[], accounts: object[], check: ?object, campaigns: object[], queue: object[]}} house
 */
const tileOf = (company, house) => {
  const scope = subtreeOf(house.companies, company.id);
  return {
    id: company.id,
    name: company.name,
    legal: legalWords(company),
    subs: house.companies.filter((c) => c.id !== company.id && scope.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, depth: (c.depth || 0) - (company.depth || 0) })),
    ...numbersOf({ ...house, inIt: (companyId) => inScope(scope, companyId) }),
  };
};

/**
 * The HOUSE level's tiles: every top-level company (a core company with its
 * tree folded in; a client company on its own), then NO COMPANY when any
 * account stands under none. Pure.
 * @param {{companies: object[], accounts: object[], check: ?object, campaigns: object[], queue: object[]}} house
 */
export const houseTiles = (house) => {
  const known = new Set(house.companies.map((c) => c.id));
  const loose = (companyId) => !companyId || !known.has(companyId);
  const roots = house.companies.filter((c) => !c.parentId).map((c) => tileOf(c, house));
  const unsorted = house.accounts.filter((a) => loose(a.companyId));
  return unsorted.length
    ? [...roots, { id: null, name: 'NO COMPANY', legal: null, subs: [], ...numbersOf({ ...house, inIt: loose }), accountIds: unsorted.map((a) => a.id) }]
    : roots;
};

/** A company's own subsidiaries as tiles (one step down; each press zooms further). Pure. */
export const childTiles = (companyId, house) => house.companies
  .filter((c) => c.parentId === companyId)
  .map((c) => tileOf(c, house));

/**
 * Where a card's landing puts the operator: a company's tab when the landing
 * names one (a social-check door: that company's BRAND; settlePlace keeps the
 * tab honest), a campaign's page on its company's CAMPAIGNS tab (the house's
 * own when it has no company), or SEAT when the landing names no campaign (a
 * paused mandate). Null while the campaign is not read yet. Pure.
 * @param {?{campaignId?: string, seat?: boolean, tab?: string, companyId?: ?string}} item
 * @param {?object[]} campaigns - null while unread
 */
export const landingPlace = (item, campaigns) => {
  if (!item) return null;
  if (item.tab) return { companyId: item.companyId || null, tab: item.tab, campaignId: null, account: null };
  if (!item.campaignId) return { companyId: null, tab: 'seat', campaignId: null, account: null };
  if (!campaigns) return null;
  const campaign = campaigns.find((c) => c.id === item.campaignId);
  return { companyId: campaign?.companyId || null, tab: 'campaigns', campaignId: campaign ? campaign.id : null, account: null };
};
