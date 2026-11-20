// aggregator-policy.js — what the LP wallet signs for a swap through
// KyberSwap's aggregator (Design note, 2026-11-13: […], after Tenekom paid 3.47% to enter a thin
// Umbrae pool that KyberSwap would have filled at ~0.1%). Pure.
//
// The same law as Umbrae's router (trade-policy.js), held as tightly:
//   · ONE contract, pinned: KyberSwap's MetaAggregationRouterV2, the same
//     address on every chain (its code on Base checked 2026-11-13);
//   · its full swap call only, no ETH sent with it;
//   · the output paid to the wallet that signs (dstReceiver), in a token
//     Umbrae's pools trade, for a token Umbrae's pools trade;
//   · no fee to anyone, no permit, no partial-fill or other flag;
//   · the pinned executor only, no approval target, and source amounts that
//     sum exactly to the input the operator approved;
//   · a minimum out above zero — and the run binds it to its own floor
//     (lp-tx-policy.js checkLpIntent), so the aggregator's answer cannot lower it.
// The router itself reverts any swap that pays the receiver less than that
// minimum; executor routing and exact allowances are bound here as well.

import { Interface, ZeroAddress, getAddress, isAddress } from 'ethers';

/** KyberSwap MetaAggregationRouterV2 (same address on every EVM chain; on Base checked 2026-11-13). */
export const KYBER_ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
/** The executor KyberSwap's Base route builder returned when this policy was pinned. */
export const KYBER_EXECUTOR = '0x8F10B468b06c6FD214B65F87778827F7D113f996';

const DESC = '(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit)';
// Selectors 0xe21fd0e9 (swap) and 0x8af033fb (swapSimpleMode); only full swap is admitted.
export const KYBER_ABI = Object.freeze([
  `function swap((address callTarget,address approveTarget,bytes targetData,${DESC} desc,bytes clientData) execution)`,
  `function swapSimpleMode(address caller,${DESC} desc,bytes executorData,bytes clientData)`,
]);
const KYBER = new Interface(KYBER_ABI);
const refuse = (reason) => Object.freeze({ ok: false, reason });
const has = (set, address) => isAddress(address) && Boolean(set?.has(getAddress(address)));
const same = (a, b) => isAddress(a) && isAddress(b) && getAddress(a) === getAddress(b);

const classify = (tx, { wallet, tokens } = {}) => {
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
  if (!call || call.name !== 'swap') return refuse('The only KyberSwap call this wallet signs is a full swap.');
  const execution = call.args[0];
  const desc = execution.desc;
  if (!same(execution.callTarget, KYBER_EXECUTOR)) return refuse('The swap names an executor other than the pinned Kyber executor.');
  if (!same(execution.approveTarget, ZeroAddress)) return refuse('The swap carries an approval target. Only a separate exact approval is signed here.');
  if (!isAddress(wallet) || getAddress(desc.dstReceiver) !== getAddress(wallet)) {
    return refuse('The swap would pay a different wallet. What a swap buys returns to the wallet that signs.');
  }
  if (!has(tokens, desc.srcToken) || !has(tokens, desc.dstToken)) return refuse('The swap touches a token none of Umbrae\'s pools trade.');
  if (desc.feeReceivers.length || desc.feeAmounts.length) return refuse('The swap pays a fee to someone. A swap here pays no one but the pools.');
  if (desc.permit !== '0x') return refuse('The swap carries a permit. Only an exact approval is signed here.');
  if (BigInt(desc.flags) !== 0n) return refuse('The swap carries flags. No partial-fill or other Kyber flag is signed here.');
  if (desc.amount <= 0n) return refuse('The swap moves nothing.');
  if (desc.minReturnAmount <= 0n) return refuse('The swap has no minimum out. Without one, it can be robbed on the way.');
  if (!desc.srcReceivers.length || desc.srcReceivers.length !== desc.srcAmounts.length
      || desc.srcReceivers.some((receiver) => !same(receiver, KYBER_EXECUTOR))) {
    return refuse('The swap\'s source receivers are not bound to the pinned Kyber executor.');
  }
  const sourceTotal = desc.srcAmounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
  if (sourceTotal !== desc.amount) return refuse('The swap\'s source amounts do not sum to the approved input.');
  return Object.freeze({
    ok: true, kind: 'swap', action: 'kyberswap.swap', via: 'kyberswap',
    tokenIn: getAddress(desc.srcToken), tokenOut: getAddress(desc.dstToken),
    amountIn: desc.amount.toString(), amountOutMin: desc.minReturnAmount.toString(),
  });
};

/**
 * A call to KyberSwap's router. Pure and fail-closed on malformed addresses.
 * @param {{data: string, value?: string}} tx
 * @param {{wallet: string, tokens: Set<string>}} ctx
 * @returns {Readonly<object>}
 */
export const classifyAggregatorSwap = (tx, ctx) => {
  try {
    return classify(tx, ctx);
  } catch {
    return refuse('The aggregator transaction could not be decoded safely.');
  }
};
