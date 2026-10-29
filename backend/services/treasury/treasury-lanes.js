// treasury-lanes — each being's money as the treasury reads it, for ONE
// house (the operator's wallet): its wallet address, its standing spend
// policy (allowlist, threshold), its whole spend ledger, and every pending
// spend as a card (spend-card.js). The house's lanes are the lanes that
// wallet owns — never another house's: two houses on one machine are never confused.
//
// Balances are read live, on the chain the wallet code reads (Base, through
// neuma-wallet's own provider), and only where a card or the board needs
// them. A balance the chain did not answer is null, never zero.
//
// impure — workspace reads, chain reads.
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { toAllowlist } from '../../../core/wallet/spend-policy.js';
import { laneName } from '../house-titles.js';
import { getAddress, MAX_TX_VALUE_ETH } from '../neuma-wallet-spend.js';
import { balanceOfAddress } from '../neuma-wallet.js';
import { readSpendRecords } from './spend-records.js';
import { readReviews, latestReviews } from './treasury-office-store.js';
import { spendCardOf } from './spend-card.js';

// The chain a being's wallet lives on (neuma-wallet-spend.js — target-chain doctrine).
export const SPEND_NETWORK = Object.freeze({ key: 'base', label: 'Base mainnet' });
const READ_TIMEOUT_MS = 8000;

/**
 * impure — a promise that settles null instead of waiting past `ms`.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} [ms]
 * @returns {Promise<T|null>}
 */
export const withinTime = (promise, ms = READ_TIMEOUT_MS) => {
  let timer;
  return Promise.race([
    promise.catch(() => null),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
  ]).finally(() => clearTimeout(timer));
};

/** impure — the house's own beings, each with the name it goes by. */
export const houseLanes = async (wallet) => {
  const lanes = await neumaWorkspace.listNeumaByOwner(wallet);
  return Promise.all(lanes.map(async ({ neumaId, owner }) => ({ neumaId, name: await laneName(neumaId, owner) })));
};

/**
 * impure — one being's money facts, without a chain read.
 * @param {{neumaId: string, name: ?string}} lane
 */
export const laneMoney = async ({ neumaId, name }) => {
  const [address, allowlist, threshold, records] = await Promise.all([
    getAddress(neumaId).catch(() => null),
    neumaWorkspace.readSpendAllowlist(neumaId),
    neumaWorkspace.readSpendThreshold(neumaId),
    readSpendRecords(neumaId),
  ]);
  return Object.freeze({
    neumaId, name, address, allowlist: toAllowlist(allowlist), thresholdEth: Number(threshold?.thresholdEth) || 0, records,
  });
};

/** impure — a Base balance in decimal ETH, or null (unanswered or no address). */
export const baseBalanceOf = (address) => (address ? withinTime(balanceOfAddress(address, { network: SPEND_NETWORK.key })) : Promise.resolve(null));

/**
 * impure — every pending spend in the house, as cards, oldest first. A lane
 * with nothing pending costs no chain read.
 * @param {string} wallet
 * @param {{nowSec?: number}} [opts]
 * @returns {Promise<object[]>}
 */
export const pendingSpendCards = async (wallet, { nowSec = Math.floor(Date.now() / 1000) } = {}) => {
  const [lanes, reviews] = await Promise.all([houseLanes(wallet), readReviews(wallet).catch(() => [])]);
  const latest = latestReviews(reviews);
  const cards = [];
  for (const lane of lanes) {
    const money = await laneMoney(lane);
    const pending = money.records.filter((r) => r.status === 'pending' && Number(r.expiry) > nowSec);
    if (!pending.length) continue;
    const balanceEth = await baseBalanceOf(money.address);
    for (const request of pending) {
      cards.push(spendCardOf(request, {
        neumaId: lane.neumaId, name: lane.name, network: SPEND_NETWORK.key, chainLabel: SPEND_NETWORK.label,
        allowlist: money.allowlist, thresholdEth: money.thresholdEth, capEth: MAX_TX_VALUE_ETH,
        address: money.address, balanceEth, records: money.records,
        review: latest.get(`${lane.neumaId}:${request.id}`) || null, nowSec,
      }));
    }
  }
  return cards.sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)) || a.id.localeCompare(b.id));
};
