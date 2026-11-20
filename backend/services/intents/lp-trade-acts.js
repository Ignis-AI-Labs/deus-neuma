/**
 * lp/swap and lp/send — a house member's trades and transfers from its LP
 * wallet (Design note, 2026-11-13: […], […], money
 * stays in the house). Both require operator approval; the signing rule and
 * capital controls remain execution gates:
 *
 *   lp/swap — one pool token for another, through Umbrae's router only, the
 *             output paid back to the same wallet, under a minimum out.
 *   lp/send — ETH or a pool token to a wallet of the house (any member's
 *             main or liquidity wallet, the operator) or the operator's list.
 *
 * Offered exactly where the other lp/* acts are (lp-acts.js lpOffered).
 */
import { seatOf } from '../flight-check.js';
import { lpWalletAddress } from '../umbrae-lp/lp-wallet.js';
import { runSwap, runSend, MAX_SLIPPAGE_PCT } from '../umbrae-lp/lp-trade.js';
import { lpOffered, walletWords, failedOutcome } from './lp-acts.js';

// impure — the shared seat and wallet checks every lp act makes before running.
const standing = async (connection) => {
  if (seatOf(connection) === 'witness') return { ok: false, status: 'denied', reason: 'Witness seats hold no LP wallet on this platform.' };
  if (!(await lpWalletAddress(connection.companion?.neumaId).catch(() => null))) {
    return { ok: false, status: 'denied', reason: 'You have no LP wallet yet. Your operator opens one for you.' };
  }
  return null;
};
const text = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
// The member's reason, kept beside what the act made or lost (lp-book.js).
const why = (payload) => (typeof payload?.why === 'string' && payload.why.trim() ? { why: payload.why.trim().slice(0, 400) } : {});

export const lpSwapIntent = Object.freeze({
  name: 'lp/swap',
  policyTool: 'lp.swap',
  fieldsForPrompt: '{tokenIn, tokenOut, amount, slippagePct?, why?}',
  descriptionForPrompt: `Swap one token for another from your LP wallet (tokens Umbrae's pools trade, by symbol or address). amount is a plain decimal of tokenIn; slippagePct defaults to 1, at most ${MAX_SLIPPAGE_PCT}. Two roads are quoted: Umbrae's router, and KyberSwap's aggregator across Base's exchanges when your operator turned that connection on; the one that pays more is taken (lp_market shows both first), and the result says which. What you buy returns to the same wallet. Requires operator approval. Use it to rebalance a position's two sides. tokenIn = tokenOut is a round trip through two pools of one pair (an arbitrage on their spread): it runs only when the router's quote returns more than it spends, and Base reverts it rather than lose (lp_market shows the spreads and quotes it first).`,
  availableFor: lpOffered,
  validate: async (payload, { connection }) => {
    const denied = await standing(connection);
    if (denied) return denied;
    const value = { tokenIn: text(payload?.tokenIn), tokenOut: text(payload?.tokenOut), amount: text(payload?.amount), ...why(payload) };
    if (!value.tokenIn || !value.tokenOut || !value.amount) return { ok: false, status: 'invalid', reason: 'lp/swap needs {tokenIn, tokenOut, amount}' };
    if (payload?.slippagePct !== undefined) value.slippagePct = Number(payload.slippagePct);
    return { ok: true, value };
  },
  summarize: (p) => `swap ${p?.amount ?? '?'} ${p?.tokenIn ?? '?'} for ${p?.tokenOut ?? '?'}`,
  // impure — the whole swap: route, quote, approve, swap, confirm.
  execute: async (value, { connection }) => {
    const out = await runSwap(connection.companion?.neumaId, value);
    return out.ok
      ? { ok: true, detail: `Swapped ${out.amountIn} ${out.route[0]} for ${out.amountOut} ${out.route[out.route.length - 1]} ${out.via === 'kyberswap' ? `through KyberSwap${out.exchanges?.length ? ` (${out.exchanges.join(', ')})` : ''}; Umbrae's router quoted ${out.compared?.umbrae ?? 'no route'}` : `via ${out.route.join(' → ')} on Umbrae's router${out.compared?.kyberswap ? `; KyberSwap quoted ${out.compared.kyberswap}` : ''}`}. Tokens: ${out.tokens.in} for ${out.tokens.out}. Transactions: ${out.txHashes.join(', ')}.${walletWords(out)}` }
      : failedOutcome(out, `lp/swap did not complete: ${out.reason}${out.txHashes?.length ? ` Already on Base: ${out.txHashes.join(', ')}.` : ''}`);
  },
});

export const lpSendIntent = Object.freeze({
  name: 'lp/send',
  policyTool: 'lp.send',
  fieldsForPrompt: '{to, amount, token?, why?}',
  descriptionForPrompt: 'Send ETH (default) or a pool token from your LP wallet to a wallet of your house: a house member by name (their liquidity wallet; add "main" for their first one), "operator", or an address on your operator\'s list. Nothing outside the house can be reached. Requires operator approval. Use it to move resources between house members.',
  availableFor: lpOffered,
  validate: async (payload, { connection }) => {
    const denied = await standing(connection);
    if (denied) return denied;
    const value = { to: text(payload?.to), amount: text(payload?.amount), token: text(payload?.token) || 'ETH', ...why(payload) };
    if (!value.to || !value.amount) return { ok: false, status: 'invalid', reason: 'lp/send needs {to, amount}' };
    return { ok: true, value };
  },
  summarize: (p) => `send ${p?.amount ?? '?'} ${p?.token || 'ETH'} to ${p?.to ?? '?'}`,
  // impure — resolve the house address, sign through the rule, confirm.
  execute: async (value, { connection }) => {
    const out = await runSend(connection.companion?.neumaId, value);
    return out.ok
      ? { ok: true, detail: `Sent ${value.amount} ${value.token}${out.token === 'ETH' ? '' : ` (${out.token})`} to ${out.name} (${out.to}). Transaction: ${out.txHashes[0]}.` }
      : failedOutcome(out, `lp/send did not complete: ${out.reason}`);
  },
});
