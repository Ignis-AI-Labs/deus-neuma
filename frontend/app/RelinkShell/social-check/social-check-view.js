// social-check-view — the SOCIAL CHECK window's pure display law (campaign
// plan §6.1, slice 11; SHOW, DON'T TELL, 2026-10-24). The overview first
// (JŌHŌ SEKKEI): each tree, its companies indented, one card per account in
// use; UNSORTED apart; OPTIONAL apart, folded, never counted. Each check is a
// mark shaped by its state, its words on hover; only a FIX opens, as a short
// title and a door (the rule's own `fix` data — never a parsed sentence).
// True marks (SHINKEI): a check that does not apply reads "—", an unproven
// one reads NOT PROVEN, never a pass. Pure.

/** The mark one account in use wears: clear, failing, or not proven. */
export const accountTone = (row) => {
  if (!row?.inUse) return 'optional';
  if (row.clear) return 'clear';
  return row.checks.some((c) => c.verdict === 'fail') ? 'fail' : 'unknown';
};

/** One check's verdict as the person reads it (a mark's hover). */
export const VERDICT_WORDS = Object.freeze({ pass: 'clear', fail: 'fix', unknown: 'not proven', na: 'not reported' });

/** One account's verdict as the person reads it (its mark's hover). */
export const TONE_WORDS = Object.freeze({ clear: 'clear', fail: 'needs you', unknown: 'not proven', optional: 'not in use' });

/** A check's mark named: […] */
export const checkHover = (check) => [`${check.label} — ${VERDICT_WORDS[check.verdict]}`, check.words, check.detail]
  .filter(Boolean).join(' · ');

/** What the account's card names it by: its @handle, else its id. */
export const accountName = (row) => row.handle || row.id;

/** A tally's words: […], or that nothing there is in use. */
export const tallyWords = ({ clear, total }) => (total ? `${clear} OF ${total} CLEAR` : 'NONE IN USE');

/**
 * The overview rows: each tree's companies in tree order, each with the
 * account rows it holds, then UNSORTED when any account is.
 * @param {object} check - the route's report
 * @returns {Array<{key: string, name: string, depth: number, tally: object, rows: object[], tree?: boolean}>}
 */
export const overviewRows = (check) => {
  const rowOf = new Map(check.accounts.map((a) => [a.id, a]));
  const out = [];
  for (const tree of check.trees) {
    for (const id of tree.companies) {
      const c = check.companies.find((x) => x.id === id);
      out.push({
        key: `company:${id}`, name: c.name, depth: c.depth,
        tally: c, treeTally: c.depth === 0 ? tree : null, rows: c.accounts.map((a) => rowOf.get(a)),
      });
    }
  }
  if (check.unsorted.total) {
    out.push({ key: 'unsorted', name: 'UNSORTED — NO COMPANY', depth: 0, tally: check.unsorted, treeTally: null, rows: check.unsorted.accounts.map((a) => rowOf.get(a)) });
  }
  return out;
};

/** The account the drill-down opens on: the asked one, else the first not clear, else the first in use. */
export const focusedAccount = (check, asked) => {
  const inUse = check.accounts.filter((a) => a.inUse);
  return inUse.find((a) => a.id === asked) || inUse.find((a) => !a.clear) || inUse[0] || null;
};

/** The fixes one account owes, in reading order: only its failing checks that name a fix. */
export const fixesOf = (row) => (row?.checks || []).filter((c) => c.verdict === 'fail' && c.fix);

/** A door's identity: two fixes with one door and one title are one step. */
export const doorKey = (door) => [door.kind, door.channelId, door.accountId, door.companyId, door.section, door.drawer, door.entryId]
  .map((v) => v ?? '').join('|');

const stepKey = (fix) => `${fix.title}|${doorKey(fix.door)}`;

/**
 * The guided path: every fix the house owes, numbered across accounts in the
 * overview's order, one step per title and door (a company's site is one
 * step however many of its accounts ask for it). Done steps fall away on the
 * next check, because they are no longer failing. Pure.
 * @param {object} check - the route's report (narrowed or not)
 * @returns {Array<{n: number, key: string, title: string, door: object, handTo: ?object, accounts: string[]}>}
 */
export const fixSteps = (check) => {
  const steps = new Map();
  for (const row of overviewRows(check).flatMap((r) => r.rows)) {
    for (const c of fixesOf(row)) {
      const key = stepKey(c.fix);
      const step = steps.get(key);
      if (step) step.accounts.push(row.id);
      else steps.set(key, { key, title: c.fix.title, door: c.fix.door, handTo: c.fix.handTo || null, accounts: [row.id] });
    }
  }
  return [...steps.values()].map((s, i) => ({ ...s, n: i + 1 }));
};

// The door's press and its hover live in the desk's one door table; re-exported for this check's readers.
export { doorLabel, doorPlace } from '../doors/door-words.js';

/**
 * The house check narrowed to one company's subtree (MARKETING's ACCOUNTS
 * tab): only its companies, its accounts and its trees' members; NO COMPANY
 * and the platforms nobody holds are the house's to show, never a company's.
 * The headline is recounted from the accounts in scope. Null scope = the
 * house's check as it stands. Pure.
 * @param {object} check - the route's report
 * @param {?Set<string>} scope
 */
export const narrowCheck = (check, scope) => {
  if (!check || scope === null) return check;
  const accounts = check.accounts.filter((a) => scope.has(a.companyId));
  const inUse = accounts.filter((a) => a.inUse);
  const clear = inUse.filter((a) => a.clear).length;
  const optional = { accounts: accounts.filter((a) => !a.inUse).map((a) => a.id), platforms: [] };
  return {
    ...check,
    headline: [inUse.length ? `${clear} OF ${inUse.length} ACCOUNTS CLEAR` : 'NO ACCOUNTS IN USE',
      ...(optional.accounts.length ? [`${optional.accounts.length} OPTIONAL`] : [])].join(' · '),
    trees: check.trees.map((t) => ({ ...t, companies: t.companies.filter((id) => scope.has(id)) })).filter((t) => t.companies.length),
    companies: check.companies.filter((c) => scope.has(c.id)),
    unsorted: { ...check.unsorted, clear: 0, total: 0, accounts: [] },
    optional,
    accounts,
  };
};
