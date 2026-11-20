import { ethers } from 'ethers';
import { depositMicroUsd } from '../../../core/wallet/lp-tx-policy.js';
import { tokenMarkets, tokenPriceGecko } from '../market-map/market-data.js';
import { poolTokensOnChain, positionCountOnChain, positionOnChain, withdrawalAmountsOnChain } from './lp-quotes.js';

const DECIMALS = new ethers.Interface(['function decimals() view returns (uint8)']);
const same = (a, b) => ethers.isAddress(a) && ethers.isAddress(b) && ethers.getAddress(a) === ethers.getAddress(b);

export const independentTokenPrice = async (token) => {
  const [answer, gecko] = await Promise.all([tokenMarkets(token, 'base'), tokenPriceGecko(token, 'base')]);
  if (!answer.ok || !gecko.ok) return null;
  const markets = answer.data.map((market) => {
    const liquidity = Number(market?.liquidity?.usd);
    if (!Number.isFinite(liquidity) || liquidity <= 0) return null;
    let usd = null;
    if (same(market?.baseToken?.address, token)) usd = Number(market.priceUsd);
    if (same(market?.quoteToken?.address, token)) {
      const baseUsd = Number(market?.baseToken?.priceUsd);
      const native = Number(market.priceNative);
      if (baseUsd > 0 && native > 0) usd = baseUsd / native;
    }
    return Number.isFinite(usd) && usd > 0 ? { liquidity, usd } : null;
  }).filter(Boolean).sort((a, b) => b.liquidity - a.liquidity);
  const dexUsd = markets[0]?.usd ?? null;
  if (dexUsd === null) return null;
  const larger = Math.max(dexUsd, gecko.usd);
  if (Math.abs(dexUsd - gecko.usd) > larger * 0.02) return null;
  return larger;
};

const decimals = async (provider, token) => {
  const answer = await provider.call({ to: token, data: DECIMALS.encodeFunctionData('decimals', []) });
  const value = Number(DECIMALS.decodeFunctionResult('decimals', answer)[0]);
  if (!Number.isInteger(value) || value < 0 || value > 36) throw new Error('Unreadable token decimals');
  return value;
};

// impure — the wallet's positions as Base holds them (P6-13). Umbrae's list only NAMES the
// token IDs; each must be a different ID that Base says this wallet owns, and together they
// must be every position the wallet has, so none is hidden and none counted for another.
// Each position's tokens are read from its own pool on Base, never taken from Umbrae's word.
const positionsOnChain = async (provider, wallet, listed) => {
  const ids = listed.map((position) => String(position?.publicKey ?? ''));
  if (ids.some((id) => !/^\d{1,78}$/.test(id)) || new Set(ids.map((id) => BigInt(id))).size !== ids.length) throw new Error('Unreadable position identity');
  if (await positionCountOnChain(provider, wallet) !== ids.length) throw new Error('Umbrae\'s position list is not the wallet\'s positions on Base');
  return Promise.all(ids.map(async (tokenId) => {
    const held = await positionOnChain(provider, tokenId);
    if (held.owner !== ethers.getAddress(wallet)) throw new Error('A listed position is not this wallet\'s on Base');
    const { tokenX, tokenY } = await poolTokensOnChain(provider, held.pairAddress);
    return { tokenId, tokenX, tokenY };
  }));
};

const positionValue = async (provider, { tokenId, tokenX, tokenY }, prices, wallet) => {
  const [amounts, decimalsX, decimalsY] = await Promise.all([
    withdrawalAmountsOnChain(provider, tokenId, 10000, wallet), decimals(provider, tokenX), decimals(provider, tokenY),
  ]);
  const value = depositMicroUsd({
    amountX: amounts.amountX.toString(), amountY: amounts.amountY.toString(), decimalsX, decimalsY,
    priceXUsd: prices.get(ethers.getAddress(tokenX)), priceYUsd: prices.get(ethers.getAddress(tokenY)),
  });
  if (value === null) throw new Error('No independent position valuation');
  return value;
};

export const independentBudgetFigures = async ({ provider, fields, raw, wallet, positionsPayload }) => {
  try {
    const pools = Array.isArray(positionsPayload) ? positionsPayload : [];
    const positions = await positionsOnChain(provider, wallet, pools.flatMap((pool) => pool?.positions?.userPositions ?? []));
    const tokens = new Set([ethers.getAddress(fields.tokenX), ethers.getAddress(fields.tokenY), ...positions.flatMap((p) => [p.tokenX, p.tokenY])]);
    const prices = new Map(await Promise.all([...tokens].map(async (token) => [token, await independentTokenPrice(token)])));
    if ([...prices.values()].some((value) => value === null)) return null;
    const [decimalsX, decimalsY] = await Promise.all([decimals(provider, fields.tokenX), decimals(provider, fields.tokenY)]);
    const deposit = depositMicroUsd({ ...raw, decimalsX, decimalsY, priceXUsd: prices.get(ethers.getAddress(fields.tokenX)), priceYUsd: prices.get(ethers.getAddress(fields.tokenY)) });
    if (deposit === null) return null;
    let deployed = 0n;
    for (const position of positions) deployed += await positionValue(provider, position, prices, wallet);
    return { deployedMicroUsd: deployed, depositMicroUsd: deposit };
  } catch {
    return null;
  }
};

/** Is the fresh independent value within 2% of the one the operator saw? Pure. */
export const depositWithinSnapshot = (currentMicroUsd, expectedUsd) => {
  if (currentMicroUsd === null || currentMicroUsd === undefined) return false;
  let expected;
  let current;
  try {
    expected = ethers.parseUnits(String(expectedUsd), 6);
    current = BigInt(currentMicroUsd);
  } catch {
    return false;
  }
  const larger = current > expected ? current : expected;
  const difference = current > expected ? current - expected : expected - current;
  return difference * 100n <= larger * 2n;
};
