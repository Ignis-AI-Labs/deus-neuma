// board-house — the house a MARKETING board is judged against (marketing-panel-plan.md
// §4): its companies, its bench and its accounts, read for ONE house's wallet.
// The operator's board routes, the CMO's board_read and the CMO's
// marketing/board-arrange act all read it here, so every door judges a board
// against the same house — and only ever the caller's own.

import { listCompanies } from './companies.js';
import { campaignStoreFor } from './campaign-store.js';
import { listAccounts, isAccountsLocked } from '../social/account-store.js';
import { HOUSE_LEVEL, boardRefusals } from './board-shape.js';

/** A level a board may be named by: "house", or a company id. */
export const BOARD_LEVEL = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * The house as a board is judged against. impure — the house's stores.
 * @param {string} wallet - the house
 * @param {string} level - "house" or a company id
 */
export const boardHouseOf = async (wallet, level) => {
  // A locked keys file (account-store.js): the accounts are unknown (null), never none — a saved panel on
  // one is kept, not dropped, and `locked` refuses any new layout until the file opens (board-store.js save).
  const accountsOrLocked = listAccounts(wallet).catch((err) => {
    if (isAccountsLocked(err)) return { locked: { why: err.message } };
    throw err;
  });
  const [companies, campaigns, accounts] = await Promise.all([listCompanies(wallet), (await campaignStoreFor(wallet)).load(), accountsOrLocked]);
  if (!Array.isArray(accounts)) return { level, companies, campaigns, accounts: null, locked: accounts.locked };
  return { level, companies, campaigns, accounts: accounts.map((a) => ({ id: a.id, channelId: a.channelId, companyId: a.companyId ?? null })) };
};


/** Why a level is not this house's, or null. Pure. */
export const levelRefusal = (ctx) => (ctx.level === HOUSE_LEVEL ? null : boardRefusals([], ctx)[0] || null);
