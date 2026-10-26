// treasury-board — the house's money in one read, for the operator's
// TREASURY window and the Quaestor's treasury_board tool. ONE house: the
// operator's wallet, and only the lanes it owns.
//
//   seat      — who holds the Quaestor's office
//   wallets   — the operator's own wallet and every being's, each balance
//               read live on Base (the wallet code's chain) and on Ethereum
//               (the operator's pinned RPC, chain-registry) — null when the
//               chain did not answer or no RPC is set, never zero
//   pending   — every spend waiting on the operator, as cards
//   history   — every settled spend with the being's reason and the
//               operator's note: what went out, what was refused, what expired
//   moneyIn   — what the house received (the money-in ledger, receive-only)
//   budgets   — the campaigns' PLANNING budgets (read, never enforced: nothing
//               spends them)
//   costs     — what of the cost meter exists today (the GPU's power draw,
//               read live) and what is not built
//   flags     — the Quaestor's open flags
//   marks     — the flight check (treasury-flight.js)
//
// Nothing here can move money: no key is opened, nothing is signed.
//
// impure — store and chain reads.
import { ethers } from 'ethers';
import { providerFor, isConfigured } from '../chain/chain-registry.js';
import { readReceipts } from '../money-in/money-in-store.js';
import { summarizeMoneyIn } from '../money-in/money-in-summary.js';
import { campaignStoreFor } from '../marketing/campaign-store.js';
import { readMachineThermals } from '../machine-thermals.js';
import { MAX_TX_VALUE_ETH } from '../neuma-wallet-spend.js';
import { cfoDesignation } from './cfo-designation.js';
import { readFlags } from './treasury-office-store.js';
import { historyRowOf } from './spend-card.js';
import { houseLanes, laneMoney, baseBalanceOf, pendingSpendCards, withinTime } from './treasury-lanes.js';
import { keyCustodyOf, rawSigningRefused, treasuryMarks } from './treasury-flight.js';

const HISTORY_MAX = 200;

// The parts of the cost meter the house-economy plan names that no code
// measures yet (house-economy-benchmark.md, Stage 3).
const COST_METER_MISSING = Object.freeze([
  'electricity price (so power draw becomes money)',
  'GPU energy integrated over a period',
  'hardware cost and rent, entered once',
  'API spend per provider',
]);

// impure — an Ethereum balance through the operator's own RPC, or null.
const ethereumBalanceOf = async (address) => {
  if (!address) return null;
  const provider = await withinTime(providerFor('ethereum'));
  if (!provider) return null;
  const wei = await withinTime(provider.getBalance(address));
  return wei === null ? null : ethers.formatEther(wei);
};

// impure — both chains for one address.
const balancesOf = async (address) => {
  const [base, ethereum] = await Promise.all([baseBalanceOf(address), ethereumBalanceOf(address)]);
  return Object.freeze({ base, ethereum });
};

// impure — every source read apart: one that fails is a named gap, never the board.
const part = async (name, fn, gaps, fallback) => {
  try {
    return await fn();
  } catch (error) {
    gaps.push({ part: name, error: error.message });
    return fallback;
  }
};

/**
 * impure — the whole treasury for one house.
 * @param {string} wallet - the operator's wallet (the house)
 * @returns {Promise<object>}
 */
export const readTreasuryBoard = async (wallet) => {
  const gaps = [];
  const house = String(wallet).toLowerCase();
  const lanes = await part('lanes', () => houseLanes(house), gaps, []);
  const names = new Map(lanes.map((l) => [l.neumaId, l.name]));
  const officer = await part('seat', () => cfoDesignation.getOfficer(house), gaps, null);

  const beings = await Promise.all(lanes.map(async (lane) => {
    const money = await laneMoney(lane);
    const [balances, custody] = await Promise.all([balancesOf(money.address), keyCustodyOf(lane.neumaId).catch(() => 'none')]);
    return { ...money, balances, custody };
  }));
  const [operatorBalances, pending, receipts, campaigns, thermals, flags, refused] = await Promise.all([
    balancesOf(ethers.isAddress(house) ? ethers.getAddress(house) : null),
    part('pending', () => pendingSpendCards(house), gaps, []),
    part('money-in', () => readReceipts(house), gaps, []),
    part('budgets', async () => (await campaignStoreFor(house)).load(), gaps, []),
    withinTime(readMachineThermals()),
    part('flags', () => readFlags(house), gaps, []),
    rawSigningRefused(),
  ]);

  const history = beings
    .flatMap((b) => b.records.filter((r) => r.status !== 'pending').map((r) => historyRowOf(r, { neumaId: b.neumaId, name: b.name })))
    .sort((a, b) => String(b.resolvedAt || b.requestedAt).localeCompare(String(a.resolvedAt || a.requestedAt)))
    .slice(0, HISTORY_MAX);

  return Object.freeze({
    house,
    readAt: new Date().toISOString(),
    seat: officer ? { laneId: officer.laneId, name: names.get(officer.laneId) || null, designatedAt: officer.designatedAt || null } : null,
    wallets: [
      { kind: 'operator', address: ethers.isAddress(house) ? ethers.getAddress(house) : house, name: null, balances: operatorBalances },
      ...beings.map((b) => ({
        kind: 'being', neumaId: b.neumaId, name: b.name, address: b.address, balances: b.balances,
        thresholdEth: b.thresholdEth, recipients: b.allowlist.entries.map((e) => ({ address: e.address, label: e.label || '', addedAt: e.addedAt || null })),
        custody: b.custody,
      })),
    ],
    pending,
    history,
    moneyIn: summarizeMoneyIn(receipts),
    budgets: campaigns.filter((c) => c.budget && (c.budget.money != null || c.budget.hours != null))
      .map((c) => ({ id: c.id, name: c.name, status: c.status, money: c.budget.money ?? null, hours: c.budget.hours ?? null, note: c.budget.note || '' })),
    costs: {
      gpuPowerW: thermals?.gpu?.powerW ?? null,
      gpuName: thermals?.gpu?.name ?? null,
      missing: COST_METER_MISSING,
    },
    flags: flags.filter((f) => f.status === 'open'),
    capEth: MAX_TX_VALUE_ETH,
    // Whether an Ethereum RPC is set at all — so an unread balance can say why.
    chains: { base: true, ethereum: isConfigured('ethereum') },
    marks: treasuryMarks({
      officer,
      officerName: officer ? names.get(officer.laneId) : null,
      lanes: beings.map((b) => ({
        neumaId: b.neumaId, name: b.name, address: b.address, baseEth: b.balances.base,
        thresholdEth: b.thresholdEth, allowlistCount: b.allowlist.entries.length, custody: b.custody, records: b.records,
      })),
      capEth: MAX_TX_VALUE_ETH,
      rawSigningRefused: refused,
      nowMs: Date.now(),
    }),
    gaps,
  });
};
