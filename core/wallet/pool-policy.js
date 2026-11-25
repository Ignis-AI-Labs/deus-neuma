// pool-policy.js — what the LP wallet signs to open a NEW pool on Umbrae
// (Design note, 2026-11-13/14: […], […]). Pure.
//
// One call, on one contract: createPair on Umbrae's pool factory, pinned here
// and never taken from an answer (docs/dev/contracts.json; its published ABI
// hash 82183b0d… matched 2026-11-14; on Base any wallet may create a pool,
// canCreatePool true for unlisted pairs). No ETH with it. The run binds the
// pair, fee tier, seed and start bin to what it planned (checkLpIntent), so a
// build Umbrae answered cannot open another pool, at another price, or take
// more seed than planned. The seed is at most $20 (Umbrae's cap) and stays in
// the pool for good: it starts the pool; the member's liquidity goes in as a
// position after.

import { Interface, getAddress, isAddress } from 'ethers';

/** Umbrae's DLMM V2 pool factory on Base (Router.FACTORY() read 2026-11-13; owner = Umbrae's timelock). */
export const UMBRAE_FACTORY = '0x9DBB9289d0D75508b5D8EE01FfE4eb7c412F733b';
/** The bin whose price is 1 (whole tokens of Y per whole token of X). */
const CENTER_BIN = 8_388_608;

const FACTORY = new Interface([
  'function createPair(address tokenX, address tokenY, uint24 activeId, uint16 binStep, uint16 baseFactor, uint256 amountX, uint256 amountY) returns (address pair)',
]);

const refuse = (reason) => Object.freeze({ ok: false, reason });

/**
 * The bin a pool opens at, for a price in WHOLE tokens of Y per whole token of
 * X. Umbrae's own rule (build-transaction route, binIdFromNormalizedPrice);
 * checked 2026-11-14 on three live pools: WETH-USDC (18/6 decimals), VIRTUAL-WETH,
 * U1-USDC each sit exactly at it. Pure.
 * @param {number} priceYPerX
 * @param {number} binStep - in basis points
 * @returns {number|null}
 */
export const binIdFor = (priceYPerX, binStep) => {
  const p = Number(priceYPerX);
  if (!Number.isFinite(p) || p <= 0 || !Number.isInteger(binStep) || binStep <= 0) return null;
  return CENTER_BIN + Math.round(Math.log(p) / Math.log(1 + binStep / 10_000));
};

/**
 * The pair as the factory takes it: tokenX sorted below tokenY by address. Pure.
 * @returns {{tokenX: string, tokenY: string, baseIsX: boolean}}
 */
export const orientPair = (baseToken, quoteToken) => {
  const base = getAddress(baseToken);
  const quote = getAddress(quoteToken);
  const baseIsX = BigInt(base) < BigInt(quote);
  return { tokenX: baseIsX ? base : quote, tokenY: baseIsX ? quote : base, baseIsX };
};

/**
 * A call to Umbrae's pool factory. Pure.
 * @param {{data: string, value?: string}} tx
 * @returns {Readonly<{ok: true, kind: 'create-pool', action: 'createPair', tokenX: string, tokenY: string, activeId: number,
 *   binStep: number, baseFactor: number, amountX: string, amountY: string} | {ok: false, reason: string}>}
 */
export const classifyCreatePair = (tx) => {
  let value;
  try {
    value = BigInt(tx?.value ?? 0);
  } catch {
    return refuse('The transaction\'s value is not a number.');
  }
  if (value !== 0n) return refuse('Opening a pool sends no ETH with it.');
  let call;
  try {
    call = FACTORY.parseTransaction({ data: tx?.data });
  } catch {
    call = null;
  }
  if (!call) return refuse('The only factory call this wallet signs is createPair.');
  const { tokenX, tokenY, activeId, binStep, baseFactor, amountX, amountY } = call.args.toObject();
  if (!isAddress(tokenX) || !isAddress(tokenY) || BigInt(tokenX) >= BigInt(tokenY)) return refuse('The pool\'s two tokens are not in the factory\'s order.');
  if (amountX === 0n && amountY === 0n) return refuse('A new pool needs a seed of at least one of its tokens.');
  return Object.freeze({
    ok: true, kind: 'create-pool', action: 'createPair',
    tokenX: getAddress(tokenX), tokenY: getAddress(tokenY), activeId: Number(activeId),
    binStep: Number(binStep), baseFactor: Number(baseFactor), amountX: amountX.toString(), amountY: amountY.toString(),
  });
};
