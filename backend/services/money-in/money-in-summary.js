// The money-in summary — the house economy benchmark's NUMERATOR: what a
// house received in a period, per asset (exact base units) and in USD, per
// member. One pure function over ledger rows; the REST totals and any later
// office briefing read the same figure.
//
// Internal rows (one house address paying another) are house money moving,
// not money in: they are counted apart and never enter a total. A row with
// no price adds nothing to usdTotal and is COUNTED as unpriced, so a total
// that is missing a receipt says so instead of reading as complete.
//
// pure.

import { ethers } from 'ethers';

const inPeriod = (row, fromMs, toMs) => {
  const t = Date.parse(row.timestamp);
  return (fromMs === null || t >= fromMs) && (toMs === null || t < toMs);
};

const parseTime = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
};

/**
 * The ledger filtered by member, asset, network and period [from, to).
 * pure.
 * @param {object[]} rows
 * @param {{ member?: string, asset?: string, network?: string, from?: string, to?: string }} [f]
 */
export const filterReceipts = (rows, { member, asset, network, from, to } = {}) => {
  const fromMs = parseTime(from);
  const toMs = parseTime(to);
  return rows.filter((row) => (!member || row.member === member)
    && (!asset || row.asset === asset)
    && (!network || row.network === network)
    && inPeriod(row, fromMs, toMs));
};

const roundUsd = (n) => Math.round(n * 1e6) / 1e6;

// Fold one row into a per-asset map: base units summed exactly as bigint.
const addToAssets = (assets, row) => {
  const id = `${row.network}:${row.asset}`;
  const prior = assets.get(id) ?? { network: row.network, asset: row.asset, decimals: row.decimals, amountRaw: 0n, usd: 0, count: 0, unpriced: 0 };
  prior.amountRaw += BigInt(row.amountRaw);
  prior.count += 1;
  if (typeof row.usd === 'number') prior.usd += row.usd;
  else prior.unpriced += 1;
  assets.set(id, prior);
};

const renderAssets = (assets) => Object.fromEntries([...assets].map(([id, a]) => [id, Object.freeze({
  network: a.network, asset: a.asset, count: a.count, unpriced: a.unpriced,
  amountRaw: a.amountRaw.toString(), amount: ethers.formatUnits(a.amountRaw, a.decimals), usd: roundUsd(a.usd),
})]));

/**
 * Money in for a period: per asset, USD total, per member. pure.
 * @param {object[]} rows - ledger rows
 * @param {{ from?: string, to?: string, member?: string, asset?: string, network?: string }} [period]
 * @returns {{ from: string|null, to: string|null, count: number, usdTotal: number, unpriced: number,
 *   internalExcluded: number, perAsset: object, perMember: object }}
 */
export const summarizeMoneyIn = (rows, period = {}) => {
  const scoped = filterReceipts(rows, period);
  const assets = new Map();
  const members = new Map();
  let usdTotal = 0;
  let unpriced = 0;
  let internalExcluded = 0;
  let count = 0;
  for (const row of scoped) {
    if (row.internal) { internalExcluded += 1; continue; }
    count += 1;
    addToAssets(assets, row);
    if (typeof row.usd === 'number') usdTotal += row.usd;
    else unpriced += 1;
    const memberId = row.member ?? `address:${row.to.toLowerCase()}`;
    const m = members.get(memberId) ?? { member: row.member, label: row.memberLabel, usd: 0, count: 0, assets: new Map() };
    m.count += 1;
    if (typeof row.usd === 'number') m.usd += row.usd;
    addToAssets(m.assets, row);
    members.set(memberId, m);
  }
  return Object.freeze({
    from: period.from ?? null,
    to: period.to ?? null,
    count,
    usdTotal: roundUsd(usdTotal),
    unpriced,
    internalExcluded,
    perAsset: renderAssets(assets),
    perMember: Object.fromEntries([...members].map(([id, m]) => [id, Object.freeze({
      member: m.member, label: m.label, count: m.count, usd: roundUsd(m.usd), perAsset: renderAssets(m.assets),
    })])),
  });
};

// The UTC start of the bucket holding `ms`. Weeks start Monday (ISO). pure.
const bucketStart = (ms, granularity) => {
  const d = new Date(ms);
  if (granularity === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (granularity === 'week') return day - ((d.getUTCDay() + 6) % 7) * 86_400_000;
  return day;
};

const nextBucket = (startMs, granularity) => {
  const d = new Date(startMs);
  if (granularity === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return startMs + (granularity === 'week' ? 7 : 1) * 86_400_000;
};

export const GRANULARITIES = Object.freeze(['day', 'week', 'month']);

/**
 * Totals per period bucket (UTC day, ISO week, or month) — only buckets that
 * hold at least one receipt. pure.
 * @param {object[]} rows
 * @param {{ granularity: 'day'|'week'|'month', from?: string, to?: string, member?: string, asset?: string, network?: string }} opts
 */
export const totalsByPeriod = (rows, { granularity, ...filter }) => {
  const starts = new Set(filterReceipts(rows, filter).map((row) => bucketStart(Date.parse(row.timestamp), granularity)));
  return [...starts].sort((a, b) => a - b).map((start) => summarizeMoneyIn(rows, {
    ...filter,
    from: new Date(Math.max(start, parseTime(filter.from) ?? start)).toISOString(),
    to: new Date(Math.min(nextBucket(start, granularity), parseTime(filter.to) ?? Infinity)).toISOString(),
  }));
};
