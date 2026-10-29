// Every receipt the house already holds, as the books read them: each money-in
// receipt (money-in/, receive-only, detected on chain) and each executed spend
// of each of the house's beings (treasury/). A receipt is named by a ref the
// Logista books it under — the money-in row's key, or `<lane>:<spend id>` —
// and carries the figures an entry takes from it.
// impure (store reads); the shaping is pure.

import { readReceipts } from '../money-in/money-in-store.js';
import { readSpendRecords } from '../treasury/spend-records.js';
import { houseLanes } from '../treasury/treasury-lanes.js';

// pure — a money-in row as a receipt the books can take.
const moneyInReceipt = (row) => ({
  kind: 'money-in', ref: row.key, direction: 'in', amount: Number(row.amount), currency: row.asset, date: row.timestamp,
  label: `${row.amount} ${row.asset} in, on ${row.network} (${row.txHash.slice(0, 10)}…)`,
});

// pure — an executed spend as a receipt the books can take.
const spendReceipt = (laneId, r) => ({
  kind: 'spend', ref: `${laneId}:${r.id}`, direction: 'out', amount: Number(r.value), currency: 'ETH', date: r.resolvedAt || r.requestedAt,
  label: `${r.value} ETH out by ${laneId} to ${String(r.to).slice(0, 10)}…${r.memo ? ` — "${r.memo}"` : ''}`,
});

/**
 * @param {string} wallet - the house
 * @returns {Promise<Array<object>>} oldest first
 */
export const houseReceipts = async (wallet) => {
  const [rows, lanes] = await Promise.all([readReceipts(wallet).catch(() => []), houseLanes(wallet).catch(() => [])]);
  const spends = await Promise.all(lanes.map(async ({ neumaId }) => (await readSpendRecords(neumaId).catch(() => []))
    .filter((r) => r.status === 'executed').map((r) => spendReceipt(neumaId, r))));
  return [...rows.map(moneyInReceipt), ...spends.flat()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
};

/** The figures an entry takes from a receipt, or null. pure. */
export const matchedFigures = (receipts, kind, ref) => {
  const r = receipts.find((x) => x.kind === kind && x.ref === String(ref ?? ''));
  return r ? { direction: r.direction, amount: r.amount, currency: r.currency, date: r.date } : null;
};
