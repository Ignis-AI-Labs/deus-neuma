// Receipt rows — the pure shapes of the money-in ledger: Transfer-log
// decoding, the dedupe key, the row itself, and its USD value.
//
// A row is a RECEIPT, never an estimate: the amount is the chain's own base
// units (a decimal string, exact) with the human decimal string beside it.
// The USD value carries its basis on the row, so a reader can always tell a
// price at receipt time from a price at detection time.
//
// pure.

import { ethers } from 'ethers';

/** keccak("Transfer(address,address,uint256)") — the ERC-20 receipt event. */
export const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

/** An address as the 32-byte topic a log filter matches on. pure. */
export const addressTopic = (address) => ethers.zeroPadValue(ethers.getAddress(address), 32).toLowerCase();

// A 32-byte topic holding an address decodes by dropping the padding.
const topicAddress = (topic) => ethers.getAddress(`0x${String(topic).slice(26)}`);

/**
 * Decode one ERC-20 Transfer log. Returns null for anything that is not a
 * well-formed ERC-20 Transfer (an ERC-721 Transfer indexes its third
 * argument and carries empty data — not money, never counted). pure.
 * @param {{ topics: string[], data: string }} log
 * @returns {{ from: string, to: string, amountRaw: string }|null}
 */
export const decodeTransferLog = (log) => {
  const topics = Array.isArray(log?.topics) ? log.topics : [];
  if (topics.length !== 3 || String(topics[0]).toLowerCase() !== TRANSFER_TOPIC) return null;
  if (typeof log.data !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(log.data)) return null;
  return { from: topicAddress(topics[1]), to: topicAddress(topics[2]), amountRaw: BigInt(log.data).toString() };
};

/**
 * The dedupe key: (network, txHash, logIndex). A native receipt has no log,
 * so its index slot reads `native` — one tx pays one `to`, so the pair is
 * unique. pure.
 */
export const receiptKey = ({ network, txHash, logIndex }) =>
  `${network}:${String(txHash).toLowerCase()}:${logIndex === null || logIndex === undefined ? 'native' : logIndex}`;

/**
 * The USD value of an amount at a price, rounded to a micro-dollar, or null
 * when there is no price. Float math is deliberate and bounded: the exact
 * figure is the base-unit amount; USD is a reading of it. pure.
 * @param {string} amountRaw - base units, decimal string
 * @param {number} decimals
 * @param {number|null} usdPrice
 * @returns {number|null}
 */
export const usdValueOf = (amountRaw, decimals, usdPrice) => {
  if (typeof usdPrice !== 'number' || !Number.isFinite(usdPrice)) return null;
  const amount = Number(ethers.formatUnits(BigInt(amountRaw), decimals));
  return Math.round(amount * usdPrice * 1e6) / 1e6;
};

/**
 * One ledger row. pure.
 * @param {object} r
 * @param {string} r.network
 * @param {{symbol: string, decimals: number, kind: string, address?: string}} r.asset
 * @param {string} r.amountRaw
 * @param {string} r.from
 * @param {{address: string, member: string|null, label: string|null}} r.to - the watched house address
 * @param {number} r.block
 * @param {number} r.timestamp - block time, epoch seconds
 * @param {string} r.txHash
 * @param {number|null} r.logIndex
 * @param {boolean} r.internal - the sender is itself a house address (house money moving, not money in)
 * @param {string} r.detectedAt - ISO
 * @returns {object}
 */
export const makeReceipt = ({ network, asset, amountRaw, from, to, block, timestamp, txHash, logIndex, internal, detectedAt }) =>
  Object.freeze({
    key: receiptKey({ network, txHash, logIndex }),
    network,
    asset: asset.symbol,
    assetKind: asset.kind,
    token: asset.kind === 'erc20' ? asset.address : null,
    decimals: asset.decimals,
    amountRaw: String(amountRaw),
    amount: ethers.formatUnits(BigInt(amountRaw), asset.decimals),
    from: ethers.getAddress(from),
    to: ethers.getAddress(to.address),
    member: to.member ?? null,
    memberLabel: to.label ?? null,
    block,
    timestamp: new Date(timestamp * 1000).toISOString(),
    txHash: String(txHash).toLowerCase(),
    logIndex: logIndex ?? null,
    internal: internal === true,
    detectedAt,
    usd: null,
    price: null,
    attribution: null,
  });

/**
 * Price a batch of rows. `prices` maps a CoinGecko id to a spot USD price
 * read at `priceAt`; an unpriced id leaves the row's usd null — never a
 * fabricated figure. pure.
 * @param {object[]} rows
 * @param {Map<string, {decimals:number, priceId:string}>} assetsByKey - `${network}:${symbol}` → asset
 * @param {Record<string, number>} prices
 * @param {{ priceAt: string, source: string }} basis
 */
export const priceRows = (rows, assetsByKey, prices, { priceAt, source }) => rows.map((row) => {
  const asset = assetsByKey.get(`${row.network}:${row.asset}`);
  const usdPrice = asset ? prices[asset.priceId] : undefined;
  if (typeof usdPrice !== 'number') return row;
  return Object.freeze({
    ...row,
    usd: usdValueOf(row.amountRaw, row.decimals, usdPrice),
    // `spot-at-detection`: the feed's price when the scan SAW the receipt,
    // not at its block time — a catch-up scan hours later prices it late,
    // and the two timestamps on the row show by how much.
    price: Object.freeze({ usd: usdPrice, basis: 'spot-at-detection', source, priceAt }),
  });
});

/**
 * Rows not yet in the ledger, deduped within the batch too. pure.
 * @param {Set<string>} knownKeys
 * @param {object[]} rows
 * @returns {object[]}
 */
export const freshRows = (knownKeys, rows) => {
  const seen = new Set(knownKeys);
  const out = [];
  for (const row of rows) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    out.push(row);
  }
  return out;
};
