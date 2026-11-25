import { ethers } from 'ethers';
import { independentTokenPrice } from './lp-budget-independent.js';
import { poolTokensOnChain } from './lp-quotes.js';
import { PINNED_TOKENS } from './lp-tokens.js';

const ACTIVE_ID = new ethers.Interface(['function getActiveId() view returns (uint24)']);
const SAME_BIN = 8_388_608;
const WETH = ethers.getAddress(PINNED_TOKENS.WETH);
const USDC = ethers.getAddress(PINNED_TOKENS.USDC);

const agrees = (a, b) => {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false;
  return Math.abs(a - b) <= Math.max(a, b) * 0.02;
};

const candidateFor = (payload, token, quote) => {
  const candidates = [];
  for (const group of Array.isArray(payload?.groups) ? payload.groups : []) {
    for (const pair of Array.isArray(group?.pairs) ? group.pairs : []) {
      try {
        const tokenX = ethers.getAddress(pair.mint_x ?? group.mint_x);
        const tokenY = ethers.getAddress(pair.mint_y ?? group.mint_y);
        const pool = ethers.getAddress(pair.address);
        const binStep = Number(pair.bin_step);
        const hasToken = tokenX === token || tokenY === token;
        const hasQuote = tokenX === quote || tokenY === quote;
        if (!hasToken || !hasQuote || !Number.isInteger(binStep) || binStep < 1) continue;
        candidates.push({ tokenX, tokenY, pool, binStep, liquidity: Number(pair.liquidity) || 0 });
      } catch { /* a malformed candidate is not price evidence */ }
    }
  }
  return candidates.sort((a, b) => b.liquidity - a.liquidity)[0] ?? null;
};

// impure — verify the pool's own identity and active bin, never its HTTP price.
const spotFor = async (provider, candidate, token, quoteUsd) => {
  const [identity, activeAnswer] = await Promise.all([
    poolTokensOnChain(provider, candidate.pool),
    provider.call({ to: candidate.pool, data: ACTIVE_ID.encodeFunctionData('getActiveId', []) }),
  ]);
  if (identity.tokenX !== candidate.tokenX || identity.tokenY !== candidate.tokenY || identity.binStep !== candidate.binStep) {
    throw new Error('Pool identity changed');
  }
  const activeId = Number(ACTIVE_ID.decodeFunctionResult('getActiveId', activeAnswer)[0]);
  const yPerX = (1 + candidate.binStep / 10000) ** (activeId - SAME_BIN);
  if (!Number.isFinite(yPerX) || yPerX <= 0) throw new Error('Pool spot is invalid');
  const usd = token === candidate.tokenX ? yPerX * quoteUsd : quoteUsd / yPerX;
  return Number.isFinite(usd) && usd > 0 ? usd : null;
};

/**
 * Conservative token USD price from independent markets and an on-chain spot.
 * Null means unpriced; it never means zero. impure — HTTP and chain reads.
 */
export const verifiedPoolPrice = async (provider, token, payload) => {
  const address = ethers.getAddress(token);
  const market = await independentTokenPrice(address);
  if (market === null) return null;
  if (address === USDC) return agrees(market, 1) ? Math.min(market, 1) : null;
  try {
    let candidate = candidateFor(payload, address, USDC);
    let quoteUsd = 1;
    if (!candidate && address !== WETH) {
      candidate = candidateFor(payload, address, WETH);
      if (candidate) quoteUsd = await verifiedPoolPrice(provider, WETH, payload);
    }
    if (!candidate || quoteUsd === null) return null;
    const spot = await spotFor(provider, candidate, address, quoteUsd);
    return agrees(market, spot) ? Math.min(market, spot) : null;
  } catch {
    return null;
  }
};
