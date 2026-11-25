// lp-pool.js — a house member opens a NEW pool on Umbrae (Design note, 2026-11-13: […]; 11-14: […]). Umbrae's own agent create-pool flow (its pool-routes.ts):
//
//   plan (Umbrae checks: a fee tier the pair lacks, a start price within 5% of
//   an established market, a seed of at most $20) → our token check →
//   approve the seed to the factory → Umbrae builds createPair → the signing
//   rule checks pair, tier, start bin and seed (core/wallet/pool-policy.js) →
//   sign → send → the pool's address read from the factory on Base.
//
// A NEW TOKEN may be listed when Umbrae's plan finds an established market for
// it outside Umbrae (its price check), or Umbrae's pools already trade it; the
// pool's other side must be a token Umbrae's pools trade (WETH, USDC…). The
// seed defaults to that side alone, $10 worth: a member opens a pool for a
// token it does not hold yet, and the pool's own trades bring it in. The seed
// stays in the pool for good; the member's liquidity then goes in as a
// position (lp/open), which it can always take back out.

import { ethers } from 'ethers';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { UMBRAE_FACTORY, binIdFor, orientPair } from '../../../core/wallet/pool-policy.js';
import { checkLpIntent, classifyLpTransaction } from '../../../core/wallet/lp-tx-policy.js';
import { lpBase } from './lp-base.js';
import { callUmbrae } from './umbrae-lp-client.js';
import { umbraeKeyFor } from './lp-enroll.js';
import { lpSigner } from './lp-wallet.js';
import { poolTokens } from './lp-holdings.js';
import { keyedCaller, signSendWait } from './lp-run.js';
import { reserveCapitalAssets } from './lp-capital-controls.js';
import { readAgentVault } from '../agent-vault/vault-store.js';
import { bookAct } from './lp-book.js';
import { independentTokenPrice } from './lp-budget-independent.js';
import { tokenDecimalsOnChain } from './lp-quotes.js';
import { resolveToken } from './lp-tokens.js';

const ERC20 = new ethers.Interface(['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)', 'function approve(address spender, uint256 amount)']);
const FACTORY = new ethers.Interface([
  'function getPair(address tokenX, address tokenY, uint16 binStep, uint16 baseFactor) view returns (address)',
  'function getAllFeeConfigs() view returns (uint16[] binSteps, uint16[] baseFees, uint16[] caps)',
]);
const AMOUNT = /^\d{1,30}(\.\d{1,18})?$/;
/** The seed when none is asked for: Umbrae's suggested $10, in the quote token alone. */
const SEED_USD = 10;

const refuse = (reason, extra = {}) => Object.freeze({ ok: false, reason, ...extra });

// pure — the ask checked: tokens by address, or by a symbol that names ONE token of Umbrae's book
// (lp-tokens.js), a whole fee tier, optional price and seed.
const readAsk = (ask, book) => {
  const listed = [...book].map(([address, t]) => [address, t.symbol]);
  const resolved = [ask?.baseToken, ask?.quoteToken].map((said) => (ethers.isAddress(String(said ?? '').trim())
    ? { ok: true, address: ethers.getAddress(String(said).trim()) } : resolveToken(listed, said)));
  const ambiguous = resolved.find((n) => !n.ok && n.ambiguous);
  if (ambiguous) return refuse(ambiguous.reason);
  const [base, quote] = resolved.map((n) => (n.ok ? n.address : null));
  if (!base) return refuse('Name the new pool\'s token (baseToken) by its address, or by symbol if Umbrae already trades it.');
  if (!quote || !book.has(quote)) return refuse(`The pool's other side (quoteToken) is a token Umbrae's pools trade: ${[...book.values()].map((t) => t.symbol).join(', ')}.`);
  if (base === quote) return refuse('A pool is two different tokens.');
  // A check with no tier lists the tiers (Tenekom 2026-11-14: the tier list must come before the tier).
  const named = ask?.binStep !== undefined || ask?.baseFee !== undefined;
  const binStep = Number(ask?.binStep);
  const baseFee = Number(ask?.baseFee);
  if ((named || ask?.check !== true) && (!Number.isInteger(binStep) || !Number.isInteger(baseFee) || binStep < 1 || baseFee < 1)) {
    return refuse('Name the fee tier as whole numbers, binStep and baseFee (basis points: 50 = 0.5%), or leave both out with check: true to list the tiers the factory allows.');
  }
  const startPrice = ask?.startPrice === undefined ? undefined : Number(ask.startPrice);
  if (startPrice !== undefined && !(startPrice > 0)) return refuse('startPrice is quote tokens per one base token, above zero.');
  for (const k of ['seedBase', 'seedQuote']) if (ask?.[k] !== undefined && !AMOUNT.test(String(ask[k]))) return refuse(`${k} is a plain decimal.`);
  return Object.freeze({
    ok: true, base, quote, binStep: named ? binStep : null, baseFee: named ? baseFee : null, startPrice, confirm: ask?.confirmFirstPrice === true,
    seedBase: ask?.seedBase === undefined ? null : String(ask.seedBase), seedQuote: ask?.seedQuote === undefined ? null : String(ask.seedQuote),
  });
};

/**
 * The fee tiers Umbrae's factory allows, read on Base, and for a pair the pool
 * each tier already has. baseFee is in basis points (50 = 0.5%). impure — reads Base.
 * @param {object} base - a provider
 * @param {{tokenX: string, tokenY: string}} [pair]
 * @returns {Promise<Array<{binStep: number, baseFee: number, pool: string|null}>|null>} null when Base did not answer
 */
export const factoryTiers = async (base, pair) => {
  const read = async (fn, args = []) => FACTORY.decodeFunctionResult(fn, await base.send('eth_call', [{ to: UMBRAE_FACTORY, data: FACTORY.encodeFunctionData(fn, args) }, 'latest']));
  try {
    const [steps, fees] = await read('getAllFeeConfigs');
    return await Promise.all(steps.map(async (step, i) => {
      const tier = { binStep: Number(step), baseFee: Number(fees[i]) };
      if (!pair) return { ...tier, pool: null };
      const [at] = await read('getPair', [pair.tokenX, pair.tokenY, tier.binStep, tier.baseFee]);
      return { ...tier, pool: at === ethers.ZeroAddress ? null : ethers.getAddress(at) };
    }));
  } catch {
    return null;
  }
};

/** The tiers as one line: […]. Pure. */
export const tierWords = (tiers) => tiers.map((t) => `${t.binStep}·${t.baseFee} = bin step ${t.binStep}, ${t.baseFee / 100}% fee (${t.pool ? `taken: ${t.pool}` : 'free'})`).join('; ');

// pure — the plan in a few lines a member can act on.
const planWords = (plan) => {
  const b = plan.baseToken?.symbol ?? 'base';
  const q = plan.quoteToken?.symbol ?? 'quote';
  return [
    `PLAN for a ${b}-${q} pool at bin step ${plan.feeTier?.binStep} · ${plan.feeTier?.baseFee} bps:`,
    `  tokens: ${b} ${plan.baseToken?.address ?? '?'} · ${q} ${plan.quoteToken?.address ?? '?'}`,
    `  fee tiers the factory allows: ${(plan.feeTiers ?? []).map((t) => `${t.binStep}·${t.baseFee}${t.existingPool ? ' (exists)' : ''}`).join(', ') || '?'}`,
    `  market: ${plan.market ? `${plan.market.price} ${q} per ${b}${plan.market.established ? ', established' : ', NOT established (thin outside pair)'}` : 'nothing prices this pair'}`,
    `  start price: ${plan.startPrice?.price ?? '?'} (${plan.startPrice?.check?.kind ?? '?'})`,
    `  seed: ${plan.seed?.amountBase ?? '?'} ${b} + ${plan.seed?.amountQuote ?? '?'} ${q}, about $${Number(plan.seed?.valueUsd ?? NaN).toFixed(2)} (at most $${plan.seed?.maxUsd ?? 20}; it stays in the pool for good)`,
    ...(plan.problems?.length ? ['  WHAT STOPS IT:', ...plan.problems.map((p) => `    ${p.code}: ${p.error}`)] : ['  nothing stops it: lp/create-pool without check opens it']),
  ].join('\n');
};

// impure — the wallet's raw balance of a token on Base, or null.
const balanceOf = (base, token, wallet) => base.send('eth_call', [{ to: token, data: ERC20.encodeFunctionData('balanceOf', [wallet]) }, 'latest'])
  .then((raw) => BigInt(raw), () => null);

// The run itself (runCreatePool's body); may throw on an unanswered read.
const createOnce = async (neumaId, a, { provider, pollMs = 3000, receiptProvider, receiptConfirmations } = {}) => {
  const signer = await lpSigner(neumaId);
  if (!signer) return refuse('This house member has no LP wallet yet.');
  const base = provider ?? await lpBase();
  if (!base) return refuse('Base did not answer, so nothing can be signed.');
  const vault = await readAgentVault(neumaId);
  const funds = vault?.safe ?? signer.address;
  const enrolled = await umbraeKeyFor(neumaId);
  if (!enrolled.ok) return enrolled;
  const keyed = keyedCaller(neumaId, enrolled.key);
  const { book } = a;
  // The seed: what was asked, or $10 of the quote token alone at Umbrae's price.
  let seedBase = a.seedBase;
  let seedQuote = a.seedQuote;
  if (seedBase === null && seedQuote === null) {
    const price = book.get(a.quote)?.priceUsd;
    if (!(price > 0)) return refuse('Umbrae gives no price for the quote token, so the seed cannot be sized: name seedQuote.');
    seedBase = '0';
    seedQuote = String(Number((SEED_USD / price).toFixed(8)));
  }
  const planned = await keyed('createPoolQuote', {
    baseToken: a.base, quoteToken: a.quote, binStep: a.binStep, baseFee: a.baseFee,
    ...(a.startPrice !== undefined ? { startPrice: a.startPrice } : {}),
    amountBase: seedBase ?? '0', amountQuote: seedQuote ?? '0',
    ...(a.confirm ? { confirmFirstPrice: true } : {}),
  });
  if (!planned.ok) return refuse(planned.error);
  const plan = planned.payload;
  // OUR TOKEN CHECK: a new token needs an established market outside Umbrae (Umbrae's own price check).
  if (!book.has(a.base) && plan.market?.established !== true) {
    return refuse(`No established market prices ${plan.baseToken?.symbol ?? a.base} outside Umbrae, so a pool for it would open at a guessed price. Pick a token that already trades with depth on Base.`, { plan: planWords(plan) });
  }
  if (a.check) return Object.freeze({ ok: true, checked: true, plan: planWords(plan) });
  if (plan.problems?.length || !plan.next) {
    return refuse(`Umbrae will not open it as planned: ${(plan.problems ?? []).map((p) => `${p.code}: ${p.error}`).join(' ') || 'the plan has no price or seed yet'}`, { plan: planWords(plan) });
  }
  const { tokenX, tokenY, baseIsX } = orientPair(a.base, a.quote);
  const [dBase, dQuote, baseUsd, quoteUsd] = await Promise.all([
    tokenDecimalsOnChain(base, a.base), tokenDecimalsOnChain(base, a.quote),
    independentTokenPrice(a.base), independentTokenPrice(a.quote),
  ]);
  if (!(baseUsd > 0) || !(quoteUsd > 0)) return refuse('Independent prices are unavailable or disagree, so the pool seed and start price cannot be verified.');
  const price = Number(plan.startPrice.price);
  const fair = baseUsd / quoteUsd;
  if (!(price > 0) || Math.abs(price - fair) > fair * 0.02) {
    return refuse(`The proposed start price ${price} is more than 2% from the independent market price ${fair}. Nothing was signed.`);
  }
  const raw = { base: ethers.parseUnits(plan.seed.amountBase, dBase), quote: ethers.parseUnits(plan.seed.amountQuote, dQuote) };
  const [haveBase, haveQuote] = await Promise.all([balanceOf(base, a.base, funds), balanceOf(base, a.quote, funds)]);
  if (haveBase === null || haveQuote === null) return refuse('Base did not answer for the seed tokens, so nothing was signed.');
  if (haveBase < raw.base || haveQuote < raw.quote) {
    return refuse(`The seed is ${plan.seed.amountBase} ${plan.baseToken.symbol} + ${plan.seed.amountQuote} ${plan.quoteToken.symbol}; the wallet holds ${ethers.formatUnits(haveBase, dBase)} ${plan.baseToken.symbol} and ${ethers.formatUnits(haveQuote, dQuote)} ${plan.quoteToken.symbol}.`);
  }
  const amountX = baseIsX ? raw.base : raw.quote;
  const amountY = baseIsX ? raw.quote : raw.base;
  const admitted = await reserveCapitalAssets(neumaId, [
    { token: a.base, amount: raw.base, decimals: dBase },
    { token: a.quote, amount: raw.quote, decimals: dQuote },
  ].filter((asset) => BigInt(asset.amount) > 0n), { maxActionUsd: 20 });
  if (!admitted.ok) return admitted;
  const ctx = { signer, provider: base, keyed, pollMs, neumaId, receiptProvider, receiptConfirmations, vault };
  const txHashes = [];

  const built = await keyed('buildPool', plan.next.buildPool);
  if (!built.ok) return refuse(built.error, { txHashes });
  const asked = {
    kind: 'create-pool', tokenX, tokenY, binStep: a.binStep, baseFactor: a.baseFee,
    amountX: amountX.toString(), amountY: amountY.toString(), activeId: binIdFor(baseIsX ? price : 1 / price, a.binStep),
  };
  const verdict = classifyLpTransaction(built.payload?.transaction, { wallet: vault?.safe ?? signer.address });
  const fits = verdict.ok ? checkLpIntent(verdict, asked) : verdict;
  if (!fits.ok) return refuse(`Umbrae's pool action was refused before any approval was signed: ${fits.reason}`);

  const approvals = await keyed('approvals', plan.next.approvals);
  if (!approvals.ok) return refuse(approvals.error);
  // An allowance to the factory is never more than twice that token's seed (Umbrae's own rule).
  const maxApprove = { [tokenX]: (amountX * 2n).toString(), [tokenY]: (amountY * 2n).toString() };
  const granted = [];
  const finish = async (result) => {
    if (result.uncertain || !granted.length) return result;
    const approvalCleanup = { txHashes: [], warnings: [] };
    for (const step of granted) {
      const token = ethers.getAddress(step.transaction.to);
      const revoked = await signSendWait(ctx,
        { to: token, chainId: 8453, data: ERC20.encodeFunctionData('approve', [UMBRAE_FACTORY, 0n]) },
        { kind: 'approval', spender: UMBRAE_FACTORY, token, revoke: true }, { [token]: '0' }).catch((error) => refuse(error.message));
      if (revoked.ok) approvalCleanup.txHashes.push(revoked.txHash);
      else approvalCleanup.warnings.push(revoked.reason);
    }
    return Object.freeze({ ...result, txHashes: [...txHashes, ...approvalCleanup.txHashes], approvalCleanup });
  };
  for (const step of approvals.payload?.steps ?? []) {
    const approved = await signSendWait(ctx, step.transaction, { kind: 'approval', spender: UMBRAE_FACTORY }, maxApprove);
    if (!approved.ok) return finish(Object.freeze({ ...approved, txHashes }));
    txHashes.push(approved.txHash);
    granted.push(step);
  }

  const created = await signSendWait(ctx, built.payload?.transaction, asked);
  if (!created.ok) return finish(Object.freeze({ ...created, txHashes }));
  txHashes.push(created.txHash);

  const pair = await base.send('eth_call', [{ to: UMBRAE_FACTORY, data: FACTORY.encodeFunctionData('getPair', [tokenX, tokenY, a.binStep, a.baseFee]) }, 'latest'])
    .then((r) => FACTORY.decodeFunctionResult('getPair', r)[0], () => null);
  const pool = pair && pair !== ethers.ZeroAddress ? ethers.getAddress(pair) : null;
  const name = `${plan.baseToken.symbol}-${plan.quoteToken.symbol}`;
  const completed = await finish(Object.freeze({
    ok: true, pool, name, tokens: { base: a.base, quote: a.quote }, startPrice: price, binStep: a.binStep, baseFee: a.baseFee,
    seed: `${plan.seed.amountBase} ${plan.baseToken.symbol} + ${plan.seed.amountQuote} ${plan.quoteToken.symbol}`,
  }));
  await neumaWorkspace.audit(neumaId, 'LP_ACTION', { type: 'create-pool', pool, name, binStep: a.binStep, baseFee: a.baseFee, startPrice: price, txHashes: completed.txHashes });
  return completed;
};

/**
 * Everything about an ask that can be judged before Umbrae is asked or anything
 * is signed: the tokens, the tier against the factory's own list, a tier the
 * pair already has. A check with no tier answers with the tier list. Never
 * throws. impure — reads Umbrae's public pool list and the factory on Base.
 * @returns {Promise<{ok: false, reason: string} | {ok: true, a: object, book: Map, tiers: Array|null, tierList?: string}>}
 */
const preflight = async (ask, opts = {}) => {
  try {
    const pools = await callUmbrae('pools');
    if (!pools.ok) return refuse(`Umbrae's pool list did not answer: ${pools.error}`);
    const book = poolTokens(pools.payload);
    const a = readAsk(ask, book);
    if (!a.ok) return a;
    const base = opts.provider ?? await lpBase().catch(() => null);
    const tiers = base ? await factoryTiers(base, orientPair(a.base, a.quote)) : null;
    // A token Umbrae lists by its symbol there; any other by its own symbol on Base, else its address, shortened.
    const own = !book.has(a.base) && base ? await base.send('eth_call', [{ to: a.base, data: ERC20.encodeFunctionData('symbol') }, 'latest']).then((r) => ERC20.decodeFunctionResult('symbol', r)[0]).catch(() => null) : null;
    const symbol = (t) => book.get(t)?.symbol ?? (t === a.base && typeof own === 'string' && own.trim() ? own.trim().slice(0, 24) : `${t.slice(0, 6)}…${t.slice(-4)}`);
    if (a.binStep === null) {
      if (!tiers) return refuse('Base did not answer, so the factory\'s tiers were not read. Try again in a moment.');
      return Object.freeze({ ok: true, a, book, tiers, tierList: [
        `FEE TIERS Umbrae's factory allows for ${symbol(a.base)}-${symbol(a.quote)} (binStep · baseFee; baseFee in basis points, 50 = 0.5%):`,
        `  ${tierWords(tiers)}`,
        'A pair may have one pool per tier. Pick a FREE tier: a wider bin step for a token that moves a lot, a narrow one for a steady pair; a fee near what its busiest outside pool charges (market_map shows it) competes for that flow.',
        `Then: lp/create-pool {baseToken: "${a.base}", quoteToken: "${a.quote}", binStep, baseFee, check: true} for Umbrae's plan.`,
      ].join('\n') });
    }
    if (tiers) {
      const tier = tiers.find((t) => t.binStep === a.binStep && t.baseFee === a.baseFee);
      if (!tier) return refuse(`${a.binStep}·${a.baseFee} is not a tier Umbrae's factory allows. It allows (baseFee in basis points): ${tierWords(tiers)}.`);
      if (tier.pool) return refuse(`${symbol(a.base)}-${symbol(a.quote)} already has a pool at ${a.binStep}·${a.baseFee}: ${tier.pool}. Add to it with lp/open${tiers.some((t) => !t.pool) ? `, or pick a free tier: ${tierWords(tiers.filter((t) => !t.pool))}` : '; every other tier is taken too'}.`);
    }
    return Object.freeze({ ok: true, a, book, tiers });
  } catch (err) {
    return refuse(`The pool could not be judged: ${err.shortMessage || err.message}`);
  }
};

/**
 * Judge an ask before it is filed for running: the intent's validate calls it,
 * so a mistake there is refused as INVALID and the member's fix of the same
 * file runs (intent-sweep.js refiledAfterInvalid). impure — see preflight.
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
export const preflightCreatePool = async (ask, opts = {}) => {
  const p = await preflight(ask, opts);
  return p.ok ? Object.freeze({ ok: true }) : p;
};

/**
 * Plan (check: true) or open a new pool on Umbrae. A check with no tier lists
 * the factory's tiers. Never throws. impure — reads Umbrae and Base; opening
 * signs, sends, and writes the book and audit.
 *
 * @param {string} neumaId
 * @param {{baseToken: string, quoteToken: string, binStep?: number, baseFee?: number, startPrice?: number,
 *   seedBase?: string, seedQuote?: string, confirmFirstPrice?: boolean, check?: boolean, why?: string}} ask
 * @param {{provider?: object, pollMs?: number}} [opts]
 */
export const runCreatePool = async (neumaId, ask, opts = {}) => {
  const p = await preflight(ask, opts);
  if (!p.ok) return p;
  if (p.tierList) return Object.freeze({ ok: true, checked: true, plan: p.tierList });
  const full = { ...p.a, book: p.book, check: ask?.check === true };
  try {
    if (full.check) return await createOnce(neumaId, full, opts);
    return await bookAct(neumaId, {
      act: 'create-pool', why: ask?.why,
      what: (r) => (r.ok
        ? `opened a NEW pool ${r.name} (${r.pool ?? 'address not read'}), bin step ${r.binStep} · ${r.baseFee} bps, at ${r.startPrice}; its seed of ${r.seed} stays in the pool for good`
        : 'tried to open a new pool'),
    }, () => createOnce(neumaId, full, opts).catch((err) => refuse(`Opening the pool stopped: ${err.shortMessage || err.message}`)), { provider: opts.provider });
  } catch (err) {
    return refuse(`Opening the pool stopped: ${err.shortMessage || err.message}`);
  }
};
