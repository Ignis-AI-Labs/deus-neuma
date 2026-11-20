// lp-trade.js — a house member's swaps and sends from its LP wallet (Founder
// 2026-11-13: […], […], money stays in
// the house).
//
//   swap: Umbrae's pool list → every direct and one-hop route between the two
//   tokens (the same token twice = a round trip through two pools of one
//   pair, run only for a profit) → the router's own quote for each → the best
//   → an exact approval of the router if the allowance is short → the swap
//   with a minimum out under the slippage asked (default 1 %, at most 5 %) →
//   confirmed on Base.
//
//   send: a name or address of the house → ETH or a pool token → confirmed.
//
// Every transaction is signed through lp-signer.js, so the signing rule
// (core/wallet/lp-tx-policy.js + trade-policy.js) judges it: Umbrae's router
// only, pool tokens only, the wallet paid, the house reached. The wallet
// broadcasts through the app's own Base node; Umbrae is not asked to send.

import { ethers } from 'ethers';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { UMBRAE_ROUTER } from '../../../core/wallet/trade-policy.js';
import { lpBase } from './lp-base.js';
import { callUmbrae } from './umbrae-lp-client.js';
import { signLpTransaction } from './lp-signer.js';
import { lpSigner } from './lp-wallet.js';
import { houseRecipients, resolveRecipient } from './lp-house.js';
import { bookAct } from './lp-book.js';
import { aggregatorQuote, aggregatorBuild } from './lp-aggregator.js';
import { KYBER_ROUTER } from '../../../core/wallet/aggregator-policy.js';
import { classifyLpTransaction, checkLpIntent } from '../../../core/wallet/lp-tx-policy.js';
import { guardLpExecution, recordLpBroadcast, settleLpExecution } from './lp-executions.js';
import { swapOutputFromReceipt } from '../../../core/wallet/swap-receipt.js';
import { proveLpReceipt, independentReceiptProvider } from './lp-receipt-proof.js';
import { reserveCapitalAssets } from './lp-capital-controls.js';
import { broadcastLpTransaction, prepareLpBroadcast } from './lp-broadcast.js';
import { readAgentVault } from '../agent-vault/vault-store.js';
import { PINNED_TOKENS, resolveToken, tokenLabel } from './lp-tokens.js';
import { createLogger } from '../logger.js';

const log = createLogger('LpTrade');

const ROUTER = new ethers.Interface([
  'function getDetailedSwapQuote(uint256 amountIn, address[] path, uint16[] binSteps, address[] pools) view returns (uint256 amountOut, uint256 consumedAmountIn, uint256[] feesPerHop, uint256 priceImpact, uint256[] amountsPerHop, uint24[] activeBinsPerPair, bool liquidityExhausted)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, uint16[] binSteps, address[] pools, address to, uint256 deadline)',
]);
const ERC20 = new ethers.Interface([
  'function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount)', 'function transfer(address to, uint256 amount)',
]);
/** The most slippage a swap may be asked to accept, in percent. */
export const MAX_SLIPPAGE_PCT = 5;
/** How far two Base nodes' quotes for one route may sit apart, in basis points, before nothing is signed. */
export const QUOTE_AGREEMENT_BPS = 100n;
const AMOUNT = /^\d{1,30}(\.\d{1,18})?$/;

const refuse = (reason, extra = {}) => Object.freeze({ ok: false, reason, ...extra });
const call = async (provider, to, iface, fn, args = []) => iface.decodeFunctionResult(fn, await provider.call({ to, data: iface.encodeFunctionData(fn, args) }));

// impure — Umbrae's pools as route material, or [] when the list did not answer.
const readPools = async () => {
  const out = await callUmbrae('pools');
  if (!out.ok) return [];
  return (out.payload?.groups ?? []).flatMap((g) => (g.pairs ?? []).map((p) => ({
    address: p.address, binStep: p.bin_step,
    tokens: [p.mint_x ?? g.mint_x, p.mint_y ?? g.mint_y], symbols: [g.tokenX, g.tokenY],
  }))).filter((p) => ethers.isAddress(p.address) && p.tokens.every(ethers.isAddress) && Number.isInteger(p.binStep))
    .map((p) => ({ ...p, address: ethers.getAddress(p.address), tokens: p.tokens.map((t) => ethers.getAddress(t)) }));
};

// pure — every token the pools trade, by address, under the name it is shown by (lp-tokens.js).
const tokenBook = (pools) => {
  const book = new Map();
  for (const p of pools) p.tokens.forEach((t, i) => { if (!book.has(t)) book.set(t, tokenLabel(t, p.symbols[i])); });
  return book;
};

// pure — the tokens named, each as the one address the pools trade for it; a
// name two tokens share is refused with its own reason, any other miss with `unlisted`.
const tokensNamed = (book, said, unlisted) => {
  const found = said.map((name) => resolveToken(book, name));
  const ambiguous = found.find((f) => !f.ok && f.ambiguous);
  if (ambiguous) return refuse(ambiguous.reason);
  return found.every((f) => f.ok) ? { ok: true, addresses: found.map((f) => f.address) } : refuse(unlisted);
};

// pure — every route of one pool or two between two tokens.
const routesBetween = (pools, from, to) => {
  const other = (p, t) => (p.tokens[0] === t ? p.tokens[1] : p.tokens[1] === t ? p.tokens[0] : null);
  const direct = pools.filter((p) => other(p, from) === to).map((p) => ({ path: [from, to], binSteps: [p.binStep], pools: [p.address] }));
  const hops = pools.flatMap((a) => {
    const mid = other(a, from);
    if (!mid || mid === to) return [];
    return pools.filter((b) => b !== a && other(b, mid) === to).map((b) => ({ path: [from, mid, to], binSteps: [a.binStep, b.binStep], pools: [a.address, b.address] }));
  });
  return [...direct, ...hops];
};

// impure — the router's own quote for every route between two tokens, the
// best first; null when no route takes the amount whole.
const bestRoute = async (provider, pools, from, to, amountIn) => {
  const quoted = (await Promise.all(routesBetween(pools, from, to).map(async (route) => {
    try {
      const q = await call(provider, UMBRAE_ROUTER, ROUTER, 'getDetailedSwapQuote', [amountIn, route.path, route.binSteps, route.pools]);
      return q.liquidityExhausted || q.amountOut === 0n ? null : { route, amountOut: q.amountOut, priceImpact: q.priceImpact, feesPerHop: q.feesPerHop };
    } catch {
      return null;
    }
  }))).filter(Boolean).sort((a, b) => (b.amountOut > a.amountOut ? 1 : b.amountOut < a.amountOut ? -1 : 0));
  return quoted[0] ?? null;
};

// impure — the best route's quote asked again at the second Base node (P6-11: one node's word
// sets neither the price nor the floor). Two answers further apart than QUOTE_AGREEMENT_BPS, or
// no second answer, sign nothing; the floor is then cut from the larger of the two.
const secondQuote = async (ctx, best, amountIn) => {
  if (!ctx.second) return refuse('No second Base node is available to check this swap\'s price against, so nothing was signed.');
  let other;
  try {
    other = await call(ctx.second, UMBRAE_ROUTER, ROUTER, 'getDetailedSwapQuote', [amountIn, best.route.path, best.route.binSteps, best.route.pools]);
  } catch {
    return refuse('The second Base node did not answer for this swap\'s price, so nothing was signed.');
  }
  const [larger, smaller] = other.amountOut > best.amountOut ? [other.amountOut, best.amountOut] : [best.amountOut, other.amountOut];
  if (other.liquidityExhausted || (larger - smaller) * 10000n > larger * QUOTE_AGREEMENT_BPS) {
    return refuse('Two Base nodes disagree about what this swap would pay, so nothing was signed. Check the Base node address saved in Settings.');
  }
  return { ok: true, best: { ...best, amountOut: larger } };
};

// impure — the receipt, asked for directly until it comes (or null after timeoutMs). Not ethers'
// waitForTransaction: it waits for a NEXT block past a block number it may hold from its own
// 250 ms cache, and a node that mines only on demand never makes one.
const receiptOf = async (provider, hash, timeoutMs = 120000) => {
  for (const until = Date.now() + timeoutMs; Date.now() < until;) {
    const receipt = await provider.send('eth_getTransactionReceipt', [hash]).catch(() => null);
    if (receipt) return receipt;
    await new Promise((resolve) => { setTimeout(resolve, 500); });
  }
  return null;
};

const receiptEvidence = (ctx) => ({
  secondary: ctx.second ?? undefined,
  minConfirmations: ctx.receiptConfirmations,
  timeoutMs: ctx.receiptTimeoutMs ?? 120000,
});

// impure — sign through the rule, broadcast through our Base node, wait for the receipt.
const signAndSend = async (ctx, tx, asked, maxApprove) => {
  const guardedTx = { ...tx, chainId: 8453 };
  const ready = await prepareLpBroadcast({ neumaId: ctx.neumaId });
  if (!ready.ok) return refuse(ready.reason);
  const guard = await guardLpExecution({ neumaId: ctx.neumaId, tx: guardedTx, asked, provider: ctx.provider, ...receiptEvidence(ctx) });
  if (!guard.ok) return guard;
  const signed = await signLpTransaction({ signer: ctx.signer, provider: ctx.provider, second: ctx.second, tx: guardedTx, asked, maxApprove, tokens: ctx.tokens, recipients: ctx.recipients, vault: ctx.vault });
  if (!signed.ok) return signed;
  const recorded = await recordLpBroadcast({ neumaId: ctx.neumaId, actionHash: guard.actionHash, signed });
  if (!recorded.ok) return recorded;
  const mark = (state) => settleLpExecution({ neumaId: ctx.neumaId, actionHash: guard.actionHash, state }).catch((error) => {
    log.error('LP execution settlement was not written', { neumaId: ctx.neumaId, state, error: error.message });
  });
  try {
    const sent = await broadcastLpTransaction({ neumaId: ctx.neumaId, signed, provider: ctx.provider, second: ctx.second });
    if (!sent.ok) {
      const uncertain = sent.sent !== false;
      await mark(uncertain ? 'unknown' : 'aborted');
      return refuse(sent.reason, { txHash: signed.hash, ...(uncertain ? { uncertain: true } : {}) });
    }
    const receipt = await receiptOf(ctx.provider, signed.hash, ctx.receiptTimeoutMs ?? 120000);
    if (!receipt) {
      await mark('unknown');
      return refuse('Base has not confirmed the transaction after two minutes; it may still land. Reconcile its hash before trying again.', { txHash: signed.hash, uncertain: true });
    }
    if (Number(receipt.status) !== 1) {
      await mark('reverted');
      return refuse('Base ran the transaction and it failed. Nothing moved.', { txHash: signed.hash });
    }
    const proof = await proveLpReceipt({ primary: ctx.provider, hash: signed.hash, ...receiptEvidence(ctx) });
    if (!proof.ok) {
      await mark('unknown');
      return refuse('The transaction has not been independently confirmed yet. Reconcile its hash before trying again.', { txHash: signed.hash, uncertain: true });
    }
    await mark('confirmed');
    return { ok: true, txHash: signed.hash, receipt: proof.receipt };
  } catch (err) {
    await mark('unknown');
    return refuse(`The transaction outcome is unknown: ${err.shortMessage || err.message}`, { txHash: signed.hash, uncertain: true });
  }
};

// impure — a confirmed swap stays confirmed even when its allowance cleanup reports a failure.
const cleanupAllowance = async (ctx, token, spender) => {
  const txHashes = [];
  const warnings = [];
  try {
    const [remaining] = await call(ctx.provider, token, ERC20, 'allowance', [ctx.wallet, spender]);
    if (remaining > 0n) {
      const revoked = await signAndSend(ctx,
        { to: token, data: ERC20.encodeFunctionData('approve', [spender, 0n]) },
        { kind: 'approval', spender, token, revoke: true }, { [token]: '0' });
      if (revoked.ok) txHashes.push(revoked.txHash);
      else warnings.push(revoked.reason);
    }
  } catch (error) {
    warnings.push(`Allowance cleanup could not be confirmed: ${error.shortMessage || error.message}`);
  }
  return { txHashes, warnings };
};

// impure — the wallet, the node, a second independent node (the caller's, or one opened here
// and closed by withContext), the token book and the house, for one act.
const contextFor = async (neumaId, provider, opts = {}) => {
  const signer = await lpSigner(neumaId);
  if (!signer) return refuse('This house member has no LP wallet yet.');
  const base = provider ?? await lpBase();
  if (!base) return refuse('Base did not answer, so nothing can be signed.');
  const [pools, house, vault] = await Promise.all([readPools(), houseRecipients(neumaId), readAgentVault(neumaId)]);
  const book = tokenBook(pools);
  return { ok: true, neumaId, signer, provider: base, pools, book, house, vault, wallet: vault?.safe ?? signer.address, tokens: new Set(book.keys()), recipients: new Set(house.map((r) => r.address)), receiptTimeoutMs: opts.receiptTimeoutMs, second: opts.receiptProvider ?? independentReceiptProvider(base), ownsSecond: !opts.receiptProvider, receiptConfirmations: opts.receiptConfirmations };
};

// impure — one act run with its context; a second node opened for it is closed after.
const withContext = async (neumaId, options, run) => {
  const ctx = await contextFor(neumaId, options.provider, options);
  if (!ctx.ok) return ctx;
  try {
    return await run(ctx);
  } finally {
    if (ctx.ownsSecond) ctx.second?.destroy();
  }
};

// The swap itself (runSwap's body); may throw on an unanswered read.
/**
 * Swap one pool token for another through Umbrae's router.
 * impure — reads Umbrae and Base, signs, broadcasts, writes the audit line.
 *
 * @param {string} neumaId
 * @param {{tokenIn: string, tokenOut: string, amount: string, slippagePct?: number}} ask - tokens by symbol or address; amount a plain decimal
 * @param {{provider?: ethers.Provider}} [opts]
 * @returns {Promise<Readonly<{ok: true, txHashes: string[], amountIn: string, amountOut: string, route: string[]} | {ok: false, reason: string}>>}
 */
const swapOnce = (neumaId, ask, options = {}) => withContext(neumaId, options, (ctx) => swapWith(ctx, neumaId, ask));
const swapWith = async (ctx, neumaId, { tokenIn, tokenOut, amount, slippagePct = 1 } = {}) => {
  const slip = Number(slippagePct);
  if (!ctx.pools.length) return refuse('Umbrae\'s pool list did not answer, so no route can be found.');
  const named = tokensNamed(ctx.book, [tokenIn, tokenOut], `Swaps are between tokens Umbrae's pools trade: ${[...ctx.book.values()].join(', ')}.`);
  if (!named.ok) return named;
  const [from, to] = named.addresses;
  const roundTrip = from === to;
  const wallet = ctx.wallet;
  let decimalsIn; let decimalsOut; let held;
  try {
    [[decimalsIn], [decimalsOut], [held]] = await Promise.all([
      call(ctx.provider, from, ERC20, 'decimals'), call(ctx.provider, to, ERC20, 'decimals'), call(ctx.provider, from, ERC20, 'balanceOf', [wallet]),
    ]);
  } catch {
    return refuse('Base did not answer for those tokens, so nothing was signed.');
  }
  let amountIn;
  try {
    amountIn = ethers.parseUnits(String(amount), Number(decimalsIn));
  } catch {
    return refuse(`${ctx.book.get(from)} has ${decimalsIn} decimal places.`);
  }
  if (amountIn <= 0n || amountIn > held) return refuse(`The wallet holds ${ethers.formatUnits(held, decimalsIn)} ${ctx.book.get(from)}.`);

  // TWO ROADS (Design note, 2026-11-13: […]): Umbrae's
  // router and KyberSwap's aggregator, each asked for the same amount; the one that pays more is
  // taken. A round trip is an arbitrage between two Umbrae pools, so it stays on Umbrae's road.
  const [first, agg] = await Promise.all([
    bestRoute(ctx.provider, ctx.pools, from, to, amountIn),
    roundTrip ? null : aggregatorQuote({ tokenIn: from, tokenOut: to, amountIn }),
  ]);
  const agreed = first ? await secondQuote(ctx, first, amountIn) : null;
  if (agreed && !agreed.ok) return agreed;
  const best = agreed?.best ?? null;
  const aggOk = agg?.ok ? agg : null;
  if (!best && !aggOk) {
    return refuse(roundTrip ? 'No two pools of one pair can take this round trip right now.'
      : `No Umbrae pool route can take this swap whole right now${agg ? `, and ${agg.error}` : ''}.`);
  }
  // A round trip runs only for a profit, and its floor sits above what it spends:
  // if the price moves first, Base reverts it and only gas is lost.
  if (roundTrip && best.amountOut <= amountIn) {
    return refuse(`No profit in a round trip right now: ${amount} ${ctx.book.get(from)} would come back as ${ethers.formatUnits(best.amountOut, decimalsOut)}.`);
  }
  const viaAgg = Boolean(aggOk && (!best || aggOk.amountOut > best.amountOut));
  const quoted = viaAgg ? aggOk.amountOut : best.amountOut;
  const floor = (quoted * BigInt(Math.round((100 - slip) * 100))) / 10000n;
  const amountOutMin = roundTrip && floor <= amountIn ? amountIn + 1n : floor;
  const compared = {
    umbrae: best ? ethers.formatUnits(best.amountOut, decimalsOut) : null,
    kyberswap: aggOk ? ethers.formatUnits(aggOk.amountOut, decimalsOut) : null,
  };

  let road;
  if (viaAgg) {
    // KyberSwap builds the call under HALF the slippage asked, so a route that moved a hair
    // between quote and build still clears the run's own floor (checkLpIntent binds it).
    const built = await aggregatorBuild({ routeSummary: aggOk.routeSummary, wallet, slippageBps: Math.max(1, Math.round(slip * 50)) });
    if (!built.ok) return refuse(`KyberSwap quoted the better price but did not build the swap: ${built.error}. Nothing was signed.`);
    if (!ethers.isAddress(built.to) || ethers.getAddress(built.to) !== KYBER_ROUTER) return refuse('KyberSwap named a router other than its own. Nothing was signed.');
    road = { spender: KYBER_ROUTER, tx: { to: KYBER_ROUTER, data: built.data, value: built.value }, via: 'kyberswap', exchanges: aggOk.exchanges };
    // Judged BEFORE the approval: a build the signing rule would refuse leaves nothing signed at all.
    const verdict = classifyLpTransaction({ ...road.tx, chainId: 8453 }, { wallet, tokens: ctx.tokens, recipients: ctx.recipients });
    const fits = verdict.ok ? checkLpIntent(verdict, { kind: 'swap', tokenIn: from, tokenOut: to, amountIn: amountIn.toString(), amountOutMin: amountOutMin.toString() }) : verdict;
    if (!fits.ok) return refuse(`KyberSwap's swap was refused before anything was signed: ${fits.reason}`);
  } else {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    road = {
      spender: UMBRAE_ROUTER, via: 'umbrae',
      tx: { to: UMBRAE_ROUTER, data: ROUTER.encodeFunctionData('swapExactTokensForTokens', [amountIn, amountOutMin, best.route.path, best.route.binSteps, best.route.pools, wallet, deadline]) },
    };
  }

  const admitted = await reserveCapitalAssets(neumaId, [{ token: from, amount: amountIn, decimals: Number(decimalsIn) }]);
  if (!admitted.ok) return admitted;
  const txHashes = [];
  const [allowance] = await call(ctx.provider, from, ERC20, 'allowance', [wallet, road.spender]);
  if (allowance < amountIn) {
    const approved = await signAndSend(ctx, { to: from, data: ERC20.encodeFunctionData('approve', [road.spender, amountIn]) }, { kind: 'approval', spender: road.spender, token: from }, { [from]: amountIn.toString() });
    if (!approved.ok) return approved;
    txHashes.push(approved.txHash);
  }
  const swapped = await signAndSend(ctx, road.tx, { kind: 'swap', tokenIn: from, tokenOut: to, amountIn: amountIn.toString(), amountOutMin: amountOutMin.toString() });
  if (!swapped.ok) {
    if (swapped.uncertain) return Object.freeze({ ...swapped, txHashes });
    const approvalCleanup = await cleanupAllowance(ctx, from, road.spender);
    return Object.freeze({ ...swapped, txHashes: [...txHashes, ...approvalCleanup.txHashes], approvalCleanup });
  }
  txHashes.push(swapped.txHash);
  const approvalCleanup = await cleanupAllowance(ctx, from, road.spender);
  txHashes.push(...approvalCleanup.txHashes);
  const receipt = swapped.receipt ?? await ctx.provider.send('eth_getTransactionReceipt', [swapped.txHash]).catch(() => null);
  const executedOut = swapOutputFromReceipt({ receipt, tokenOut: to, wallet, sources: viaAgg ? null : new Set(best.route.pools) });
  const route = viaAgg ? [ctx.book.get(from), ctx.book.get(to)] : best.route.path.map((t) => ctx.book.get(t));
  await neumaWorkspace.audit(neumaId, 'LP_ACTION', { type: 'swap', via: road.via, route, amountIn: String(amount), compared, txHashes });
  const amountOut = executedOut === null ? 'an unread amount of' : ethers.formatUnits(executedOut, decimalsOut);
  return Object.freeze({ ok: true, txHashes, amountIn: String(amount), amountOut, route, tokens: { in: from, out: to }, via: road.via, exchanges: road.exchanges ?? null, compared, approvalCleanup });
};

// The send itself (runSend's body); may throw on an unanswered read.
/**
 * Send ETH or a pool token to a wallet of the house (or the operator's list). impure — reads the house and Base, signs, broadcasts, audits.
 *
 * @param {string} neumaId
 * @param {{to: string, token?: string, amount: string}} ask - to: an address or a name ("Rugevil", "Rugevil main", "operator"); token: "ETH" (default) or a pool token
 * @param {{provider?: ethers.Provider}} [opts]
 * @returns {Promise<Readonly<{ok: true, txHashes: string[], to: string, name: string} | {ok: false, reason: string}>>}
 */
const sendOnce = (neumaId, ask, options = {}) => withContext(neumaId, options, (ctx) => sendWith(ctx, neumaId, ask));
const sendWith = async (ctx, neumaId, { to, token = 'ETH', amount } = {}) => {
  const target = resolveRecipient(ctx.house, to);
  if (!target) return refuse(`That is not a wallet of the house. It can send to: ${[...new Set(ctx.house.map((r) => r.name))].join(', ')}.`);
  const native = String(token).trim().toUpperCase() === 'ETH';
  const named = native ? null : tokensNamed(ctx.book, [token], `It sends ETH or a token Umbrae's pools trade: ${[...ctx.book.values()].join(', ')}.`);
  if (named && !named.ok) return named;
  const tokenAddress = named ? named.addresses[0] : null;
  const [decimals] = native ? [18] : await call(ctx.provider, tokenAddress, ERC20, 'decimals');
  let raw;
  try {
    raw = ethers.parseUnits(String(amount), Number(decimals));
  } catch {
    return refuse(`That token has ${decimals} decimal places.`);
  }
  const admitted = await reserveCapitalAssets(neumaId, [{
    token: tokenAddress ?? PINNED_TOKENS.WETH, amount: raw, decimals: Number(decimals),
  }]);
  if (!admitted.ok) return admitted;
  const tx = native
    ? { to: target.address, data: '0x', value: raw.toString() }
    : { to: tokenAddress, data: ERC20.encodeFunctionData('transfer', [target.address, raw]) };
  const sent = await signAndSend(ctx, tx, { kind: 'transfer', to: target.address, token: tokenAddress, amount: raw.toString() });
  if (!sent.ok) return sent;
  await neumaWorkspace.audit(neumaId, 'LP_ACTION', { type: 'send', to: target.address, name: target.name, token: native ? 'ETH' : ctx.book.get(tokenAddress), amount: String(amount), txHashes: [sent.txHash] });
  return Object.freeze({ ok: true, txHashes: [sent.txHash], token: native ? 'ETH' : tokenAddress, amount: String(amount), to: target.address, name: `${target.name}${target.wallet === 'main' || target.wallet === 'liquidity' ? ` (${target.wallet})` : ''}` });
};

// pure — an unexpected failure as a plain refusal.
const caught = (what) => (err) => refuse(`The ${what} stopped: ${err.shortMessage || err.message}`);

// pure — which road a swap took and what the other quoted, for the book (so a member sees when Umbrae's price catches up).
const roadWords = (r) => {
  if (!r?.via) return '';
  const other = r.via === 'kyberswap' ? `Umbrae's router quoted ${r.compared?.umbrae ?? 'no route'}` : `KyberSwap quoted ${r.compared?.kyberswap ?? 'nothing (off or no route)'}`;
  return ` via ${r.via === 'kyberswap' ? `KyberSwap${r.exchanges?.length ? ` (${r.exchanges.join(', ')})` : ''}` : "Umbrae's router"}; ${other}`;
};

/** Swap one pool token for another through Umbrae's router, through the earnings book. Never throws. impure — see swapOnce. */
export const runSwap = (neumaId, ask, opts = {}) => {
  // A malformed ask is refused before anything is read.
  if (!AMOUNT.test(String(ask?.amount ?? ''))) return Promise.resolve(refuse('Say the amount to swap as a plain decimal.'));
  const slip = Number(ask?.slippagePct ?? 1);
  if (!Number.isFinite(slip) || slip < 0.05 || slip > MAX_SLIPPAGE_PCT) return Promise.resolve(refuse(`Slippage is between 0.05 and ${MAX_SLIPPAGE_PCT} percent.`));
  return swapBooked(neumaId, ask, opts);
};
const swapBooked = (neumaId, ask, opts) => bookAct(neumaId, {
  act: 'swap', why: ask?.why,
  what: (r) => (r.route && r.route[0] === r.route[r.route.length - 1]
    ? `round trip ${r.amountIn} ${r.route[0]} → ${r.amountOut} via ${r.route.join(' → ')}`
    : `swapped ${r.amountIn ?? ask?.amount} ${r.route?.[0] ?? ask?.tokenIn} → ${r.amountOut ?? '?'} ${r.route?.[r.route.length - 1] ?? ask?.tokenOut}${roadWords(r)}`),
}, () => swapOnce(neumaId, ask, opts).catch(caught('swap')), { provider: opts.provider });

/**
 * Send ETH or a pool token inside the house, through the earnings book (a send
 * is money handed on, or a reward paid when purpose is 'reward'). Never throws.
 * impure — see sendOnce.
 */
export const runSend = (neumaId, ask, opts = {}) => (AMOUNT.test(String(ask?.amount ?? ''))
  ? sendBooked(neumaId, ask, opts)
  : Promise.resolve(refuse('Say the amount to send as a plain decimal.')));
const sendBooked = (neumaId, ask, opts) => bookAct(neumaId, {
  act: opts.purpose === 'reward' ? 'reward' : 'send', why: ask?.why,
  what: (r) => `${opts.purpose === 'reward' ? 'paid a reward: ' : 'sent '}${ask?.amount} ${String(ask?.token ?? 'ETH').toUpperCase()} to ${r.name ?? ask?.to}`,
  paid: (r) => (r.ok ? { key: r.token, amount: r.amount } : null),
}, () => sendOnce(neumaId, ask, opts).catch(caught('send')), { provider: opts.provider });

/**
 * What a swap would give right now, from the router's own quote, without
 * signing anything: the best route, the amount out, and the price impact.
 * Never throws. impure — reads Umbrae's pool list and Base.
 *
 * @param {{tokenIn: string, tokenOut: string, amount: string}} ask
 * @param {{provider?: ethers.Provider}} [opts]
 * @returns {Promise<Readonly<{ok: true, route: string[], amountIn: string, amountOut: string, priceImpact: string} | {ok: false, reason: string}>>}
 */
export const quoteSwap = async ({ tokenIn, tokenOut, amount } = {}, { provider } = {}) => {
  try {
    if (!AMOUNT.test(String(amount ?? ''))) return refuse('Say the amount as a plain decimal.');
    const base = provider ?? await lpBase();
    if (!base) return refuse('Base did not answer.');
    const pools = await readPools();
    if (!pools.length) return refuse('Umbrae\'s pool list did not answer.');
    const book = tokenBook(pools);
    const named = tokensNamed(book, [tokenIn, tokenOut], `Quotes are between tokens Umbrae's pools trade: ${[...book.values()].join(', ')}.`);
    if (!named.ok) return named;
    const [from, to] = named.addresses;
    const [[decimalsIn], [decimalsOut]] = await Promise.all([call(base, from, ERC20, 'decimals'), call(base, to, ERC20, 'decimals')]);
    const raw = ethers.parseUnits(String(amount), Number(decimalsIn));
    // Both roads, as the swap itself asks them (a round trip stays on Umbrae's).
    const [best, agg] = await Promise.all([bestRoute(base, pools, from, to, raw), from === to ? null : aggregatorQuote({ tokenIn: from, tokenOut: to, amountIn: raw })]);
    const kyberswap = agg?.ok ? { amountOut: ethers.formatUnits(agg.amountOut, decimalsOut), exchanges: agg.exchanges, gasUsd: agg.gasUsd } : agg ? { error: agg.error } : null;
    if (!best && !kyberswap?.amountOut) return refuse(`No Umbrae pool route can take this amount whole right now${kyberswap?.error ? `, and ${kyberswap.error}` : ''}.`);
    return Object.freeze({
      ok: true, amountIn: String(amount), symbolIn: book.get(from), symbolOut: book.get(to), tokens: { in: from, out: to },
      route: best ? best.route.path.map((t) => book.get(t)) : null,
      amountOut: best ? ethers.formatUnits(best.amountOut, decimalsOut) : null, priceImpact: best ? best.priceImpact.toString() : null,
      kyberswap,
    });
  } catch (err) {
    return refuse(`The quote stopped: ${err.shortMessage || err.message}`);
  }
};
