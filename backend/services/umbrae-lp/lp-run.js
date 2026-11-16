// lp-run.js — one liquidity action for a house member, start to finish.
//
//   key → pool → (a deposit: budget) → approvals → build → sign → send → wait → record
//
// Umbrae builds every transaction and broadcasts the signed bytes; the LP
// wallet signs here, on this computer, through lp-signer.js alone. Each
// signature is given only for the action that was asked: its kind, its
// position and, for a deposit, an amount no larger than the one this file
// sized against the operator's budget.
//
// The budget is an optional cap (Design note, 2026-11-13, […]): with none
// set, deposits run. With one set, a deposit past it is not run: it goes on
// the operator's waiting list (lp-budget.js) and runs only when the operator's
// yes hands it back. Getting money out (claim, withdraw, close) never waits.
// Swaps and sends live in lp-trade.js.

import { ethers } from 'ethers';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { classifyDeposit } from '../../../core/wallet/lp-tx-policy.js';
import { lpBase } from './lp-base.js';
import { callUmbrae } from './umbrae-lp-client.js';
import { umbraeKeyFor } from './lp-enroll.js';
import { signLpTransaction } from './lp-signer.js';
import { lpSigner } from './lp-wallet.js';
import { readLpBudget, addPendingDeposit, takePendingDeposit } from './lp-budget.js';
import { tellDepositWaiting } from './lp-report.js';
import { bookAct } from './lp-book.js';
import { signalWake } from '../house-clock/wake-signal.js';
import { poolBaseFactorOnChain, quoteDepositOnChain, quoteExitOnChain, tokenDecimalsOnChain } from './lp-quotes.js';
import { independentBudgetFigures } from './lp-budget-independent.js';
import { guardLpExecution, recordLpBroadcast, settleLpExecution } from './lp-executions.js';
import { proveLpReceipt } from './lp-receipt-proof.js';
import { assertLpNotPaused, reserveCapitalAssets } from './lp-capital-controls.js';
import { broadcastLpTransaction, prepareLpBroadcast } from './lp-broadcast.js';
import { readAgentVault } from '../agent-vault/vault-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('LpRun');

/** What a house member may ask, and Umbrae's name for each. */
export const LP_ACTIONS = Object.freeze({ open: 'create', add: 'add_liquidity', claim: 'claim_fees', withdraw: 'decrease_by_percent', close: 'close' });
const DEPOSITS = Object.freeze(['open', 'add']);
const EXIT_ACTIONS = Object.freeze({ claim: ['claimFees', 'claimFeesRange'], withdraw: ['decreasePositionByPercent'], close: ['closePosition'] });
/** Wide positions close and claim in several transactions; past this many, stop and say so. */
const MAX_ROUNDS = 12;
const AMOUNT = /^\d{1,30}(\.\d{1,18})?$/;
const TOKEN_ID = /^\d{1,78}$/;

const refuse = (reason, extra = {}) => Object.freeze({ ok: false, reason, ...extra });
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// pure — the asked action checked and normalised, or the reason it is not one.
const readAction = (action) => {
  const type = action?.type;
  if (!Object.hasOwn(LP_ACTIONS, type)) return refuse(`An LP action is one of: ${Object.keys(LP_ACTIONS).join(', ')}.`);
  if (!ethers.isAddress(action.pool)) return refuse('Name the pool by its address.');
  const base = { type, pool: ethers.getAddress(action.pool) };
  if (type !== 'open' && !TOKEN_ID.test(String(action.tokenId ?? ''))) return refuse('Name the position by its token ID.');
  const tokenId = type === 'open' ? null : String(action.tokenId);
  if (type === 'withdraw') {
    return Number.isInteger(action.percent) && action.percent >= 1 && action.percent <= 100
      ? Object.freeze({ ok: true, ...base, tokenId, percent: action.percent })
      : refuse('Say what percent to withdraw, from 1 to 100.');
  }
  if (!DEPOSITS.includes(type)) return Object.freeze({ ok: true, ...base, tokenId });
  const amountX = String(action.amountX ?? '0');
  const amountY = String(action.amountY ?? '0');
  if (!AMOUNT.test(amountX) || !AMOUNT.test(amountY) || (Number(amountX) === 0 && Number(amountY) === 0)) {
    return refuse('A deposit needs an amount of at least one of the pool\'s two tokens, as a plain decimal.');
  }
  const strategy = action.strategy ?? 0;
  const binRange = action.binRange ?? 10;
  if (![0, 1, 2].includes(strategy) || !Number.isInteger(binRange) || binRange < 1 || binRange > 35) {
    return refuse('The shape is 0, 1 or 2, and the range is 1 to 35 bins each side.');
  }
  return Object.freeze({ ok: true, ...base, tokenId, amountX, amountY, strategy, binRange });
};

// pure — the fields every Umbrae call for this pool repeats, or null when the
// pool's answer lacks one of them.
const poolFields = (pool, wallet) => {
  const usable = ethers.isAddress(pool?.tokenX?.address) && ethers.isAddress(pool?.tokenY?.address)
    && Number.isInteger(pool.tokenX.decimals) && Number.isInteger(pool.tokenY.decimals) && Number.isInteger(pool.binStep);
  if (!usable) return null;
  return Object.freeze({
    walletAddress: wallet.toLowerCase(), pairAddress: pool.address,
    tokenX: pool.tokenX.address, tokenY: pool.tokenY.address,
    tokenXSymbol: pool.tokenX.symbol, tokenYSymbol: pool.tokenY.symbol,
    tokenXDecimals: pool.tokenX.decimals, tokenYDecimals: pool.tokenY.decimals,
    binStep: pool.binStep, currentPrice: pool.currentPrice,
    baseFactor: Number.isFinite(Number(pool.baseFeePercentage))
      ? Math.round(Number(pool.baseFeePercentage) * 10000)
      : Number(pool.baseFactor ?? 5000),
    tokenXPriceUsd: pool.tokenXPriceUsd, tokenYPriceUsd: pool.tokenYPriceUsd,
  });
};

// impure — a keyed Umbrae call that signs in again, once, when the key lapsed. (Shared with lp-pool.js.)
export const keyedCaller = (neumaId, firstKey) => {
  let key = firstKey;
  return async (op, body) => {
    const out = await callUmbrae(op, { token: key, body });
    if (out.ok || out.status !== 401) return out;
    const renewed = await umbraeKeyFor(neumaId, { renew: true });
    if (!renewed.ok) return { ok: false, error: renewed.reason };
    key = renewed.key;
    return callUmbrae(op, { token: key, body });
  };
};

// impure — sign one Umbrae-built transaction, hand the bytes to Umbrae, and
// wait until both Umbrae and our own Base node have it confirmed. (Shared with lp-pool.js.)
export const signSendWait = async ({ signer, provider, keyed, pollMs, neumaId, receiptProvider, receiptConfirmations, vault }, tx, asked, maxApprove) => {
  const evidence = { secondary: receiptProvider, minConfirmations: receiptConfirmations, timeoutMs: 120000 };
  const ready = await prepareLpBroadcast({ neumaId });
  if (!ready.ok) return refuse(ready.reason);
  const guard = await guardLpExecution({ neumaId, tx, asked, provider, ...evidence });
  if (!guard.ok) return guard;
  const signed = await signLpTransaction({ signer, provider, tx, asked, maxApprove, vault });
  if (!signed.ok) return signed;
  const recorded = await recordLpBroadcast({ neumaId, actionHash: guard.actionHash, signed });
  if (!recorded.ok) return recorded;
  const mark = (state) => settleLpExecution({ neumaId, actionHash: guard.actionHash, state }).catch((error) => {
    log.error('LP execution settlement was not written', { neumaId, state, error: error.message });
  });
  const sent = await broadcastLpTransaction({
    neumaId, signed, provider,
    keyedSend: () => keyed('send', { signedTransaction: signed.signedTransaction, walletAddress: signer.address }),
  });
  if (!sent.ok) {
    const uncertain = sent.sent !== false;
    await mark(uncertain ? 'unknown' : 'aborted');
    return refuse(sent.reason, { txHash: signed.hash, ...(uncertain ? { uncertain: true } : {}) });
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await keyed('status', { txHash: signed.hash });
    if (!status.ok) {
      await mark('unknown');
      return refuse(status.error, { txHash: signed.hash, uncertain: true });
    }
    if (status.payload?.confirmationStatus === 'failed') {
      const receipt = await provider.send('eth_getTransactionReceipt', [signed.hash]).catch(() => null);
      if (receipt && Number(receipt.status) === 0) {
        await mark('reverted');
        return refuse('Base ran the transaction and it failed. Nothing moved.', { txHash: signed.hash });
      }
      await mark('unknown');
      return refuse('The transaction failure is not yet confirmed by our Base node.', { txHash: signed.hash, uncertain: true });
    }
    if (status.payload?.confirmationStatus === 'confirmed') {
      const receipt = await provider.waitForTransaction(signed.hash, 1, 60000).catch(() => null);
      if (!receipt) {
        await mark('unknown');
        return refuse('Umbrae confirmed the transaction but our Base node has not shown it yet.', { txHash: signed.hash, uncertain: true });
      }
      if (Number(receipt.status) !== 1) {
        await mark('reverted');
        return refuse('Base included the transaction but it reverted. No intended action completed.', { txHash: signed.hash });
      }
      const proof = await proveLpReceipt({ primary: provider, hash: signed.hash, ...evidence });
      if (!proof.ok) {
        await mark('unknown');
        return refuse('The transaction has not been independently confirmed yet. Reconcile its hash before trying again.', { txHash: signed.hash, uncertain: true });
      }
      await mark('confirmed');
      return Object.freeze({ ok: true, txHash: signed.hash });
    }
    await wait(pollMs);
  }
  await mark('unknown');
  return refuse('The transaction was sent and is still not confirmed.', { txHash: signed.hash, uncertain: true });
};

// impure — a configured cap uses independent market prices and chain-held positions.
const budgetGate = async (neumaId, keyed, action, fields, raw, provider) => {
  const budgetUsd = await readLpBudget(neumaId);
  if (budgetUsd === null) return null;
  const held = await keyed('positions', {});
  const figures = held.ok
    ? await independentBudgetFigures({ provider, fields, raw, wallet: action.walletAddress ?? fields.walletAddress, positionsPayload: held.payload })
    : null;
  const deployed = figures?.deployedMicroUsd ?? null;
  const deposit = figures?.depositMicroUsd ?? null;
  if (classifyDeposit({ budgetUsd, deployedMicroUsd: deployed, depositMicroUsd: deposit }) === 'free') return null;
  const depositUsd = deposit === null ? 'unknown' : ethers.formatUnits(deposit, 6);
  const reason = budgetUsd === 0 ? 'Any deposit would take the total past the $0 budget.'
      : deposit === null || deployed === null ? 'The deposit could not be independently sized in dollars.'
      : `This deposit of $${depositUsd} would take the total past the $${budgetUsd} budget.`;
  const { type, pool, tokenId, amountX, amountY, strategy, binRange } = action;
  const request = await addPendingDeposit(neumaId, { action: { type, pool, tokenId, amountX, amountY, strategy, binRange }, depositUsd, reason });
  await tellDepositWaiting(neumaId, request);
  return refuse(`${reason} It is waiting for the operator's answer.`, { pending: true, requestId: request.id });
};

/**
 * Run one LP action for a house member. Never throws. impure — reads the keys
 * folder, calls Umbrae and Base, signs, writes the audit line.
 *
 * @param {string} neumaId
 * @param {{type: 'open'|'add'|'claim'|'withdraw'|'close', pool: string, tokenId?: string,
 *   amountX?: string, amountY?: string, strategy?: 0|1|2, binRange?: number, percent?: number}} action
 *   amounts are plain decimals of the pool's own tokens ("5" USDC)
 * @param {{operatorApproved?: boolean, provider?: ethers.Provider, pollMs?: number}} [opts]
 *   operatorApproved — set only by the operator's yes on a waiting deposit
 * @returns {Promise<Readonly<{ok: true, type: string, txHashes: string[], tokenId: string|null, approvals: number}
 *   | {ok: false, reason: string, pending?: boolean, requestId?: string, txHash?: string}>>}
 */
const actOnce = async (neumaId, action, { operatorApproved = false, provider, pollMs = 3000, receiptProvider, receiptConfirmations } = {}) => {
  const asked = readAction(action);
  if (!asked.ok) return asked;
  if (DEPOSITS.includes(asked.type)) {
    const allowed = await assertLpNotPaused(neumaId);
    if (!allowed.ok) return allowed;
  }
  const signer = await lpSigner(neumaId);
  if (!signer) return refuse('This house member has no LP wallet yet.');
  const pool = await callUmbrae('pool', { params: { address: asked.pool } });
  if (!pool.ok) return refuse(pool.error);
  if (!ethers.isAddress(pool.payload?.address) || ethers.getAddress(pool.payload.address) !== asked.pool) {
    return refuse('Umbrae returned a different pool than the one requested. Nothing was signed.');
  }
  const isDeposit = DEPOSITS.includes(asked.type);
  const base = provider ?? await lpBase();
  if (!base) return refuse('Base did not answer, so nothing can be signed.');
  const vault = await readAgentVault(neumaId);
  let fields = poolFields(pool.payload, vault?.safe ?? signer.address);
  if (!fields) return refuse('Umbrae\'s answer for that pool is missing its tokens.');
  if (isDeposit) {
    try {
      const [baseFactor, tokenXDecimals, tokenYDecimals] = await Promise.all([
        poolBaseFactorOnChain(base, asked.pool),
        tokenDecimalsOnChain(base, fields.tokenX),
        tokenDecimalsOnChain(base, fields.tokenY),
      ]);
      fields = Object.freeze({ ...fields, baseFactor, tokenXDecimals, tokenYDecimals });
    } catch (error) {
      return refuse(`Base could not read this pool's execution parameters: ${error.message}`);
    }
  }
  const body = {
    ...fields, actionType: LP_ACTIONS[asked.type], amountX: asked.amountX ?? '0', amountY: asked.amountY ?? '0',
    ...(asked.tokenId ? { tokenId: asked.tokenId } : {}),
    ...(isDeposit ? { strategy: asked.strategy, binRange: asked.binRange, slippageBps: 100 } : {}),
    ...(asked.type === 'withdraw' ? { bps: asked.percent * 100 } : {}),
  };
  let raw;
  try {
    raw = {
      amountX: ethers.parseUnits(body.amountX, fields.tokenXDecimals).toString(),
      amountY: ethers.parseUnits(body.amountY, fields.tokenYDecimals).toString(),
    };
  } catch {
    return refuse(`An amount has more decimal places than the token has (${fields.tokenXSymbol} ${fields.tokenXDecimals}, ${fields.tokenYSymbol} ${fields.tokenYDecimals}).`);
  }
  const enrolled = await umbraeKeyFor(neumaId);
  if (!enrolled.ok) return enrolled;
  const keyed = keyedCaller(neumaId, enrolled.key);
  const ctx = { signer, provider: base, keyed, pollMs, neumaId, receiptProvider, receiptConfirmations, vault };

  if (isDeposit && !operatorApproved) {
    const held = await budgetGate(neumaId, keyed, asked, fields, raw, base);
    if (held) return held;
  }
  if (isDeposit) {
    const admitted = await reserveCapitalAssets(neumaId, [
      { token: fields.tokenX, amount: raw.amountX, decimals: fields.tokenXDecimals },
      { token: fields.tokenY, amount: raw.amountY, decimals: fields.tokenYDecimals },
    ].filter((asset) => BigInt(asset.amount) > 0n));
    if (!admitted.ok) return admitted;
  }

  const approvals = await keyed('approvals', body);
  if (!approvals.ok) return refuse(approvals.error);
  // An allowance is never more than twice the deposit it serves.
  const maxApprove = {
    [ethers.getAddress(fields.tokenX)]: (BigInt(raw.amountX) * 2n).toString(),
    [ethers.getAddress(fields.tokenY)]: (BigInt(raw.amountY) * 2n).toString(),
  };
  const steps = approvals.payload?.steps ?? [];
  for (const step of steps) {
    const approved = await signSendWait(ctx, step.transaction, { kind: 'approval', pool: asked.pool }, maxApprove);
    if (!approved.ok) return approved;
  }

  let plan;
  try {
    plan = isDeposit
      ? await quoteDepositOnChain(base, fields, asked, raw)
      : await quoteExitOnChain(base, { ...asked, walletAddress: signer.address });
  } catch (error) {
    return refuse(`Base could not establish this action's economic terms: ${error.message}`);
  }

  const baseIntent = isDeposit
    ? { kind: 'deposit', action: asked.type === 'open' ? 'createPositionWithStrategy' : 'increasePositionWithStrategy', tokenId: asked.tokenId, tokenX: fields.tokenX, tokenY: fields.tokenY, ...raw, ...plan }
    : { kind: 'exit', tokenId: asked.tokenId, actions: EXIT_ACTIONS[asked.type], ...plan };
  const txHashes = [];
  let tokenId = asked.tokenId;
  let claimStartIndex = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const built = await keyed('build', asked.type === 'claim' ? { ...body, claimStartIndex } : body);
    if (!built.ok) return refuse(built.error, { txHashes });
    const intent = asked.type === 'claim' ? { ...baseIntent, startIndex: String(claimStartIndex) } : baseIntent;
    const done = await signSendWait(ctx, built.payload?.transaction, intent);
    if (!done.ok) return Object.freeze({ ...done, txHashes });
    txHashes.push(done.txHash);
    const synced = await keyed('sync', { txHash: done.txHash, walletAddress: fields.walletAddress, actionToken: built.payload.actionToken });
    tokenId = (synced.ok && synced.payload?.tokenId) || tokenId;
    const meta = built.payload.meta ?? {};
    const more = asked.type === 'close' ? meta.chunkedClose === true : asked.type === 'claim' && meta.claimComplete === false;
    if (!more) {
      await neumaWorkspace.audit(neumaId, 'LP_ACTION', { type: asked.type, pool: asked.pool, tokenId, txHashes, recorded: synced.ok });
      return Object.freeze({ ok: true, type: asked.type, txHashes, tokenId, approvals: steps.length, poolName: pool.payload?.name ?? null });
    }
    claimStartIndex = (meta.claimStartIndex ?? 0) + (meta.claimBinCount ?? 0);
  }
  await neumaWorkspace.audit(neumaId, 'LP_ACTION', { type: asked.type, pool: asked.pool, tokenId, txHashes, unfinished: true });
  return refuse(`The ${asked.type} took ${MAX_ROUNDS} transactions and is still not finished. Ask again to continue.`, { txHashes });
};

// pure — the act in a few words, for the book.
const actWords = (a) => ({
  open: `opened a position in ${a.pool} with ${a.amountX ?? 0} X + ${a.amountY ?? 0} Y, ${a.binRange ?? 10} bins each side`,
  add: `added ${a.amountX ?? 0} X + ${a.amountY ?? 0} Y to position #${a.tokenId}`,
  claim: `claimed the fees of position #${a.tokenId}`,
  withdraw: `withdrew ${a.percent}% of position #${a.tokenId}`,
  close: `closed position #${a.tokenId}`,
}[a?.type] ?? 'an LP action');

/**
 * Run one LP action, through the earnings book (lp-book.js); a malformed one
 * is refused before anything is read. Never throws. impure — see actOnce's doc above.
 */
export const runLpAction = async (neumaId, action, opts = {}) => {
  const asked = readAction(action);
  return asked.ok ? booked(neumaId, action, opts) : asked;
};
const booked = (neumaId, action, opts) => bookAct(neumaId, {
  act: action?.type, what: actWords(action), why: action?.why,
  pool: ethers.isAddress(action?.pool) ? ethers.getAddress(action.pool) : undefined,
}, () => actOnce(neumaId, action, opts), { provider: opts.provider });

/**
 * The operator's answer to a deposit that waited. A yes runs it as it was
 * asked, past the budget; a no ends it. Either way it is answered once.
 * impure — as runLpAction.
 *
 * @param {string} neumaId
 * @param {string} requestId
 * @param {'approved'|'declined'} answer
 * @param {{provider?: ethers.Provider, pollMs?: number}} [opts]
 * @returns {Promise<Readonly<object>>} runLpAction's answer, or the decline
 */
export const answerWaitingDeposit = async (neumaId, requestId, answer, opts = {}) => {
  if (answer !== 'approved' && answer !== 'declined') return refuse('The answer is approved or declined.');
  const request = await takePendingDeposit(neumaId, requestId, answer);
  if (!request) return refuse('That deposit is no longer waiting: it was answered, or it is older than a day.');
  const wake = (result) => {
    signalWake({ seat: neumaId, reason: 'lp', ref: `deposit-${requestId}`, detail: { event: 'deposit-answered', answer, pool: request.action.pool, ok: Boolean(result.ok), reason: result.reason ?? null } });
    return result;
  };
  if (answer === 'declined') return wake(Object.freeze({ ok: true, declined: true, requestId }));
  return wake(await runLpAction(neumaId, request.action, { ...opts, operatorApproved: true }));
};
