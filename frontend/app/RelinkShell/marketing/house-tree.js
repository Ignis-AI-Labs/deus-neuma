// house-tree.js — the HOUSE RAIL's pure law (Design note, 2026-11-12: […], and […]). The whole house on one
// rail: every company in its tree, each company's campaigns and accounts
// under it, what names no company last as UNSORTED — and where each may be
// moved. Campaigns joined the rail on Founder's word the same day ([…]).
//
// Pure throughout.

import { accountMarkWords } from '../accounts/account-words.js';

/**
 * The rail's rows, top to bottom: HOUSE, then each company (tree order, as
 * the house reads it) followed by its own campaigns and accounts, then
 * UNSORTED with the campaigns and accounts that name no company the house has.
 * @param {{companies: ReadonlyArray<{id: string, name?: string, depth?: number}>,
 *   accounts: ReadonlyArray<{id: string, channelId: string, companyId?: ?string}>,
 *   campaigns?: ReadonlyArray<{id: string, name: string, companyId?: ?string, status?: string}>}} house
 * @returns {Array<{kind: 'house'|'company'|'unsorted'|'campaign'|'account', key: string, depth: number,
 *   id?: string, name?: string, channelId?: string, companyId?: ?string, status?: string, title?: string}>}
 */
export const houseTreeRows = ({ companies = [], accounts = [], campaigns = [] } = {}) => {
  const known = new Set(companies.map((c) => c.id));
  const campaignRow = (c, depth) => ({
    kind: 'campaign', key: `campaign:${c.id}`, depth, id: c.id, name: c.name, companyId: c.companyId ?? null, status: c.status || 'active',
    title: `campaign · ${c.name}${c.status && c.status !== 'active' ? ` · ${c.status}` : ''}`,
  });
  const accountRow = (a, depth) => {
    const words = accountMarkWords({ accountId: a.id, channelId: a.channelId }, accounts, companies);
    return { kind: 'account', key: `account:${a.id}`, depth, id: a.id, channelId: a.channelId, companyId: a.companyId ?? null, name: words.text, title: words.title };
  };
  const rows = [{ kind: 'house', key: 'house', depth: 0, name: 'HOUSE' }];
  for (const c of companies) {
    const depth = (c.depth || 0) + 1;
    rows.push({ kind: 'company', key: `company:${c.id}`, depth, id: c.id, name: c.name || c.id });
    for (const x of campaigns.filter((k) => k.companyId === c.id)) rows.push(campaignRow(x, depth + 1));
    for (const a of accounts.filter((x) => x.companyId === c.id)) rows.push(accountRow(a, depth + 1));
  }
  const looseCampaigns = campaigns.filter((k) => !k.companyId || !known.has(k.companyId));
  const loose = accounts.filter((a) => !a.companyId || !known.has(a.companyId));
  if (loose.length || looseCampaigns.length) {
    rows.push({ kind: 'unsorted', key: 'unsorted', depth: 1, name: 'UNSORTED' });
    for (const x of looseCampaigns) rows.push(campaignRow(x, 2));
    for (const a of loose) rows.push(accountRow(a, 2));
  }
  return rows;
};

// The companies under one company, however deep. Pure.
const descendantsOf = (companies, companyId) => {
  const below = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of companies) {
      if (!below.has(c.id) && (c.parentId === companyId || below.has(c.parentId))) {
        below.add(c.id);
        grew = true;
      }
    }
  }
  return below;
};

/**
 * Where one company may move: under any company that is not itself or below
 * it (a tree never loops), or to the top. Its current place is marked.
 * @param {ReadonlyArray<{id: string, name?: string, depth?: number, parentId?: ?string}>} companies
 * @param {string} companyId
 * @returns {Array<{id: string, label: string, checked: boolean}>} id 'top' is the top level
 */
export const companyMoveTargets = (companies, companyId) => {
  const self = companies.find((c) => c.id === companyId);
  const below = descendantsOf(companies, companyId);
  return [
    { id: 'top', label: 'TOP LEVEL — its own company', checked: !self?.parentId },
    ...companies.filter((c) => c.id !== companyId && !below.has(c.id))
      .map((c) => ({ id: c.id, label: `${'  '.repeat(c.depth || 0)}${c.depth ? '└ ' : ''}${c.name || c.id}`, checked: self?.parentId === c.id })),
  ];
};

/**
 * Where one account may move: any company of the house, its own marked.
 * @param {ReadonlyArray<{id: string, name?: string, depth?: number}>} companies
 * @param {?string} companyId - the account's company now
 */
export const accountMoveTargets = (companies, companyId) => companies
  .map((c) => ({ id: c.id, label: `${'  '.repeat(c.depth || 0)}${c.depth ? '└ ' : ''}${c.name || c.id}`, checked: c.id === companyId }));

/**
 * Is this row where the operator stands? A campaign row on its own page, an
 * account row at its account level, a company row at its own level, HOUSE at
 * the top. Pure.
 * @param {object} row
 * @param {{companyId: ?string, campaignId?: ?string, account?: ?{accountId?: string}}} here
 */
export const isHere = (row, here) => {
  if (here?.account) return row.kind === 'account' && row.id === here.account.accountId;
  if (here?.campaignId) return row.kind === 'campaign' && row.id === here.campaignId;
  if (row.kind === 'house') return !here?.companyId;
  return row.kind === 'company' && row.id === here?.companyId;
};
