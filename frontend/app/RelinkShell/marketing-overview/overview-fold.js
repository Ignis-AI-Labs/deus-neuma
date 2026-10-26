// overview-fold.js — the MARKETING overview's picture of the house (campaign
// plan §2.6, §5): which companies a pick covers, the COMPANIES × PLATFORMS
// grid (one mark per account: clear, failing, not in use), the WAITING ON YOU
// band's counts (each a door), and the post rows. Pure.
//
// Marks are true (SHINKEI): an account is CLEAR or FAILING only as the house
// social check found it; one the check does not hold in use is hollow.

/**
 * A company and every company under it, to any depth (the parent chains are
 * already settled: company-tree.js). Pure.
 * @param {Array<{id: string, parentId: ?string}>} companies
 * @param {string} id
 * @returns {Set<string>}
 */
export const subtreeOf = (companies, id) => {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of companies) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); grew = true; }
    }
  }
  return out;
};

/**
 * The companies a pick covers: ALL (''), or a company and its subtree (a core
 * company with its subsidiaries, at any depth). Unsorted accounts are only
 * under ALL.
 * @param {Array<{id: string, parentId: ?string}>} companies
 * @param {string} pick
 * @returns {?Set<string>} null = everything
 */
export const scopeOf = (companies, pick) => (pick ? subtreeOf(companies, pick) : null);

/** Is this company id inside the pick? */
export const inScope = (scope, companyId) => scope === null || (companyId != null && scope.has(companyId));

/** The account a queue entry speaks as. */
export const accountOf = (entry) => entry?.accountId || `${entry?.channelId}-1`;

/** The mark of one account, as the house social check found it. */
export const accountMark = (accountId, check) => {
  const row = check?.accounts?.find((a) => a.id === accountId);
  if (!row || !row.inUse) return 'idle';
  return row.clear ? 'clear' : 'failing';
};

/**
 * COMPANIES × PLATFORMS: rows in tree order, a column per platform any
 * account of the house is on, each cell the accounts of that company there.
 * @returns {{platforms: string[], rows: object[], unsorted: object[]}}
 */
export const gridOf = ({ companies, accounts, check, campaigns, scope }) => {
  // The platforms any account of the house is on, in the accounts' own order (no hand-kept list).
  const platforms = [...new Set(accounts.map((a) => a.channelId))];
  const cellsFor = (list) => Object.fromEntries(platforms.map((p) => [p, list.filter((a) => a.channelId === p)
    .map((a) => ({ accountId: a.id, mark: accountMark(a.id, check) }))]));
  const rows = companies.filter((c) => inScope(scope, c.id)).map((c) => ({
    id: c.id, name: c.name, depth: c.depth || 0,
    cells: cellsFor(accounts.filter((a) => a.companyId === c.id)),
    active: campaigns.filter((k) => k.companyId === c.id && k.status === 'active').length,
  }));
  const known = new Set(companies.map((c) => c.id));
  const loose = scope === null ? accounts.filter((a) => !a.companyId || !known.has(a.companyId)) : [];
  return { platforms, rows, unsorted: loose.length ? [{ id: null, name: 'UNSORTED', depth: 0, cells: cellsFor(loose), active: 0 }] : [] };
};

/**
 * WAITING ON YOU, for marketing: posts and replies to decide, groups among
 * them, the CMO's asks, drafts the claims check marked, sends that failed,
 * accounts with no company. Each count names the filter it opens. Under a
 * company's scope every count is that subtree's own: a post by its account,
 * an ask by its campaign's company; NO COMPANY stands only at the house.
 * @param {{items?: object[]}} waiting - the desk's one account (use-waiting.js)
 * @param {object[]} queue
 * @param {object[]} accounts
 * @param {{scope?: ?Set<string>, campaigns?: object[]}} [ctx]
 */
export const bandCounts = (waiting, queue, accounts, { scope = null, campaigns = [] } = {}) => {
  const companyOf = (accountId) => (accounts || []).find((a) => a.id === accountId)?.companyId ?? null;
  const entries = (queue || []).filter((e) => inScope(scope, companyOf(accountOf(e))));
  const byId = new Map((queue || []).map((e) => [e.id, e]));
  const itemIn = (i) => {
    if (scope === null) return true;
    if (i.kind === 'campaign-ask') return inScope(scope, campaigns.find((c) => c.id === i.where?.campaignId)?.companyId);
    const entry = byId.get(i.where?.entryId);
    return Boolean(entry) && inScope(scope, companyOf(accountOf(entry)));
  };
  const items = (waiting?.items || []).filter(itemIn);
  const drafts = entries.filter((e) => e.status === 'draft' && !e.placeholder);
  return {
    drafts: items.filter((i) => i.kind === 'post' || i.kind === 'reply').length,
    groups: new Set(drafts.filter((e) => e.groupId).map((e) => e.groupId)).size,
    asks: items.filter((i) => i.kind === 'campaign-ask').length,
    legal: drafts.filter((e) => e.legal?.open > 0).length,
    failed: entries.filter((e) => e.status === 'failed').length,
    unsorted: scope === null ? (accounts || []).filter((a) => !a.companyId).length : 0,
  };
};

/** Does a post pass the overview's filter? `filter`: {status?, group?, legal?, accountIds?, angle?} */
export const postMatches = (entry, filter, { scope, companyOfAccount }) => {
  if (!inScope(scope, companyOfAccount(accountOf(entry)))) return false;
  if (filter.status === 'draft' && entry.status !== 'draft') return false;
  if (filter.status === 'failed' && entry.status !== 'failed') return false;
  if (filter.status === 'sent' && entry.status !== 'sent') return false;
  if (filter.group && !entry.groupId) return false;
  if (filter.legal && !(entry.legal?.open > 0)) return false;
  if (filter.accountIds && !filter.accountIds.includes(accountOf(entry))) return false;
  if (filter.angle && filter.angle !== entry.pillar && filter.angle !== entry.angleId) return false;
  return true;
};

/** The post rows: newest first by when they went out (or were staged). */
export const postRows = (queue, filter, ctx) => (queue || [])
  .filter((e) => e.kind !== 'reply' && postMatches(e, filter, ctx))
  .sort((a, b) => String(b.sentAt || b.createdAt).localeCompare(String(a.sentAt || a.createdAt)));
