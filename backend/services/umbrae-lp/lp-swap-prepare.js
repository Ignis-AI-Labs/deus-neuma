import { ethers } from 'ethers';
import { lpBase } from './lp-base.js';
import { quoteSwap } from './lp-trade.js';
import { independentSwapFloor } from './lp-swap-floor.js';
import { resolveListedTokens } from './lp-pool-tokens.js';
import { preflightCreatePool } from './lp-pool.js';
import { houseRecipients, resolveRecipient } from './lp-house.js';

const DECIMALS = new ethers.Interface(['function decimals() view returns (uint8)']);
const decimalsOf = async (provider, token) => Number(DECIMALS.decodeFunctionResult('decimals', await provider.call({ to: token, data: DECIMALS.encodeFunctionData('decimals', []) }))[0]);

/** Resolve and price an LP swap after policy, before its card. impure — pool, market and chain reads. */
export const prepareSwapApproval = async (ask, { provider } = {}) => {
  const quoted = await quoteSwap(ask, { provider });
  if (!quoted.ok) return quoted;
  const base = provider ?? await lpBase();
  if (!base) return { ok: false, reason: 'Base did not answer, so the swap cannot be priced.' };
  try {
    const [decimalsIn, decimalsOut] = await Promise.all([decimalsOf(base, quoted.tokens.in), decimalsOf(base, quoted.tokens.out)]);
    const amountIn = ethers.parseUnits(String(ask.amount), decimalsIn);
    const independent = await independentSwapFloor({ amountIn, decimalsIn, decimalsOut, tokenIn: quoted.tokens.in, tokenOut: quoted.tokens.out, slippagePct: ask.slippagePct ?? 1 });
    if (!independent.ok) return independent;
    const candidates = [quoted.amountOut, quoted.kyberswap?.amountOut].filter(Boolean).map((amount) => ethers.parseUnits(amount, decimalsOut));
    const expectedOut = candidates.reduce((best, amount) => amount > best ? amount : best, 0n);
    if (expectedOut < independent.floor) return { ok: false, reason: 'The best route quotes below the minimum set by independent market prices.' };
    const slipBps = BigInt(Math.round(Number(ask.slippagePct ?? 1) * 100));
    const routeFloor = expectedOut * (10_000n - slipBps) / 10_000n;
    const floor = independent.floor > routeFloor ? independent.floor : routeFloor;
    return { ok: true, value: { ...ask, approvalFloor: floor.toString(), approvalPreview: {
      tokenIn: `${quoted.symbolIn} (${quoted.tokens.in})`, tokenOut: `${quoted.symbolOut} (${quoted.tokens.out})`,
      expectedOut: `${ethers.formatUnits(expectedOut, decimalsOut)} ${quoted.symbolOut}`,
      minimumOut: `${ethers.formatUnits(floor, decimalsOut)} ${quoted.symbolOut}`,
    } } };
  } catch (err) {
    return { ok: false, reason: `The swap could not be priced for approval: ${err.shortMessage || err.message}` };
  }
};

/** Resolve a send's token and payee after policy, before its card. impure — pool and house reads. */
export const prepareSendApproval = async (ask, { connection } = {}) => {
  let value;
  if (String(ask.token ?? 'ETH').toUpperCase() === 'ETH') {
    value = { ...ask, approvalPreview: { token: 'ETH (Base native asset)' } };
  } else {
    const resolved = await resolveListedTokens([ask.token]);
    if (!resolved.ok) return resolved;
    value = { ...ask, tokenAddress: resolved.addresses[0], approvalPreview: { token: `${resolved.book.get(resolved.addresses[0])} (${resolved.addresses[0]})` } };
  }
  const laneId = connection?.companion?.neumaId;
  if (!laneId) return { ok: true, value };
  const recipient = resolveRecipient(await houseRecipients(laneId), ask.to);
  if (!recipient) return { ok: false, reason: `${ask.to} does not name exactly one house recipient.` };
  return { ok: true, value: { ...value, approvalPreview: {
    ...value.approvalPreview,
    recipient: `${recipient.name} · ${recipient.lane ?? recipient.wallet} (${recipient.address})`,
  } } };
};

/** Resolve pool tokens and run its local/read-only preflight after policy. impure. */
export const prepareCreatePoolApproval = async (ask) => {
  const judged = await preflightCreatePool(ask);
  if (!judged.ok) return { ...judged, status: 'invalid' };
  const symbols = [ask.baseToken, ask.quoteToken].filter((token) => !ethers.isAddress(token));
  const resolved = symbols.length ? await resolveListedTokens(symbols) : { ok: true, addresses: [] };
  if (!resolved.ok) return resolved;
  const addresses = [...resolved.addresses];
  const baseToken = ethers.isAddress(ask.baseToken) ? ethers.getAddress(ask.baseToken) : addresses.shift();
  const quoteToken = ethers.isAddress(ask.quoteToken) ? ethers.getAddress(ask.quoteToken) : addresses.shift();
  return { ok: true, value: { ...ask, approvalPreview: { baseToken, quoteToken, binStep: ask.binStep ?? 'factory plan', baseFee: ask.baseFee ?? 'factory plan' } } };
};
