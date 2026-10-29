// account-level.js — MARKETING's deepest zoom level: one platform account
// (marketing-panel-plan.md §2, slice 6: HOUSE › company › … › TIKTOK @handle).
// What was a platform's own window is this level now (retired-windows.js):
// the account's console head, its standing, its board and its queue.
//
// Which account a landing means: the one it names; else the account its post
// speaks as; else the first on that platform under the company it names; else
// the house's first on it. A house with no account on the platform still
// lands — on the platform, where its first account is added. Pure.

import { subtreeOf, inScope } from '../marketing-overview/overview-fold.js';
import { entryAccountId, handleOf } from '../accounts/account-words.js';
import { isMarketingPlatform } from '../../windowing/retired-windows.js';

const companyOfAccount = (account, companies) => (account?.companyId && companies.some((c) => c.id === account.companyId) ? account.companyId : null);

/** The house's accounts on one platform, the given company's first. */
const firstOn = (onIt, companies, companyId) => {
  const scope = companyId && companies.some((c) => c.id === companyId) ? subtreeOf(companies, companyId) : null;
  return (scope && onIt.find((a) => inScope(scope, a.companyId))) || onIt[0] || null;
};

/**
 * An account place made true for this house: a platform MARKETING does not
 * hold (COMMUNITY's) is no account level; an account the house no longer has
 * falls to the platform's first. The level's company is the account's own
 * (HOUSE for an account under none). Pure.
 * @param {?{channelId: string, accountId?: ?string, companyId?: ?string}} spec
 * @param {{accounts: object[], companies: object[]}} house
 * @returns {?{companyId: ?string, account: {channelId: string, accountId: ?string}}}
 */
export const settleAccount = (spec, { accounts, companies }) => {
  if (!spec || !isMarketingPlatform(spec.channelId)) return null;
  const onIt = (accounts || []).filter((a) => a.channelId === spec.channelId);
  const named = spec.accountId ? onIt.find((a) => a.id === spec.accountId) : null;
  const account = named || firstOn(onIt, companies || [], spec.companyId || null);
  const companyId = account ? companyOfAccount(account, companies || [])
    : (spec.companyId && (companies || []).some((c) => c.id === spec.companyId) ? spec.companyId : null);
  return { companyId, account: { channelId: spec.channelId, accountId: account ? account.id : null } };
};

/**
 * Where an account landing puts the operator, with what it opens there (a
 * post's card, a STANDING drawer). Null while a post's account is unread
 * (the queue not read yet), or when it names no account level. Pure.
 * @param {{account: object, entryId?: string, section?: string}} item
 * @param {{accounts: object[], companies: object[], queue: ?object[]}} house
 */
export const accountLanding = (item, { accounts, companies, queue }) => {
  const spec = { ...item.account };
  if (!spec.accountId && item.entryId) {
    if (!queue) return null;
    const entry = queue.find((e) => e.id === item.entryId);
    if (entry) spec.accountId = entryAccountId(entry);
  }
  const settled = settleAccount(spec, { accounts, companies });
  if (!settled) return null;
  return {
    place: { companyId: settled.companyId, tab: 'board', campaignId: null, account: settled.account },
    focus: item.entryId || item.section ? { entryId: item.entryId || null, section: item.section || null } : null,
  };
};

/**
 * The path's last crumb: the platform's name and the account's handle (else
 * its number on the platform; none when the house has no account there). Pure.
 * @param {{channelId: string, accountId: ?string}} account
 * @param {object[]} accounts
 * @returns {{channelId: string, name: string, handle: ?string, title: string}}
 */
export const accountCrumb = ({ channelId, accountId }, accounts) => {
  const account = (accounts || []).find((a) => a.id === accountId) || null;
  const name = String(account?.channelName || channelId).toUpperCase();
  const number = accountId && accountId.startsWith(`${channelId}-`) ? `#${accountId.slice(channelId.length + 1)}` : accountId;
  return {
    channelId,
    name,
    handle: account ? handleOf(account) || number : null,
    title: account ? `${name} · account ${account.id}` : `${name} · no account yet`,
  };
};
