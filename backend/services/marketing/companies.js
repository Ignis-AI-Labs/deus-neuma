// companies — the house's companies, read from its brand kits (campaign plan
// §2.4). There is no company store: a kit IS a company (kit-locate.js), and
// its `company` block (kit-shape.js) records its parent, site and legal
// entity. Every fact is the house's own: kits resolve through the house's
// ground first, then the kits this repo ships.
//
// impure — disk, through the kit store.

import { listBrandNames } from '../branding/kit-locate.js';
import { brandsDir } from '../branding/brand-tokens.js';
import { readKit, writeKit } from '../branding/kit-store.js';
import { companyOf, companyRefusals } from '../branding/kit-shape.js';
import { settleTree, treeOrder } from './company-tree.js';
import { campaignStoreFor } from './campaign-store.js';
import { defaultCompanyFor } from '../social/account-migrate.js';

// impure — every kit this house can reach, each as the company it is.
const readCompanies = async (wallet) => {
  const names = await listBrandNames(wallet, brandsDir());
  const read = await Promise.all(names.map(async ({ brand, where }) => {
    const kit = await readKit(brand, wallet);
    return kit.ok ? { ...companyOf(kit.kit, brand), where } : null;
  }));
  return read.filter(Boolean);
};

/**
 * The house's companies in tree order (each root, then its subsidiaries).
 * impure.
 * @param {string} wallet
 * @returns {Promise<Array<{id, name, parentId, rootId, depth, problem, site, legalEntity, where}>>}
 */
export const listCompanies = async (wallet) => treeOrder(settleTree(await readCompanies(wallet)));

/**
 * Record a company's place and papers on its kit. Refused in words when the
 * block is malformed, the parent is not a company here, or the tree would
 * loop. A shipped kit is copied into the house's own ground on its first
 * edit (kit-store's law). impure.
 * @param {string} wallet
 * @param {string} companyId
 * @param {object} block - {parentId?, site?, legalEntity?}
 */
export const setCompanyBlock = async (wallet, companyId, block) => {
  const refusals = companyRefusals(block, companyId);
  if (refusals.length) return { ok: false, error: refusals.join('; ') };
  const kit = await readKit(companyId, wallet);
  if (!kit.ok) return { ok: false, error: kit.error };
  const companies = await readCompanies(wallet);
  if (block?.parentId && !companies.some((c) => c.id === block.parentId)) {
    return { ok: false, error: `there is no "${block.parentId}" company in this house` };
  }
  const next = companies.map((c) => (c.id === companyId ? { ...c, parentId: block?.parentId ?? null } : c));
  const problem = settleTree(next).find((c) => c.id === companyId)?.problem;
  if (problem) return { ok: false, error: `that would leave ${companyId} with a broken tree: ${problem}` };
  const written = await writeKit(companyId, wallet, { ...kit.kit, company: block });
  if (!written.ok) return written;
  return { ok: true, company: (await listCompanies(wallet)).find((c) => c.id === companyId) };
};

/**
 * The company a house's pre-accounts social accounts belong to, and why
 * (account-migrate.js `defaultCompanyFor`). impure.
 * @param {string} wallet
 * @returns {Promise<{companyId: ?string, why: string}>}
 */
export const houseDefaultCompany = async (wallet) => {
  const [names, campaigns] = await Promise.all([
    listBrandNames(wallet, brandsDir()),
    campaignStoreFor(wallet).then((bench) => bench.load()).catch(() => []),
  ]);
  return defaultCompanyFor({
    campaignBrands: campaigns.map((c) => c.brand),
    kits: names.map((n) => n.brand),
    ownKits: names.filter((n) => n.where === 'workspace').map((n) => n.brand),
  });
};
