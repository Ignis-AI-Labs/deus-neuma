import { ethers } from 'ethers';
import { UMBRAE_BASE } from '../../../core/wallet/lp-tx-policy.js';

const MANAGER = new ethers.Interface([
  'function createPositionWithStrategy(address tokenX, address tokenY, uint16 binStep, uint16 baseFactor, uint256 amountX, uint256 amountY, uint8 strategy, uint24 binRange, uint8 bidAskRatio, uint24 centerBinId, bool skipActiveBin, uint24 activeIdDesired, uint24 idSlippage, uint256 minTotalLiquidity, address recipient, uint256 deadline) returns (uint256 tokenId, uint256[] liquidityMinted)',
  'function increasePositionWithStrategy(uint256 tokenId, uint256 amountX, uint256 amountY, uint24 centerBinId, bool skipActiveBin, uint24 activeIdDesired, uint24 idSlippage, uint256 minTotalLiquidity, uint256 deadline) returns (uint256[] liquidityMinted)',
  'function decreasePositionByPercent(uint256 tokenId, uint16 bps, uint256 amountXMin, uint256 amountYMin, address recipient, uint256 deadline) returns (uint256 amountX, uint256 amountY)',
  'function closePosition(uint256 tokenId, uint256 amountXMin, uint256 amountYMin, address recipient, uint256 deadline) returns (uint256 amountX, uint256 amountY)',
]);
const POOL = new ethers.Interface([
  'function getActiveId() view returns (uint24)',
  'function getQuoteState() view returns (tuple(uint16 baseFactor, uint16 filterPeriod, uint16 decayPeriod, uint16 reductionFactor, uint16 variableFeeControl, uint24 maxVolatilityAccumulator, uint16 minSwapBps) feeParams, uint128 volatilityAccumulator, uint24 volatilityReference, uint40 lastVolatilityUpdate, uint256 scaleX, uint256 scaleY, address factory)',
]);
const POSITIONS = new ethers.Interface(['function balanceOf(address wallet) view returns (uint256)']);
const TOKEN = new ethers.Interface(['function decimals() view returns (uint8)']);
const percentFloor = (value) => (value * 9900n) / 10000n;

const read = async (provider, to, iface, name, args, from) => iface.decodeFunctionResult(
  name,
  await provider.call({ to, from, data: iface.encodeFunctionData(name, args) }),
);

export const poolBaseFactorOnChain = async (provider, pool) => {
  const state = await read(provider, pool, POOL, 'getQuoteState', []);
  return Number(state.feeParams.baseFactor);
};

export const tokenDecimalsOnChain = async (provider, token) => {
  const answer = await read(provider, token, TOKEN, 'decimals', []);
  const decimals = Number(answer[0]);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unreadable token decimals');
  return decimals;
};

export const quoteDepositOnChain = async (provider, fields, asked, raw) => {
  const [active, baseFactor] = await Promise.all([
    read(provider, asked.pool, POOL, 'getActiveId', []),
    poolBaseFactorOnChain(provider, asked.pool),
  ]);
  const activeIdDesired = Number(active[0]);
  const strategy = {
    strategy: asked.strategy,
    binRange: asked.binRange,
    bidAskRatio: 50,
    centerBinId: activeIdDesired,
    skipActiveBin: BigInt(raw.amountX) === 0n || BigInt(raw.amountY) === 0n,
  };
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const name = asked.type === 'open' ? 'createPositionWithStrategy' : 'increasePositionWithStrategy';
  const args = asked.type === 'open'
    ? [
      fields.tokenX, fields.tokenY, fields.binStep, baseFactor, raw.amountX, raw.amountY,
      strategy.strategy, strategy.binRange, strategy.bidAskRatio, strategy.centerBinId, strategy.skipActiveBin,
      activeIdDesired, 10, 0n, fields.walletAddress, deadline,
    ]
    : [
      asked.tokenId, raw.amountX, raw.amountY, strategy.centerBinId, strategy.skipActiveBin,
      activeIdDesired, 10, 0n, deadline,
    ];
  const distribution = await read(provider, UMBRAE_BASE.positionManager, MANAGER, name, args, fields.walletAddress);
  const total = distribution.liquidityMinted.reduce((sum, value) => sum + value, 0n);
  if (total <= 0n) throw new Error('Base returned zero liquidity for this deposit');
  return {
    ...strategy,
    binStep: fields.binStep,
    baseFactor,
    activeIdDesired,
    idSlippage: 10,
    minTotalLiquidity: percentFloor(total).toString(),
  };
};

export const withdrawalAmountsOnChain = async (provider, tokenId, bps, owner) => {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const name = bps === 10000 ? 'closePosition' : 'decreasePositionByPercent';
  const args = bps === 10000
    ? [tokenId, 0n, 0n, owner, deadline]
    : [tokenId, bps, 0n, 0n, owner, deadline];
  return read(provider, UMBRAE_BASE.positionManager, MANAGER, name, args, owner);
};

export const quoteExitOnChain = async (provider, asked) => {
  if (asked.type === 'claim') return null;
  const bps = asked.type === 'close' ? 10000 : asked.percent * 100;
  const amounts = await withdrawalAmountsOnChain(provider, asked.tokenId, bps, asked.walletAddress);
  if (amounts.amountX === 0n && amounts.amountY === 0n) throw new Error('Base returned no proceeds for this withdrawal');
  return { bps: String(bps), amountXMin: percentFloor(amounts.amountX).toString(), amountYMin: percentFloor(amounts.amountY).toString() };
};

export const positionCountOnChain = async (provider, wallet) => {
  const answer = await read(provider, UMBRAE_BASE.positionManager, POSITIONS, 'balanceOf', [wallet]);
  return Number(answer[0]);
};
