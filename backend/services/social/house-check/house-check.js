// house-check — the HOUSE SOCIAL CHECK as one report: every account of the
// house, the ones IN USE checked (check-rules.js) and rolled up per company →
// tree → house, every other account and every unconnected platform in the
// OPTIONAL group, shown and never counted (Design note, 2026-10-22: […]).
//
// An account is IN USE when it has keys, a holder, or a part in an active
// campaign. A company is clear when every in-use account of it is; a tree's
// numbers are its companies' only, and nothing sums across two trees except
// the house's own total. An account whose company is not one of the house's
// stands UNSORTED, apart from every tree, and counts in the house total.
//
// Pure throughout; the facts are house-check-facts.js.

import { checkAccount, isClear } from './check-rules.js';

/**
 * Why an account is in use — empty when it is not. Pure.
 * @param {{account: {configured: boolean}, holder: ?object, campaigns: string[]}} facts
 * @returns {string[]}
 */
const inUseReasons = ({ account, holder, campaigns }) => [
  ...(account.configured ? ['has keys'] : []),
  ...(holder ? ['has a holder'] : []),
  ...(campaigns.length ? [`in ${campaigns.length} active campaign(s)`] : []),
];

const tally = (rows) => ({ clear: rows.filter((r) => r.clear).length, total: rows.length });

const handleOf = ({ account, probe }) => {
  const named = account.expectedHandle || (probe?.ok === true ? probe.account?.name : null);
  return named ? `@${String(named).replace(/^@/, '')}` : null;
};

// pure — one account's line in the report.
const rowOf = (facts) => {
  const { account } = facts;
  const reasons = inUseReasons(facts);
  const base = {
    id: account.id,
    channelId: account.channelId,
    channelName: account.channelName,
    companyId: account.companyId,
    label: account.label,
    handle: handleOf(facts),
    inUse: reasons.length > 0,
    reasons,
  };
  if (!base.inUse) return { ...base, clear: null, checks: [] };
  const checks = checkAccount(facts);
  return { ...base, clear: isClear(checks), checks };
};

/**
 * The house's social check. Pure.
 * @param {{accounts: object[], companies: object[], channels: Array<{id: string, name: string}>,
 *   checkedAt: string, probed: boolean}} input - accounts: one facts object per account
 *   (house-check-facts.js); companies: the house's, tree-ordered (companies.js)
 */
export const buildHouseCheck = ({ accounts, companies, channels, checkedAt, probed }) => {
  const rows = accounts.map(rowOf);
  const required = rows.filter((r) => r.inUse);
  const known = new Map(companies.map((c) => [c.id, c]));
  const companyRows = companies.map((c) => {
    const theirs = required.filter((r) => r.companyId === c.id);
    return {
      id: c.id, name: c.name, parentId: c.parentId, rootId: c.rootId, depth: c.depth,
      ...tally(theirs), accounts: theirs.map((r) => r.id),
    };
  });
  const trees = companies.filter((c) => c.depth === 0).map((root) => {
    const members = companyRows.filter((c) => c.rootId === root.id);
    const theirs = required.filter((r) => known.get(r.companyId)?.rootId === root.id);
    return { rootId: root.id, name: root.name, ...tally(theirs), companies: members.map((c) => c.id) };
  });
  const unsorted = required.filter((r) => !known.has(r.companyId));
  const connected = new Set(rows.map((r) => r.channelId));
  const optional = {
    accounts: rows.filter((r) => !r.inUse).map((r) => r.id),
    platforms: channels.filter((c) => !connected.has(c.id)).map((c) => c.id),
  };
  const house = { ...tally(required), optional: optional.accounts.length + optional.platforms.length };
  return {
    checkedAt,
    probed,
    house,
    headline: headlineOf(house),
    trees,
    companies: companyRows,
    unsorted: { ...tally(unsorted), accounts: unsorted.map((r) => r.id) },
    optional,
    accounts: rows,
    // Every platform's name, so a platform with no account is named, not coded.
    channelNames: Object.fromEntries(channels.map((c) => [c.id, c.name])),
  };
};

/** […] — the house's line. Pure. */
const headlineOf = ({ clear, total, optional }) => [
  total ? `${clear} OF ${total} ACCOUNTS CLEAR` : 'NO ACCOUNTS IN USE',
  ...(optional ? [`${optional} OPTIONAL`] : []),
].join(' · ');
