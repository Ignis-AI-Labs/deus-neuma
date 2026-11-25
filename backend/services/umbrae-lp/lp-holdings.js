// lp-holdings.js — what an LP wallet holds right now, raw and priced: its ETH
// and every token Umbrae's pools trade. Read by the earnings book (lp-book.js)
// before and after each act, and by the wallet view. Read-only.
//
// Prices require independent-market and on-chain active-bin agreement; ETH is
// priced as WETH. A token whose balance Base will not give is left out (never
// read as zero), and the whole read is null when Base does not answer at all.

import { ethers } from 'ethers';
import { callUmbrae } from './umbrae-lp-client.js';
import { lpBase } from './lp-base.js';
import { PINNED_TOKENS, tokenLabel } from './lp-tokens.js';
import { verifiedPoolPrice } from './lp-price-feeds.js';

const WETH = PINNED_TOKENS.WETH;
const ERC20 = new ethers.Interface(['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)']);
const price = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/**
 * Every token the pool list trades, with Umbrae's dollar price. Pure.
 *
 * Umbrae prices a token per pair group, and a thin group can sit far from the
 * market (2026-11-13: WETH $2,133 in a $560 WETH-USDC group, $1,954.82 in the
 * $33k U1-WETH group, market $1,955). So each token takes its price from the
 * DEEPEST group that prices it (the most liquidity across its pools).
 *
 * @param {object} payload - Umbrae's /pools answer
 * @returns {Map<string, {symbol: string, priceUsd: number|null}>} checksummed address → token
 */
export const poolTokens = (payload) => {
  const out = new Map();
  const depthOf = new Map();
  for (const group of Array.isArray(payload?.groups) ? payload.groups : []) {
    const depth = (group.pairs ?? []).reduce((sum, p) => sum + (Number(p.liquidity) || 0), 0);
    for (const pair of group.pairs ?? []) {
      [[pair.mint_x ?? group.mint_x, group.tokenX, group.tokenXPrice], [pair.mint_y ?? group.mint_y, group.tokenY, group.tokenYPrice]].forEach(([address, symbol, usd]) => {
        if (!ethers.isAddress(address)) return;
        const key = ethers.getAddress(address);
        const known = out.get(key);
        const deeper = price(usd) !== null && (known?.priceUsd === null || known === undefined || depth > (depthOf.get(key) ?? -1));
        if (deeper) depthOf.set(key, depth);
        out.set(key, { symbol: known?.symbol ?? tokenLabel(key, symbol), priceUsd: deeper ? price(usd) : known?.priceUsd ?? null });
      });
    }
  }
  return out;
};

/**
 * The wallet's holdings, or null when Base does not answer.
 * impure — reads Umbrae's pool list and Base.
 *
 * @param {string} address
 * @param {{provider?: ethers.Provider, pools?: object}} [opts] - pools: an Umbrae /pools answer already read
 * @returns {Promise<null | Array<{key: string, symbol: string, decimals: number, raw: string, priceUsd: number|null}>>}
 */
export const readHoldings = async (address, { provider, pools } = {}) => {
  const base = provider ?? await lpBase().catch(() => null);
  if (!base) return null;
  let payload = pools;
  if (!payload) {
    const out = await callUmbrae('pools');
    payload = out.ok ? out.payload : null;
  }
  const known = poolTokens(payload);
  const prices = new Map();
  const priceFor = (token) => {
    const key = ethers.getAddress(token);
    if (!prices.has(key)) prices.set(key, verifiedPoolPrice(base, key, payload).catch(() => null));
    return prices.get(key);
  };
  // Raw JSON-RPC on purpose: ethers answers a repeat of the same read within 250 ms from its own
  // cache, and the book reads the same balances just before and just after an act.
  const raw = (method, params) => base.send(method, params);
  let eth;
  try {
    eth = BigInt(await raw('eth_getBalance', [address, 'latest']));
  } catch {
    return null;
  }
  const read = await Promise.all([...known].map(async ([token, { symbol }]) => {
    try {
      const [held, decimals, priceUsd] = await Promise.all([
        raw('eth_call', [{ to: token, data: ERC20.encodeFunctionData('balanceOf', [address]) }, 'latest']),
        raw('eth_call', [{ to: token, data: ERC20.encodeFunctionData('decimals') }, 'latest']),
        priceFor(token),
      ]);
      return { key: token, symbol, decimals: Number(BigInt(decimals)), raw: BigInt(held).toString(), priceUsd };
    } catch {
      return null;
    }
  }));
  return [{ key: 'ETH', symbol: 'ETH', decimals: 18, raw: eth.toString(), priceUsd: await priceFor(WETH) }, ...read.filter(Boolean)];
};
