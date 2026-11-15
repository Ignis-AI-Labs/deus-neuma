/**
 * lp/* — a house member's liquidity actions on Umbrae, from its own LP wallet
 * (Design note, 2026-11-12, kept beside its first wallet; 2026-11-13 […]).
 * Swaps and sends are lp/swap and lp/send (lp-trade-acts.js).
 *
 *   lp/open      — a new position in a pool          (a deposit)
 *   lp/add       — more into a position it holds     (a deposit)
 *   lp/claim     — the fees a position has earned    (money out)
 *   lp/withdraw  — a share of a position, 1–100 %    (money out)
 *   lp/close     — the whole position                (money out)
 *
 * The policy rows are `allowed` by default. Deposits run on their own unless
 * the operator set a budget cap, read fresh at each deposit (umbrae-lp/lp-run.js);
 * a deposit past a cap waits for the operator's yes, and a waiting deposit is a
 * request that succeeded, not a failure. Money out never waits. The wallet
 * signs only Umbrae's position calls, every exit paying the wallet itself
 * (core/wallet/lp-tx-policy.js).
 *
 * Offered only to a house member's own seat, with an LP wallet, while the
 * Umbrae liquidity connection is on. A witness seat is refused at validate.
 */
import { seatOf } from '../flight-check.js';
import { isConnectionOn } from '../connections/connection-switches.js';
import { UMBRAE_LP_CONNECTION } from '../umbrae-lp/umbrae-lp-client.js';
import { lpWalletAddress } from '../umbrae-lp/lp-wallet.js';
import { runLpAction } from '../umbrae-lp/lp-run.js';

const FIELDS = Object.freeze({
  open: '{pool, amountX?, amountY?, strategy?, binRange?, why?}',
  add: '{pool, tokenId, amountX?, amountY?, strategy?, binRange?, why?}',
  claim: '{pool, tokenId, why?}',
  withdraw: '{pool, tokenId, percent, why?}',
  close: '{pool, tokenId, why?}',
});

const DESCRIPTIONS = Object.freeze({
  open: 'Open a liquidity position on Umbrae from your LP wallet. pool is the pool address; amountX/amountY are plain decimals of the pool\'s two tokens (one side may be 0); strategy 0 spot, 1 curve, 2 bid-ask; binRange 1–35 bins each side (default 10). It runs on its own; only if your operator set a budget cap and this passes it does it wait for their yes.',
  add: 'Add to a position you hold (tokenId) in that pool, from your LP wallet. Same amounts and cap as lp/open.',
  claim: 'Claim the fees your position (tokenId) has earned into your LP wallet. Never waits.',
  withdraw: 'Withdraw percent (1–100) of your position (tokenId) back into your LP wallet. Never waits.',
  close: 'Close your position (tokenId): everything returns to your LP wallet. Never waits.',
});

// impure — the advertising probe: a house member's own seat, with an LP
// wallet, while the connection is on. Shared with lp-trade-acts.js.
export const lpOffered = async ({ laneId, connection }) => {
  if (!laneId || seatOf(connection) === 'witness' || !isConnectionOn(UMBRAE_LP_CONNECTION)) return null;
  return (await lpWalletAddress(laneId).catch(() => null)) ? {} : null;
};

// pure — the fields the run reads, from the filed payload. Shape is judged by
// the run itself, before anything is called or signed.
const actionOf = (type, payload) => ({
  type,
  pool: typeof payload?.pool === 'string' ? payload.pool.trim() : '',
  ...(payload?.tokenId !== undefined ? { tokenId: String(payload.tokenId) } : {}),
  ...(payload?.amountX !== undefined ? { amountX: String(payload.amountX) } : {}),
  ...(payload?.amountY !== undefined ? { amountY: String(payload.amountY) } : {}),
  ...(payload?.strategy !== undefined ? { strategy: Number(payload.strategy) } : {}),
  ...(payload?.binRange !== undefined ? { binRange: Number(payload.binRange) } : {}),
  ...(payload?.percent !== undefined ? { percent: Number(payload.percent) } : {}),
});

// pure — what the act did to the wallet's own balance, as the book read it (lp-book.js).
export const walletWords = (out) => (Number.isFinite(out?.walletChangeUsd)
  ? ` Your wallet's own balance moved ${out.walletChangeUsd < 0 ? '−' : '+'}$${Math.abs(out.walletChangeUsd).toFixed(2)} (positions count apart; lp_book has the whole book).`
  : '');

// pure — the one line the record and the desk read for an outcome.
const outcomeOf = (type, out) => {
  if (out.ok && out.declined) return { ok: true, detail: 'Your operator declined that deposit.' };
  if (out.ok) {
    const position = out.tokenId ? ` Position #${out.tokenId}.` : '';
    return { ok: true, detail: `Done: lp/${type} on Base in ${out.txHashes.length} transaction(s), ${out.txHashes.join(', ')}.${position}${walletWords(out)}` };
  }
  if (out.pending) return { ok: true, detail: `${out.reason} Request ${out.requestId}.` };
  const sent = out.txHashes?.length ? ` Transactions already on Base: ${out.txHashes.join(', ')}.` : '';
  return { ok: false, reason: `lp/${type} did not complete: ${out.reason}${sent}` };
};

const lpIntent = (type) => Object.freeze({
  name: `lp/${type}`,
  policyTool: `lp.${type}`,
  fieldsForPrompt: FIELDS[type],
  descriptionForPrompt: DESCRIPTIONS[type],
  availableFor: lpOffered,
  validate: async (payload, { connection }) => {
    if (seatOf(connection) === 'witness') {
      return { ok: false, status: 'denied', reason: 'Witness seats hold no LP wallet on this platform.' };
    }
    if (!(await lpWalletAddress(connection.companion?.neumaId).catch(() => null))) {
      return { ok: false, status: 'denied', reason: 'You have no LP wallet yet. Your operator opens one for you.' };
    }
    const action = actionOf(type, payload);
    if (!action.pool) return { ok: false, status: 'invalid', reason: `lp/${type} needs ${FIELDS[type]}` };
    return { ok: true, value: { ...action, why: typeof payload?.why === 'string' ? payload.why.slice(0, 400) : '' } };
  },
  summarize: (payload) => {
    const amounts = payload?.amountX || payload?.amountY ? ` ${payload.amountX ?? 0} + ${payload.amountY ?? 0}` : '';
    const share = payload?.percent ? ` ${payload.percent}%` : '';
    const position = payload?.tokenId ? ` #${payload.tokenId}` : '';
    return `lp ${type}${position}${share}${amounts} in ${payload?.pool ?? '?'}`;
  },
  // impure — the whole run: sign-in, budget, approvals, build, sign, send, record.
  // why rides along: the earnings book writes it beside what the act made or lost (lp-book.js).
  execute: async (action, { connection }) => outcomeOf(type, await runLpAction(connection.companion?.neumaId, action)),
});

export const lpIntents = Object.freeze(['open', 'add', 'claim', 'withdraw', 'close'].map(lpIntent));
