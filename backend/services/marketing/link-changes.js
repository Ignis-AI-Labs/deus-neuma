// link-changes — a company's site, pages and repos, proposed by the house's
// seated CMO and decided by its operator (ruling, 2026-10-24: […]).
//
// The CMO's filing (intents/marketing-company-links.js) writes NOTHING to the
// company: it records one proposal here, and that proposal waits in WAITING
// ON YOU as a card showing what would change. Only the operator's APPROVE,
// from their own signed session, writes it — through setCompanyBlock, the
// same door the operator's own edit uses, so every refusal and wall of the
// company block applies. Listing a repo grants no one its reading: that stays
// the operator's own press (company-repo-grants.js).
//
// What the card shows is read LIVE against the company as it stands now, so a
// change made by hand meanwhile is never shown as still to come.
//
// impure — the kit store and the house's link-change file.

import { readKit } from '../branding/kit-store.js';
import { listCompanies, setCompanyBlock } from './companies.js';
import { readLinkChanges, settleLinkChange } from './link-change-store.js';
import { appliedBlock, diffWords, landingRefusal, linkDiff } from './link-change-shape.js';

// impure — this house's company, or null.
const companyOf = async (wallet, companyId) => (await listCompanies(wallet)).find((c) => c.id === companyId) || null;

/**
 * Why this change cannot be proposed for this house's company, or null. impure.
 * @param {string} wallet - the house
 * @param {string} companyId
 * @param {object} change
 */
export const proposalRefusal = async (wallet, companyId, change) => {
  const company = await companyOf(wallet, companyId);
  if (!company) return `there is no "${companyId}" company in this house`;
  return landingRefusal(company, change);
};

/**
 * Every open proposal of the house, each with what it would change now. impure.
 * @param {string} wallet
 * @returns {Promise<Array<{id, at, laneId, companyId, companyName: ?string, rows: object[], title: string}>>}
 */
export const openLinkChanges = async (wallet) => {
  const open = (await readLinkChanges(wallet)).filter((c) => c.status === 'open');
  if (!open.length) return [];
  const companies = await listCompanies(wallet);
  return open.map((c) => {
    const company = companies.find((x) => x.id === c.companyId) || null;
    const rows = company ? linkDiff(company, c.change) : [];
    return Object.freeze({
      id: c.id, at: c.at, laneId: c.laneId, companyId: c.companyId, companyName: company?.name ?? null,
      rows, title: diffWords(company?.name || c.companyId, rows),
    });
  });
};

// impure — the proposal, open, in this house.
const openOne = async (wallet, id) => (await readLinkChanges(wallet)).find((c) => c.id === id && c.status === 'open') || null;

/**
 * The operator's APPROVE: the change written onto the company as it stands
 * now, through the company block's own door; then the proposal settles. A
 * write the block refuses leaves the proposal open, its reason in words. impure.
 * @param {string} wallet - the signed-in operator's house
 * @param {string} id
 */
export const approveLinkChange = async (wallet, id) => {
  const change = await openOne(wallet, id);
  if (!change) return { ok: false, status: 404, error: 'no open link change has that id in your house' };
  const kit = await readKit(change.companyId, wallet);
  if (!kit.ok) return { ok: false, status: 400, error: kit.error };
  const written = await setCompanyBlock(wallet, change.companyId, appliedBlock(kit.kit.company, change.change));
  if (!written.ok) return { ok: false, status: 400, error: written.error };
  const settled = await settleLinkChange(wallet, id, { status: 'approved', by: wallet });
  if (!settled.ok) return { ok: false, status: 409, error: settled.error };
  return { ok: true, company: written.company, entry: settled.entry };
};

/** The operator's DECLINE: nothing is written; the proposal settles. impure. */
export const declineLinkChange = async (wallet, id) => {
  const settled = await settleLinkChange(wallet, id, { status: 'declined', by: wallet });
  return settled.ok ? settled : { ...settled, status: 404 };
};
