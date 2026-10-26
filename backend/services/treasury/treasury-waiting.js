// treasury-waiting — what the treasury owes the operator, as WAITING ON YOU
// items (waiting-sources.js folds them beside every other source):
//   - every pending spend of every being in the house (#586) — a decision
//     only the operator's own signature can make; it lands on its SPEND card
//     in the TREASURY window, and it is never a one-press approve
//   - every open flag the Quaestor raised — read, then marked seen
//
// No chain read rides this account (it is polled): the item names the
// amount, the recipient and the being's own words; the card reads the rest.
import { ethers } from 'ethers';
import { readSpendRecords } from './spend-records.js';
import { readFlags } from './treasury-office-store.js';

const TITLE_MAX = 280;

const short = (address) => (ethers.isAddress(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : String(address || '?'));

/**
 * A pending spend as an item. Pure.
 * @param {object} request
 * @param {string} neumaId
 * @param {Map<string, string>} names
 */
export const spendItem = (request, neumaId, names) => Object.freeze({
  id: `spend:${neumaId}:${request.id}`,
  kind: 'spend',
  title: `${request.value} ETH to ${short(request.to)}${request.memo ? ` — ${request.memo}` : ''}`.slice(0, TITLE_MAX),
  who: { laneId: neumaId, name: names.get(neumaId) ?? null },
  where: { app: 'treasury', neumaId, spendId: request.id },
  at: request.requestedAt || new Date(0).toISOString(),
  expiresAt: new Date(Number(request.expiry) * 1000).toISOString(),
});

/**
 * An open Quaestor flag as an item. Pure.
 * @param {object} flag
 * @param {Map<string, string>} names
 */
const treasuryFlagItem = (flag, names) => Object.freeze({
  id: `treasury-flag:${flag.id}`,
  kind: 'treasury-flag',
  title: String(flag.title).slice(0, TITLE_MAX),
  who: flag.by ? { laneId: flag.by, name: names.get(flag.by) ?? null } : null,
  where: { app: 'treasury', flagId: flag.id },
  at: flag.at,
});

/**
 * impure — the treasury's items for one house.
 * @param {Array<{neumaId: string}>} lanes - the house's lanes
 * @param {string} wallet
 * @param {Map<string, string>} names
 * @returns {Promise<object[]>}
 */
export const treasuryWaitingItems = async (lanes, wallet, names) => {
  const nowSec = Math.floor(Date.now() / 1000);
  const spends = (await Promise.all(lanes.map(async ({ neumaId }) => (await readSpendRecords(neumaId, nowSec))
    .filter((r) => r.status === 'pending' && Number(r.expiry) > nowSec)
    .map((r) => spendItem(r, neumaId, names))))).flat();
  const flags = (await readFlags(wallet)).filter((f) => f.status === 'open').map((f) => treasuryFlagItem(f, names));
  return [...spends, ...flags];
};
