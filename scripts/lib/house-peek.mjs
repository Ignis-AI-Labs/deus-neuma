/**
 * A house's marketing records, read EXACTLY as they stand on disk — never
 * migrated, never moved, never written. The read-only scripts (the social
 * check's live run, the campaign benchmark) open the owner's real house
 * through here, so running them changes nothing:
 *
 *   - the account store is peeked (account-store.js `peekAccountStore`): a
 *     v1 store reads as its v2 view in memory, and the real migration still
 *     waits for the desk;
 *   - the campaigns are read from the house's office file directly (the
 *     store's open would move a machine-wide bench into the house and move a
 *     first-shape bench to v2): a first-shape campaign reads upgraded in
 *     memory (campaign-upgrade.js, pure);
 *   - the queue is the machine's one file, filtered to the house.
 *
 * impure — disk reads only.
 */
import fs from 'fs/promises';
import { officeFile } from '../../backend/services/house-office.js';
import { peekAccountStore } from '../../backend/services/social/account-store.js';
import { upgradeCampaign } from '../../backend/services/marketing/campaign-upgrade.js';
import { listCompanies } from '../../backend/services/marketing/companies.js';

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
};

/** The house's campaigns as they stand, first-shape ones upgraded in memory. */
export const peekCampaigns = async (wallet) => {
  const list = await readJson(officeFile(wallet, 'marketing', 'marketing-campaigns.json'), []);
  if (!Array.isArray(list)) throw new Error('the house\'s campaign file is not a list');
  const companyIds = (await listCompanies(wallet)).map((c) => c.id);
  return list.map((c) => upgradeCampaign(c, { companyIds }));
};

/** The read-only readers runHouseCheck takes (house-check-facts.js `reads`). */
export const PEEK_READS = Object.freeze({
  store: async (wallet) => (await peekAccountStore(wallet)).store,
  campaigns: peekCampaigns,
});

/** The shape the house's account store stands in on disk: none | v1 | v2. */
export const storeShape = async (wallet) => (await peekAccountStore(wallet)).shape;
