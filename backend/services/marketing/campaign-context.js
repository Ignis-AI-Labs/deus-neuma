// campaign-context — what a campaign is judged against: the house's own
// companies (its brand kits) and its own accounts. Read fresh for each act,
// from this house only, so a campaign can never name another house's company
// or run on another house's account.
//
// impure — disk, through the kit and account stores.

import { listCompanies } from './companies.js';
import { listAccounts } from '../social/account-store.js';

/**
 * @param {string} wallet - the house
 * @returns {Promise<{companies: Array<object>, accounts: Array<object>}>}
 */
export const campaignContextFor = async (wallet) => {
  const [companies, accounts] = await Promise.all([listCompanies(wallet), listAccounts(wallet)]);
  return { companies, accounts };
};
