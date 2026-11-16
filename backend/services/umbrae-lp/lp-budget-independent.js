import { ethers } from 'ethers';
import { depositMicroUsd } from '../../../core/wallet/lp-tx-policy.js';
import { tokenMarkets, tokenPriceGecko } from '../market-map/market-data.js';
import { positionCountOnChain, withdrawalAmountsOnChain } from './lp-quotes.js';

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

const positionValue = async (provider, pool, position, prices, wallet) => {
  const tokenX = pool.poolInfo?.mint_x;
  const tokenY = pool.poolInfo?.mint_y;
  const tokenId = position?.publicKey;
  if (!ethers.isAddress(tokenX) || !ethers.isAddress(tokenY) || !/^\d+$/.test(String(tokenId))) throw new Error('Unreadable position identity');
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
    const positions = pools.flatMap((pool) => (pool?.positions?.userPositions ?? []).map((position) => ({ pool, position })));
    const actualCount = await positionCountOnChain(provider, wallet);
    if (actualCount !== positions.length) return null;
    const tokens = new Set([ethers.getAddress(fields.tokenX), ethers.getAddress(fields.tokenY)]);
    for (const pool of pools) {
      if (ethers.isAddress(pool.poolInfo?.mint_x)) tokens.add(ethers.getAddress(pool.poolInfo.mint_x));
      if (ethers.isAddress(pool.poolInfo?.mint_y)) tokens.add(ethers.getAddress(pool.poolInfo.mint_y));
    }
    const prices = new Map(await Promise.all([...tokens].map(async (token) => [token, await independentTokenPrice(token)])));
    if ([...prices.values()].some((value) => value === null)) return null;
    const [decimalsX, decimalsY] = await Promise.all([decimals(provider, fields.tokenX), decimals(provider, fields.tokenY)]);
    const deposit = depositMicroUsd({ ...raw, decimalsX, decimalsY, priceXUsd: prices.get(ethers.getAddress(fields.tokenX)), priceYUsd: prices.get(ethers.getAddress(fields.tokenY)) });
    if (deposit === null) return null;
    let deployed = 0n;
    for (const { pool, position } of positions) deployed += await positionValue(provider, pool, position, prices, wallet);
    return { deployedMicroUsd: deployed, depositMicroUsd: deposit };
  } catch {
    return null;
  }
};
