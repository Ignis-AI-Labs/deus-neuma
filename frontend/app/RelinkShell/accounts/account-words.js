// account-words.js — how the desk names a house account and its company
// (campaign plan §2.6, CHOKKAN): the account chip says who speaks — company,
// platform account, handle — the same words on every surface. Pure.

/** The account a queue entry speaks as: its own, else its platform's first. */
export const entryAccountId = (entry) => entry?.accountId || `${entry?.channelId}-1`;

/** An account's handle as a person reads it, or null when none is known. */
export const handleOf = (account) => {
  const h = account?.expectedHandle || account?.label || '';
  return h ? (account?.expectedHandle ? `@${String(h).replace(/^@/, '')}` : String(h)) : null;
};

/** A company's name, or the honest words for an account with none. */
export const companyNameOf = (companyId, companies) => (companyId
  ? (companies || []).find((c) => c.id === companyId)?.name || companyId
  : 'no company yet');

/**
 * The chip's words for one entry: who it posts (or went out) as.
 * @param {object} entry
 * @param {ReadonlyArray<object>} accounts
 * @param {ReadonlyArray<object>} companies
 * @returns {{text: string, title: string, unsorted: boolean}}
 */
export const postsAsWords = (entry, accounts, companies) => {
  const id = entryAccountId(entry);
  const account = (accounts || []).find((a) => a.id === id) || null;
  const handle = entry?.postedAs?.username ? `@${entry.postedAs.username}` : handleOf(account) || id;
  const verb = entry?.status === 'sent' ? 'WENT OUT AS' : 'POSTS AS';
  return {
    text: `${verb} ${handle} (${companyNameOf(account?.companyId, companies)})`,
    title: `account ${id}`,
    unsorted: !account?.companyId,
  };
};

/**
 * The company choices in tree order, a subsidiary indented under its parent.
 * @param {ReadonlyArray<{id: string, name: string, depth?: number}>} companies
 * @returns {Array<{value: string, label: string}>}
 */
export const companyOptions = (companies) => (companies || [])
  .map((c) => ({ value: c.id, label: `${'\u00a0\u00a0'.repeat(c.depth || 0)}${c.depth ? '└ ' : ''}${c.name || c.id}` }));

/**
 * One platform's accounts, grouped by company in tree order; accounts with
 * no company stand last, as UNSORTED.
 * @returns {Array<{companyId: ?string, name: string, accounts: object[]}>}
 */
export const accountsByCompany = (accounts, companies, channelId) => {
  const mine = (accounts || []).filter((a) => a.channelId === channelId);
  const groups = (companies || [])
    .map((c) => ({ companyId: c.id, name: c.name || c.id, accounts: mine.filter((a) => a.companyId === c.id) }))
    .filter((g) => g.accounts.length);
  const known = new Set((companies || []).map((c) => c.id));
  const unsorted = mine.filter((a) => !a.companyId || !known.has(a.companyId));
  return unsorted.length ? [...groups, { companyId: null, name: 'UNSORTED', accounts: unsorted }] : groups;
};
