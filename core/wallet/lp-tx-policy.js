/**
 * LP transaction policy — the pure rule that decides whether a transaction
 * may be signed by a house member's LP wallet (its working wallet), and
 * whether a deposit runs on its own or waits for the operator.
 *
 * DEFAULT-DENY: a transaction is signable only when this file or
 * trade-policy.js names it. Contracts it may touch: Umbrae's position manager
 * (positions), Umbrae's router (swaps), and the tokens Umbrae's pools trade
 * (approvals naming the manager or the router, and sends). Every exit and
 * every swap pays the wallet that signed; a send reaches only the house or the
 * operator's allowlist (Design note, 2026-11-13: […]).
 *
 * This is a separate wallet under a separate rule. The identity wallet's
 * refusal of contract calldata (W3-005, neuma-wallet-spend.js) is untouched.
 *
 * Pure: no IO, no clock.
 */

import { Interface, getAddress, isAddress, parseUnits } from 'ethers';
import { UMBRAE_ROUTER, classifySwap, classifyTransfer } from './trade-policy.js';
import { positionStrings } from './lp-book-math.js';
import { KYBER_ROUTER, classifyAggregatorSwap } from './aggregator-policy.js';
import { UMBRAE_FACTORY, classifyCreatePair } from './pool-policy.js';

/** Umbrae DLMM V2 on Base, from https://www.umbrae.io/docs/dev/contracts.json
 *  (read 2026-11-12; name() and factory() checked on Base the same day). */
export const UMBRAE_BASE = Object.freeze({
  chainId: 8453,
  positionManager: '0x362A4AD56E93B71b0dBB28f9Ba1e578E5b077134',
  router: UMBRAE_ROUTER,
});

const MANAGER = new Interface([
  'function createPositionWithStrategy(address tokenX, address tokenY, uint16 binStep, uint16 baseFactor, uint256 amountX, uint256 amountY, uint8 strategy, uint24 binRange, uint8 bidAskRatio, uint24 centerBinId, bool skipActiveBin, uint24 activeIdDesired, uint24 idSlippage, uint256 minTotalLiquidity, address recipient, uint256 deadline)',
  'function increasePositionWithStrategy(uint256 tokenId, uint256 amountX, uint256 amountY, uint24 centerBinId, bool skipActiveBin, uint24 activeIdDesired, uint24 idSlippage, uint256 minTotalLiquidity, uint256 deadline)',
  'function claimFees(uint256 tokenId, address recipient, uint256 deadline)',
  'function claimFeesRange(uint256 tokenId, uint256 startIndex, uint256 binCount, address recipient, uint256 deadline)',
  'function closePosition(uint256 tokenId, uint256 amountXMin, uint256 amountYMin, address recipient, uint256 deadline)',
  'function decreasePosition(uint256 tokenId, uint24[] binIds, uint256[] lpAmounts, uint256 amountXMin, uint256 amountYMin, address recipient, uint256 deadline)',
  'function decreasePositionByPercent(uint256 tokenId, uint16 bps, uint256 amountXMin, uint256 amountYMin, address recipient, uint256 deadline)',
]);

const APPROVALS = new Interface([
  'function approve(address spender, uint256 amount)',
  'function setApprovalForAll(address spender, bool approved)',
]);

const DEPOSITS = Object.freeze(['createPositionWithStrategy', 'increasePositionWithStrategy']);

const refuse = (reason) => Object.freeze({ ok: false, reason });
const same = (a, b) => isAddress(a) && isAddress(b) && getAddress(a) === getAddress(b);

// pure — the decoded call, or null when the selector is not one this
// interface names or the arguments do not decode.
const decode = (iface, data) => {
  try {
    return iface.parseTransaction({ data });
  } catch {
    return null;
  }
};

// pure — a call to the position manager.
const classifyManagerCall = (data, wallet) => {
  const call = decode(MANAGER, data);
  if (!call) return refuse('That is not one of the position actions this wallet may sign.');
  const args = call.args.toObject();
  if ('recipient' in args && !same(args.recipient, wallet)) {
    return refuse('The transaction would pay a different wallet. Tokens may only return to the wallet that signs.');
  }
  const fields = {};
  for (const name of ['amountXMin', 'amountYMin', 'deadline', 'minTotalLiquidity', 'startIndex', 'binCount', 'bps']) {
    if (name in args) fields[name] = args[name].toString();
  }
  for (const name of ['binStep', 'baseFactor', 'strategy', 'binRange', 'bidAskRatio', 'centerBinId', 'activeIdDesired', 'idSlippage']) {
    if (name in args) fields[name] = Number(args[name]);
  }
  if ('skipActiveBin' in args) fields.skipActiveBin = args.skipActiveBin;
  if ('binIds' in args) fields.binIds = args.binIds.map(String);
  if ('lpAmounts' in args) fields.lpAmounts = args.lpAmounts.map(String);
  if (!DEPOSITS.includes(call.name)) {
    return Object.freeze({ ok: true, kind: 'exit', action: call.name, tokenId: args.tokenId.toString(), ...fields });
  }
  return Object.freeze({
    ok: true,
    kind: 'deposit',
    action: call.name,
    tokenId: 'tokenId' in args ? args.tokenId.toString() : null,
    tokenX: 'tokenX' in args ? getAddress(args.tokenX) : null,
    tokenY: 'tokenY' in args ? getAddress(args.tokenY) : null,
    amountX: args.amountX.toString(),
    amountY: args.amountY.toString(),
    ...fields,
  });
};

// pure — an approval sent to a token or a pool. The spender is always the
// pinned manager; a token allowance never exceeds the stated ceiling.
// The reason classifyApproval gives a call that is no approval at all — the
// caller then tries it as a token send.
const NOT_APPROVAL = 'The transaction is not aimed at Umbrae\'s position manager, its factory, its router or KyberSwap\'s, and is not an approval for one of them.';

const classifyApproval = (tx, { manager, router, aggregator, factory }, maxApprove) => {
  const call = decode(APPROVALS, tx.data);
  if (!call) return refuse(NOT_APPROVAL);
  const args = call.args.toObject();
  // A token allowance may name the manager (deposits), Umbrae's router or
  // KyberSwap's (swaps); a pool's LP approval names the manager alone.
  // (and Umbrae's factory: a new pool's seed, Design note, 2026-11-14
  const spenders = call.name === 'setApprovalForAll' ? [manager] : [manager, router, aggregator, factory].filter(Boolean);
  if (!spenders.some((spender) => same(args.spender, spender))) {
    return refuse('The approval names a spender other than Umbrae\'s position manager, its factory, its router or KyberSwap\'s.');
  }
  if (call.name === 'setApprovalForAll') {
    if (args.approved !== true) return refuse('Only granting the position manager is signed here.');
    return Object.freeze({ ok: true, kind: 'approval', action: 'pool-approval', target: getAddress(tx.to) });
  }
  const ceiling = maxApprove?.[getAddress(tx.to)];
  if (ceiling === undefined || args.amount > BigInt(ceiling)) {
    return refuse('The token approval is larger than this action calls for.');
  }
  return Object.freeze({
    ok: true, kind: 'approval', action: 'token-approval', target: getAddress(tx.to), amount: args.amount.toString(),
  });
};

/**
 * Classify an unsigned transaction for the LP wallet. Pure.
 *
 * @param {{to?: string, data?: string, chainId?: number, value?: string}} tx
 *   the transaction as Umbrae's build or approvals call returned it, or as
 *   umbrae-lp/lp-trade.js built a swap or a send
 * @param {{wallet: string, maxApprove?: Record<string, string>, tokens?: Set<string>,
 *   recipients?: Set<string>, pins?: {chainId: number, positionManager: string, router: string}}} ctx
 *   wallet — the LP wallet that would sign; maxApprove — per token address
 *   (checksummed), the largest raw allowance this action may grant; tokens —
 *   the tokens Umbrae's pools trade; recipients — the house and allowlisted
 *   addresses a send may reach (both checksummed; absent = no swap, no send)
 * @returns {Readonly<{ok: true, kind: 'deposit'|'exit'|'approval'|'swap'|'transfer', action: string}
 *   | {ok: false, reason: string}>}
 */
export const classifyLpTransaction = (tx, { wallet, maxApprove, tokens, recipients, pins = UMBRAE_BASE } = {}) => {
  if (!isAddress(wallet)) return refuse('No LP wallet was named.');
  if (!tx || !isAddress(tx.to) || typeof tx.data !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(tx.data)) {
    return refuse('The transaction is not well formed.');
  }
  if (Number(tx.chainId) !== pins.chainId) return refuse(`The transaction is for chain ${tx.chainId}, not Base.`);
  // A plain ETH send (no data) is a transfer, judged by its recipient alone.
  if (tx.data === '0x') return classifyTransfer(tx, { tokens, recipients });
  if (!/^0*$/.test(String(tx.value ?? '0').replace(/^0x/, ''))) {
    return refuse('The transaction sends ETH with a contract call. Only a plain send to the house does.');
  }
  if (same(tx.to, pins.positionManager)) return classifyManagerCall(tx.data, wallet);
  if (same(tx.to, pins.router)) return classifySwap(tx.data, { wallet, tokens });
  // KyberSwap's aggregator (Design note, 2026-11-13, held to the router's law: aggregator-policy.js.
  if (same(tx.to, KYBER_ROUTER)) return classifyAggregatorSwap(tx, { wallet, tokens });
  // A new pool on Umbrae's pinned factory (pool-policy.js).
  if (same(tx.to, UMBRAE_FACTORY)) return classifyCreatePair(tx);
  const approval = classifyApproval(tx, { manager: pins.positionManager, router: pins.router, aggregator: KYBER_ROUTER, factory: UMBRAE_FACTORY }, maxApprove);
  return approval.ok || approval.reason !== NOT_APPROVAL ? approval : classifyTransfer(tx, { tokens, recipients });
};

// pure — is raw amount a no larger than raw amount b? False when either is unreadable.
const atMost = (a, b) => {
  try {
    return BigInt(a) <= BigInt(b);
  } catch {
    return false;
  }
};

/**
 * Is a transaction this wallet may sign also the one that was asked for? A
 * claim must not come back as a deposit, a deposit must not be larger than the
 * one that was sized against the budget, an action must touch the position
 * that was named, a swap must trade the tokens named for no more than named,
 * and a send must reach the address named with no more than named. Pure.
 *
 * @param {{ok: boolean, kind?: string, tokenId?: string|null, tokenX?: string|null, tokenY?: string|null,
 *   amountX?: string, amountY?: string, action?: string, target?: string}} verdict
 *   from classifyLpTransaction
 * @param {{kind: 'deposit'|'exit'|'approval'|'swap'|'transfer', tokenId?: string|null, tokenX?: string, tokenY?: string,
 *   amountX?: string, amountY?: string, pool?: string, tokenIn?: string, tokenOut?: string, amountIn?: string,
 *   to?: string, token?: string|null, amount?: string}} asked
 * @returns {Readonly<{ok: true} | {ok: false, reason: string}>}
 */
export const checkLpIntent = (verdict, asked) => {
  if (!verdict?.ok) return refuse('The transaction was not classified.');
  if (!asked || verdict.kind !== asked.kind) return refuse('The transaction Umbrae built is not the kind of action that was asked for.');
  if (verdict.kind === 'swap') {
    if (!same(verdict.tokenIn, asked.tokenIn) || !same(verdict.tokenOut, asked.tokenOut)) return refuse('The swap trades other tokens than were asked.');
    if (!atMost(verdict.amountIn, asked.amountIn)) return refuse('The swap spends more than was asked.');
    // A floor the run set itself (from its own quote and slippage) binds: a built swap may not lower it.
    if (asked.amountOutMin !== undefined && !atMost(asked.amountOutMin, verdict.amountOutMin)) return refuse('The swap\'s minimum out is lower than the floor that was asked.');
    return Object.freeze({ ok: true });
  }
  if (verdict.kind === 'transfer') {
    if (!same(verdict.to, asked.to)) return refuse('The send goes to a different address than was asked.');
    if ((verdict.token === null) !== (asked.token === null || asked.token === undefined) || (verdict.token && !same(verdict.token, asked.token))) {
      return refuse('The send moves a different token than was asked.');
    }
    return atMost(verdict.amount, asked.amount) ? Object.freeze({ ok: true }) : refuse('The send moves more than was asked.');
  }
  if (verdict.kind === 'create-pool') {
    // The pool that was planned: its pair, fee tier, start bin (within 2 bins of the planned price) and no more seed.
    const fits = same(verdict.tokenX, asked.tokenX) && same(verdict.tokenY, asked.tokenY)
      && verdict.binStep === asked.binStep && verdict.baseFactor === asked.baseFactor;
    if (!fits) return refuse('The pool Umbrae built is not the pair or fee tier that was planned.');
    if (!Number.isInteger(asked.activeId) || Math.abs(verdict.activeId - asked.activeId) > 2) return refuse('The pool would open at another price than was planned.');
    return atMost(verdict.amountX, asked.amountX) && atMost(verdict.amountY, asked.amountY) ? Object.freeze({ ok: true }) : refuse('The pool\'s seed is larger than was planned.');
  }
  if (verdict.kind === 'approval') {
    return verdict.action === 'pool-approval' && !same(verdict.target, asked.pool)
      ? refuse('The pool approval is for a different pool.')
      : Object.freeze({ ok: true });
  }
  if (verdict.tokenId !== null && verdict.tokenId !== String(asked.tokenId ?? '')) {
    return refuse('The transaction is for a different position.');
  }
  if (verdict.kind === 'exit') {
    if (!Array.isArray(asked.actions) || !asked.actions.includes(verdict.action)) return refuse('The transaction is not the exit action that was asked for.');
    if (verdict.action === 'decreasePositionByPercent' && verdict.bps !== String(asked.bps)) return refuse('The withdrawal percentage is different than the one asked for.');
    if (['closePosition', 'decreasePosition', 'decreasePositionByPercent'].includes(verdict.action)) {
      if (asked.amountXMin === undefined || asked.amountYMin === undefined) return refuse('The withdrawal has no locally established minimum proceeds.');
      if (!atMost(asked.amountXMin, verdict.amountXMin) || !atMost(asked.amountYMin, verdict.amountYMin)) return refuse('The withdrawal lowers the minimum proceeds.');
    }
    if (verdict.action === 'claimFeesRange' && asked.startIndex !== undefined && verdict.startIndex !== String(asked.startIndex)) return refuse('The claim starts on a different page.');
    return Object.freeze({ ok: true });
  }
  if (verdict.tokenId === null && (!same(verdict.tokenX, asked.tokenX) || !same(verdict.tokenY, asked.tokenY))) {
    return refuse('The deposit is for different tokens than the pool that was named.');
  }
  if (verdict.action !== asked.action) return refuse('The deposit action is different than the one asked for.');
  const exactFields = verdict.action === 'createPositionWithStrategy'
    ? ['binStep', 'baseFactor', 'strategy', 'binRange', 'bidAskRatio', 'centerBinId', 'skipActiveBin', 'activeIdDesired', 'idSlippage']
    : ['centerBinId', 'skipActiveBin', 'activeIdDesired', 'idSlippage'];
  for (const field of exactFields) {
    if (asked[field] === undefined || verdict[field] !== asked[field]) return refuse(`The deposit's ${field} is different than the one planned.`);
  }
  if (asked.minTotalLiquidity === undefined || BigInt(asked.minTotalLiquidity) <= 0n || !atMost(asked.minTotalLiquidity, verdict.minTotalLiquidity)) {
    return refuse('The deposit lowers the locally established minimum liquidity.');
  }
  try {
    if (BigInt(verdict.amountX) > BigInt(asked.amountX) || BigInt(verdict.amountY) > BigInt(asked.amountY)) {
      return refuse('The deposit Umbrae built is larger than the one that was asked for.');
    }
  } catch {
    return refuse('The asked deposit has no readable amount.');
  }
  return Object.freeze({ ok: true });
};

// pure — a raw token amount as micro-dollars, or null when a figure is unusable.
const microUsd = (raw, decimals, priceUsd) => {
  try {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
    if (!Number.isFinite(Number(priceUsd)) || Number(priceUsd) < 0) return null;
    const price = parseUnits(Number(priceUsd).toFixed(12), 12);
    return (BigInt(raw) * price) / (10n ** BigInt(decimals)) / 10n ** 6n;
  } catch {
    return null;
  }
};

/**
 * The dollar size of a deposit, in micro-dollars, from raw token amounts and
 * the pool's own prices. Null when any figure is missing or unusable — and a
 * deposit that cannot be sized is never free. Pure.
 *
 * @param {{amountX: string, amountY: string, decimalsX: number, decimalsY: number,
 *   priceXUsd: number|string, priceYUsd: number|string}} deposit
 * @returns {bigint|null}
 */
export const depositMicroUsd = ({ amountX, amountY, decimalsX, decimalsY, priceXUsd, priceYUsd } = {}) => {
  const x = microUsd(amountX, decimalsX, priceXUsd);
  const y = microUsd(amountY, decimalsY, priceYUsd);
  return x === null || y === null ? null : x + y;
};

// pure — a decimal token amount ("1.25") as micro-dollars, or null when unusable.
const decimalMicroUsd = (amount, priceUsd) => {
  try {
    if (typeof amount !== 'string' || !/^\d+(\.\d+)?$/.test(amount)) return null;
    if (!Number.isFinite(Number(priceUsd)) || Number(priceUsd) < 0) return null;
    const [whole, fraction = ''] = amount.split('.');
    const units = parseUnits(`${whole}.${fraction.slice(0, 18) || '0'}`, 18);
    return (units * parseUnits(Number(priceUsd).toFixed(12), 12)) / 10n ** 24n;
  } catch {
    return null;
  }
};

/**
 * What the wallet already has in positions, in micro-dollars, from Umbrae's
 * own positions answer (token amounts and the pool's prices). Null when the
 * answer is not a list or any one figure is unusable — and an unreadable
 * total never lets a deposit run free. Pure.
 *
 * @param {Array<{positions?: {userPositions?: Array<{positionData?: {totalXAmount?: string, totalYAmount?: string}}>},
 *   poolInfo?: {tokenXPriceUsd?: number, tokenYPriceUsd?: number}}>} pools
 * @returns {bigint|null}
 */
export const positionsMicroUsd = (pools) => {
  if (!Array.isArray(pools)) return null;
  let total = 0n;
  for (const pool of pools) {
    const held = pool?.positions?.userPositions;
    if (!Array.isArray(held)) return null;
    for (const position of held) {
      const data = position?.positionData;
      // An answer not in Umbrae's shape (amounts as strings) cannot be sized: the deposit then waits.
      if (typeof data?.totalXAmount !== 'string' || typeof data?.totalYAmount !== 'string') return null;
      // Umbrae gives totals in raw units with each token's decimals (lp-book-math.js positionStrings).
      const whole = positionStrings(pool, data);
      const x = decimalMicroUsd(whole.x, pool.poolInfo?.tokenXPriceUsd);
      const y = decimalMicroUsd(whole.y, pool.poolInfo?.tokenYPriceUsd);
      if (x === null || y === null) return null;
      total += x + y;
    }
  }
  return total;
};

/**
 * Does a deposit run on its own, or wait for the operator? The budget is an
 * optional cap (Design note, 2026-11-13, […]): with none set, every
 * deposit runs. With one set, a deposit that would take the total past it, or
 * that cannot be sized, waits. Pure.
 *
 * @param {{budgetUsd: number|string|null|undefined, deployedMicroUsd: bigint|null,
 *   depositMicroUsd: bigint|null}} figures
 *   deployedMicroUsd — what the wallet already has in positions
 * @returns {'free'|'pending'}
 */
export const classifyDeposit = ({ budgetUsd, deployedMicroUsd, depositMicroUsd: deposit } = {}) => {
  if (budgetUsd === null || budgetUsd === undefined) return 'free';
  if (typeof deployedMicroUsd !== 'bigint' || typeof deposit !== 'bigint') return 'pending';
  if (deployedMicroUsd < 0n || deposit <= 0n) return 'pending';
  let budget;
  try {
    budget = parseUnits(String(budgetUsd), 6);
  } catch {
    return 'pending';
  }
  return budget > 0n && deployedMicroUsd + deposit <= budget ? 'free' : 'pending';
};
