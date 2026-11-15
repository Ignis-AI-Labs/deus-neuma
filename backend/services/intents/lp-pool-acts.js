/**
 * lp/create-pool — a house member opens a NEW pool on Umbrae from its LP wallet
 * (Design note, 2026-11-13/14: members find […]).
 * See umbrae-lp/lp-pool.js. Runs on its own, like every lp/* act; the signing
 * rule is the gate (core/wallet/pool-policy.js). check: true plans it and
 * signs nothing. Offered exactly where the other lp/* acts are.
 */
import { seatOf } from '../flight-check.js';
import { lpWalletAddress } from '../umbrae-lp/lp-wallet.js';
import { runCreatePool, preflightCreatePool } from '../umbrae-lp/lp-pool.js';
import { lpOffered, walletWords } from './lp-acts.js';

const text = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

export const lpCreatePoolIntent = Object.freeze({
  name: 'lp/create-pool',
  policyTool: 'lp.create-pool',
  fieldsForPrompt: '{baseToken, quoteToken, binStep?, baseFee?, startPrice?, seedBase?, seedQuote?, confirmFirstPrice?, check?, why?}',
  descriptionForPrompt: 'Open a NEW pool on Umbrae: a pair it does not have yet, or a fee tier the pair lacks, so you are its first liquidity and earn the fees its trades pay. baseToken is the token the pool is for (address, or symbol if Umbrae trades it); a token Umbrae does not trade yet needs an established market elsewhere on Base. quoteToken is a token Umbrae\'s pools trade (WETH, USDC). binStep and baseFee pick the fee tier (baseFee in basis points: 50 = 0.5%); with check: true and neither, it lists every tier the factory allows and which this pair already has. File it with check: true first: it signs nothing and shows Umbrae\'s plan (the tiers the factory allows and which exist, the market price, the start price, the seed, anything that stops it). The seed defaults to $10 of the quote token alone (you need not hold the new token); it is at most $20 and stays in the pool for good. Then put your liquidity in with lp/open on the new pool\'s address.',
  availableFor: lpOffered,
  validate: async (payload, { connection }) => {
    if (seatOf(connection) === 'witness') return { ok: false, status: 'denied', reason: 'Witness seats hold no LP wallet on this platform.' };
    if (!(await lpWalletAddress(connection.companion?.neumaId).catch(() => null))) {
      return { ok: false, status: 'denied', reason: 'You have no LP wallet yet. Your operator opens one for you.' };
    }
    const value = {
      baseToken: text(payload?.baseToken), quoteToken: text(payload?.quoteToken),
      ...(payload?.binStep !== undefined ? { binStep: Number(payload.binStep) } : {}),
      ...(payload?.baseFee !== undefined ? { baseFee: Number(payload.baseFee) } : {}),
      ...(payload?.startPrice !== undefined ? { startPrice: Number(payload.startPrice) } : {}),
      ...(payload?.seedBase !== undefined ? { seedBase: text(payload.seedBase) } : {}),
      ...(payload?.seedQuote !== undefined ? { seedQuote: text(payload.seedQuote) } : {}),
      confirmFirstPrice: payload?.confirmFirstPrice === true, check: payload?.check === true,
      ...(typeof payload?.why === 'string' && payload.why.trim() ? { why: payload.why.trim().slice(0, 400) } : {}),
    };
    if (!value.baseToken || !value.quoteToken) return { ok: false, status: 'invalid', reason: 'lp/create-pool needs {baseToken, quoteToken}; with check: true and no tier it lists the fee tiers' };
    // Judged here, not at run time: refused as invalid, a fix to the same file is read again.
    const judged = await preflightCreatePool(value);
    if (!judged.ok) return { ok: false, status: 'invalid', reason: `lp/create-pool: ${judged.reason}` };
    return { ok: true, value };
  },
  summarize: (p) => `${p?.check ? 'plan' : 'open'} a new pool ${p?.baseToken ?? '?'}-${p?.quoteToken ?? '?'} at ${p?.binStep ?? '?'}·${p?.baseFee ?? '?'}`,
  // impure — the plan, or the whole opening: approve the seed, createPair, confirm.
  execute: async (value, { connection }) => {
    const out = await runCreatePool(connection.companion?.neumaId, value);
    if (out.ok && out.checked) return { ok: true, detail: out.plan };
    if (out.ok) {
      return { ok: true, detail: `Opened ${out.name} at ${out.pool ?? '(address not read: look it up on the factory)'}, bin step ${out.binStep} · ${out.baseFee} bps, at ${out.startPrice}. Seed: ${out.seed}, in the pool for good. Transactions: ${out.txHashes.join(', ')}.${walletWords(out)} Now add your liquidity: lp/open {pool: "${out.pool}", ...}.` };
    }
    return { ok: false, reason: `lp/create-pool did not complete: ${out.reason}${out.plan ? `\n${out.plan}` : ''}${out.txHashes?.length ? ` Already on Base: ${out.txHashes.join(', ')}.` : ''}` };
  },
});
