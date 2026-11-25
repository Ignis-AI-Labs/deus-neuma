/**
 * Trade policy — the pure rule for the two things a house member's LP wallet
 * may do besides Umbrae positions (Design note, 2026-11-13, […], […], […]):
 *
 *   · a SWAP, only through Umbrae's router, only `swapExactTokensForTokens`,
 *     only between tokens Umbrae's pools trade, paid to the wallet that signs,
 *     and never with a zero minimum out (a swap with no floor can be robbed);
 *   · a SEND of ETH or a pool token, only to an address of the house (any
 *     member's wallets, the operator's own) or on the operator's allowlist.
 *
 * Every contract it can touch is named here: Umbrae's router, and the tokens
 * Umbrae's pools trade. A transaction to anything else is not a swap or a send.
 *
 * Pure: no IO, no clock. The caller hands in the token set and the recipients.
 */

import { Interface, getAddress, isAddress } from 'ethers';

/** Umbrae's DLMM V2 router on Base (contracts.json; on Base its FACTORY() is
 *  Umbrae's factory and its owner Umbrae's timelock, checked 2026-11-13). */
export const UMBRAE_ROUTER = '0x5A7673d413f510f4b5c191d96837694C5942bF38';

const ROUTER = new Interface([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, uint16[] binSteps, address[] pools, address to, uint256 deadline)',
]);
const ERC20 = new Interface(['function transfer(address to, uint256 amount)']);

const refuse = (reason) => Object.freeze({ ok: false, reason });
const has = (set, address) => isAddress(address) && Boolean(set?.has(getAddress(address)));

// pure — the decoded call, or null.
const decode = (iface, data) => {
  try {
    return iface.parseTransaction({ data });
  } catch {
    return null;
  }
};

/**
 * A call to Umbrae's router. Pure.
 *
 * @param {string} data
 * @param {{wallet: string, tokens: Set<string>}} ctx - tokens: checksummed addresses Umbrae's pools trade
 * @returns {Readonly<{ok: true, kind: 'swap', action: string, tokenIn: string, tokenOut: string, amountIn: string, amountOutMin: string}
 *   | {ok: false, reason: string}>}
 */
export const classifySwap = (data, { wallet, tokens } = {}) => {
  const call = decode(ROUTER, data);
  if (!call) return refuse('The only router call this wallet signs is a swap of an exact amount in.');
  const { amountIn, amountOutMin, path, binSteps, pools, to } = call.args.toObject();
  if (!isAddress(wallet) || getAddress(to) !== getAddress(wallet)) {
    return refuse('The swap would pay a different wallet. What a swap buys returns to the wallet that signs.');
  }
  if (path.length < 2 || path.length > 4 || binSteps.length !== path.length - 1 || pools.length !== path.length - 1) {
    return refuse('The swap route is not well formed.');
  }
  if (!path.every((token) => has(tokens, token))) return refuse('The swap touches a token none of Umbrae\'s pools trade.');
  if (amountIn <= 0n) return refuse('The swap moves nothing.');
  if (amountOutMin <= 0n) return refuse('The swap has no minimum out. Without one, it can be robbed on the way.');
  return Object.freeze({
    ok: true, kind: 'swap', action: 'swapExactTokensForTokens',
    tokenIn: getAddress(path[0]), tokenOut: getAddress(path[path.length - 1]),
    amountIn: amountIn.toString(), amountOutMin: amountOutMin.toString(),
  });
};

/**
 * A send of ETH (no data, a value) or of a pool token (`transfer`). Pure.
 *
 * @param {{to: string, data: string, value?: string}} tx
 * @param {{tokens: Set<string>, recipients: Set<string>}} ctx - recipients: checksummed house and allowlisted addresses
 * @returns {Readonly<{ok: true, kind: 'transfer', action: string, token: string|null, to: string, amount: string}
 *   | {ok: false, reason: string}>}
 */
export const classifyTransfer = (tx, { tokens, recipients } = {}) => {
  let value;
  try {
    value = BigInt(tx?.value ?? 0);
  } catch {
    return refuse('The amount of ETH is not a number.');
  }
  if (tx?.data === '0x' || tx?.data === '') {
    if (value <= 0n) return refuse('The send moves nothing.');
    if (!has(recipients, tx.to)) return refuse('That address is not in the house or on the operator\'s list. Money stays inside.');
    return Object.freeze({ ok: true, kind: 'transfer', action: 'send-eth', token: null, to: getAddress(tx.to), amount: value.toString() });
  }
  if (value !== 0n) return refuse('A token send carries no ETH.');
  if (!has(tokens, tx?.to)) return refuse('The transaction is aimed at a contract this wallet does not deal with.');
  const call = decode(ERC20, tx.data);
  if (!call) return refuse('The only token call besides an approval this wallet signs is a send.');
  const { to, amount } = call.args.toObject();
  if (!has(recipients, to)) return refuse('That address is not in the house or on the operator\'s list. Money stays inside.');
  if (amount <= 0n) return refuse('The send moves nothing.');
  return Object.freeze({ ok: true, kind: 'transfer', action: 'send-token', token: getAddress(tx.to), to: getAddress(to), amount: amount.toString() });
};
