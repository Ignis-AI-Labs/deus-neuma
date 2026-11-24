import { independentTokenPrice } from './lp-budget-independent.js';

const MARKET_FEE_BPS = 100n;
const BPS = 10_000n;

/** Conservative expected output from two independent USD markets. Pure. */
export const marketOutputFloor = ({ amountIn, decimalsIn, decimalsOut, priceInUsd, priceOutUsd, slippagePct }) => {
  if (!(priceInUsd > 0) || !(priceOutUsd > 0)) return null;
  const priceInMicro = BigInt(Math.floor(priceInUsd * 1e6));
  const priceOutMicro = BigInt(Math.ceil(priceOutUsd * 1e6));
  const slipBps = BigInt(Math.round(Number(slippagePct) * 100));
  if (priceInMicro <= 0n || priceOutMicro <= 0n || slipBps < 0n || slipBps + MARKET_FEE_BPS >= BPS) return null;
  const difference = Number(decimalsOut) - Number(decimalsIn);
  const expected = difference >= 0
    ? amountIn * priceInMicro * (10n ** BigInt(difference)) / priceOutMicro
    : amountIn * priceInMicro / (priceOutMicro * (10n ** BigInt(-difference)));
  return { ok: true, expectedOut: expected, floor: expected * (BPS - slipBps - MARKET_FEE_BPS) / BPS };
};

/** Independent prices are mandatory; an unpriced swap has no safe floor. impure — HTTP. */
export const independentSwapFloor = async ({ amountIn, decimalsIn, decimalsOut, tokenIn, tokenOut, slippagePct }) => {
  const [priceInUsd, priceOutUsd] = await Promise.all([independentTokenPrice(tokenIn), independentTokenPrice(tokenOut)]);
  const priced = marketOutputFloor({ amountIn, decimalsIn, decimalsOut, priceInUsd, priceOutUsd, slippagePct });
  return priced ?? { ok: false, reason: 'Independent token prices are unavailable or disagree, so this swap has no safe minimum output. Nothing was signed.' };
};
