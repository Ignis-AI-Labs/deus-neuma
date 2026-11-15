// aggregator-policy.js — what the LP wallet signs for a swap through
// KyberSwap's aggregator (Design note, 2026-11-13: […], after Tenekom paid 3.47% to enter a thin
// Umbrae pool that KyberSwap would have filled at ~0.1%). Pure.
//
// The same law as Umbrae's router (trade-policy.js), held as tightly:
//   · ONE contract, pinned: KyberSwap's MetaAggregationRouterV2, the same
//     address on every chain (its code on Base checked 2026-11-13);
//   · its swap call only, no ETH sent with it;
//   · the output paid to the wallet that signs (dstReceiver), in a token
//     Umbrae's pools trade, for a token Umbrae's pools trade;
//   · no fee to anyone (feeReceivers empty), no permit, no flag that claims,
//     burns or fills partly;
//   · a minimum out above zero — and the run binds it to its own floor
//     (lp-tx-policy.js checkLpIntent), so the aggregator's answer cannot lower it.
// The router itself reverts any swap that pays the receiver less than that
// minimum, so the worst a bad route can do is cost gas.

import { Interface, getAddress, isAddress } from 'ethers';

/** KyberSwap MetaAggregationRouterV2 (same address on every EVM chain; on Base checked 2026-11-13). */
export const KYBER_ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';

const DESC = '(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit)';
// Selectors 0xe21fd0e9 (swap) and 0x8af033fb (swapSimpleMode); swap decoded from KyberSwap's own build answer 2026-11-13.
export const KYBER_ABI = Object.freeze([
  `function swap((address callTarget,address approveTarget,bytes targetData,${DESC} desc,bytes clientData) execution)`,
  `function swapSimpleMode(address caller,${DESC} desc,bytes executorData,bytes clientData)`,
]);
const KYBER = new Interface(KYBER_ABI);
const refuse = (reason) => Object.freeze({ ok: false, reason });
const has = (set, address) => isAddress(address) && Boolean(set?.has(getAddress(address)));

/**
 * A call to KyberSwap's router. Pure.
 *
 * @param {{data: string, value?: string}} tx
 * @param {{wallet: string, tokens: Set<string>}} ctx - tokens: checksummed addresses Umbrae's pools trade
 * @returns {Readonly<{ok: true, kind: 'swap', action: string, via: 'kyberswap', tokenIn: string, tokenOut: string,
 *   amountIn: string, amountOutMin: string} | {ok: false, reason: string}>}
 */
export const classifyAggregatorSwap = (tx, { wallet, tokens } = {}) => {
  let value;
  try {
    value = BigInt(tx?.value ?? 0);
  } catch {
    return refuse('The swap\'s value is not a number.');
  }
  if (value !== 0n) return refuse('An aggregator swap sends no ETH with it.');
  let call;
  try {
    call = KYBER.parseTransaction({ data: tx?.data });
  } catch {
    call = null;
  }
  if (!call) return refuse('The only KyberSwap call this wallet signs is a swap.');
  const desc = call.name === 'swap' ? call.args[0].desc : call.args.desc;
  if (!isAddress(wallet) || getAddress(desc.dstReceiver) !== getAddress(wallet)) {
    return refuse('The swap would pay a different wallet. What a swap buys returns to the wallet that signs.');
  }
  if (!has(tokens, desc.srcToken) || !has(tokens, desc.dstToken)) return refuse('The swap touches a token none of Umbrae\'s pools trade.');
  if (desc.feeReceivers.length || desc.feeAmounts.length) return refuse('The swap pays a fee to someone. A swap here pays no one but the pools.');
  if (desc.permit !== '0x') return refuse('The swap carries a permit. Only an exact approval is signed here.');
  const flags = BigInt(desc.flags);
  if (flags !== 0n && flags !== 0x200n) return refuse('The swap carries flags other than the known Kyber route flag.');
  if (desc.amount <= 0n) return refuse('The swap moves nothing.');
  if (desc.minReturnAmount <= 0n) return refuse('The swap has no minimum out. Without one, it can be robbed on the way.');
  return Object.freeze({
    ok: true, kind: 'swap', action: `kyberswap.${call.name}`, via: 'kyberswap',
    tokenIn: getAddress(desc.srcToken), tokenOut: getAddress(desc.dstToken),
    amountIn: desc.amount.toString(), amountOutMin: desc.minReturnAmount.toString(),
  });
};
