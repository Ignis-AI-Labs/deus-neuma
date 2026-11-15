// lp-book.js — a house member's earnings book (Design note, 2026-11-13: members earn
// rewards […]). The arithmetic is
// core/wallet/lp-book-math.js; this file keeps the record and feeds it.
//
//   · bookAct wraps every act the LP wallet signs (positions, swaps, sends,
//     reward payouts): it reads the holdings before, takes anything that
//     arrived from outside since the last look as FUNDED, runs the act, reads
//     the holdings after, and writes one line of what the act did to the
//     wallet's value. That line also goes into the member's own journal, so
//     what worked and what did not stays in its memory.
//   · bookTick (the watch, lp-watch.js) takes arrivals between acts, keeps one
//     point per day, and notices a position leaving its range.
//
// The record is the platform's, encrypted in the member's config folder; a
// plain-text file there is refused on read, so a member cannot write its own
// earnings. Acts on one wallet run one at a time (the book reads before and
// after each), and a tick never waits behind an act.

import path from 'node:path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import {
  walletUsd, positionsUsd, changeUsd, heldAfter, bookFigures, signedUsd, earnedSince, trimDays, JOURNAL_KEPT,
} from '../../../core/wallet/lp-book-math.js';
import { createLogger } from '../logger.js';
import { readHoldings } from './lp-holdings.js';
import { lpWalletAddress } from './lp-wallet.js';
import { lpBase } from './lp-base.js';

const log = createLogger('LpBook');
const bookFile = (neumaId) => path.join(neumaWorkspace._path(neumaId), 'config', 'lp-book.json');
const ARRIVALS_KEPT = 50;
const EMPTY = Object.freeze({ version: 1, openedAt: null, held: null, stale: false, fundedUsd: 0, returnedUsd: 0, rewardsUsd: 0, days: {}, journal: [], pools: {}, ranges: {} });

/** A local day key, YYYY-MM-DD. Pure. */
export const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The member's book; an empty one before its first look. impure — reads config.
 * @param {string} neumaId
 */
export const readBook = async (neumaId) => {
  try {
    return { ...EMPTY, ...(await neumaWorkspace._readTrustedJSON(bookFile(neumaId))) };
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'UNTRUSTED_PLAINTEXT') return { ...EMPTY, days: {}, journal: [], pools: {}, ranges: {} };
    throw err;
  }
};

const writeBook = (neumaId, book) => neumaWorkspace._writeJSON(bookFile(neumaId), {
  ...book, days: trimDays(book.days), journal: (book.journal ?? []).slice(-JOURNAL_KEPT), arrivals: (book.arrivals ?? []).slice(-ARRIVALS_KEPT),
});

// One act at a time per wallet; `busy` lets a tick pass by rather than wait.
const chains = new Map();
const busy = new Set();
const serialized = (neumaId, fn) => {
  const run = async () => {
    busy.add(neumaId);
    try {
      return await fn();
    } finally {
      busy.delete(neumaId);
    }
  };
  const next = (chains.get(neumaId) ?? Promise.resolve()).then(run, run);
  chains.set(neumaId, next.catch(() => {}));
  return next;
};

// pure — […] from moved amounts.
const movedWords = (moved) => moved.map((m) => `${Number(m.amount.toPrecision(6))} ${m.symbol}`).join(', ');

/**
 * How the book prices. 2 (2026-11-13): each token at its DEEPEST Umbrae pool
 * (lp-holdings.js poolTokens); 1 took whichever pool came last, and a thin
 * WETH-USDC pool priced WETH ~9% over the market.
 */
const PRICING = 2;

// pure — a book priced the old way, brought to PRICING once. With nothing done
// yet (only money that arrived), what it was given is re-counted at the right
// prices, so its earned stays 0 rather than showing the price fix as a loss.
// With acts behind it, the figures stand and a line says why they may shift.
const reprice = (book, holdings, nowMs) => {
  if ((book.pricing ?? 1) >= PRICING) return book;
  const at = new Date(nowMs).toISOString();
  const acted = (book.journal ?? []).some((j) => j.act !== 'arrived' && j.act !== 'repriced');
  if (acted) {
    // Each arrival kept its token amounts: re-count them at the right prices, so what it was given is honest.
    const prices = new Map(holdings.map((h) => [h.symbol, h.priceUsd]));
    const arrivals = book.arrivals ?? [];
    const countable = arrivals.length > 0 && arrivals.every((a) => (a.moved ?? []).every((m) => Number.isFinite(prices.get(m.symbol))));
    if (!countable) {
      return { ...book, pricing: PRICING, journal: [...(book.journal ?? []), { at, act: 'repriced', what: 'prices now come from each token\'s deepest Umbrae pool (a thinner pool priced WETH about 9% high before); figures from here may shift by that', deltaUsd: 0 }] };
    }
    const recounted = arrivals.map((a) => ({ ...a, usd: a.moved.reduce((s, m) => s + m.amount * prices.get(m.symbol), 0) }));
    const was = arrivals.reduce((s, a) => s + (a.usd ?? 0), 0);
    const now = recounted.reduce((s, a) => s + a.usd, 0);
    return {
      ...book, pricing: PRICING, arrivals: recounted, fundedUsd: (book.fundedUsd ?? 0) - was + now,
      journal: [...(book.journal ?? []), { at, act: 'repriced', what: `prices now come from each token's deepest Umbrae pool; what you were given is re-counted at them: $${now.toFixed(2)} (was $${was.toFixed(2)})`, deltaUsd: 0 }],
    };
  }
  const value = walletUsd(holdings).usd;
  return {
    ...book, pricing: PRICING, repriced: true, held: heldAfter(book.held, holdings), fundedUsd: value,
    journal: [...(book.journal ?? []), { at, act: 'repriced', what: `prices now come from each token's deepest Umbrae pool; what you were given is re-counted at them: $${value.toFixed(2)}`, deltaUsd: 0 }],
  };
};

/**
 * Take what arrived from outside since the book last looked. Pure.
 * The first look takes everything already held as funded. A book marked stale
 * (an act whose after-read failed) looks again without counting anything. A
 * holding with no price is left for a look that has one: an arrival is never
 * booked at $0 (it would then count as earned once priced).
 * @returns {{book: object, arrived: null | {usd: number, moved: Array<object>}}}
 */
const settle = (prior, read, nowMs) => {
  const holdings = (read ?? []).filter((h) => Number.isFinite(h.priceUsd));
  if (!holdings.length) return { book: prior, arrived: null };
  const book = prior.held === null ? { ...prior, pricing: PRICING } : reprice(prior, holdings, nowMs);
  if (book.repriced) return { book: { ...book, repriced: undefined }, arrived: null };
  if (book.stale) return { book: { ...book, held: heldAfter(book.held, holdings), stale: false }, arrived: null };
  const change = changeUsd(book.held ?? {}, holdings);
  const next = { ...book, openedAt: book.openedAt ?? new Date(nowMs).toISOString(), held: heldAfter(book.held, holdings), fundedUsd: (book.fundedUsd ?? 0) + change.usd };
  if (!change.moved.length) return { book: next, arrived: null };
  const at = new Date(nowMs).toISOString();
  return {
    book: {
      ...next,
      arrivals: [...(book.arrivals ?? []), { at, usd: change.usd, moved: change.moved }],
      journal: [...(book.journal ?? []), { at, act: 'arrived', what: `${change.usd >= 0 ? 'arrived from outside' : 'left without an act of yours'}: ${movedWords(change.moved)}`, deltaUsd: change.usd }],
    },
    arrived: change,
  };
};

// pure — the act's change, priced at the prices read before it.
const actChange = (before, after) => {
  const priced = new Map(before.map((h) => [h.key, h.priceUsd]));
  return changeUsd(Object.fromEntries(before.map((h) => [h.key, h.raw])), after.map((h) => ({ ...h, priceUsd: priced.get(h.key) ?? h.priceUsd })));
};

// pure — what an act adds to the book besides its journal line.
const actTotals = (book, meta, change, before) => {
  const next = { ...book, pools: { ...(book.pools ?? {}) } };
  const paid = meta.paid ? (Number(meta.paid.amount) || 0) * (before.find((h) => h.key === meta.paid.key)?.priceUsd ?? 0) : 0;
  if (meta.act === 'send') next.returnedUsd = (book.returnedUsd ?? 0) + paid;
  if (meta.act === 'reward') next.rewardsUsd = (book.rewardsUsd ?? 0) + paid;
  if (meta.pool) {
    const was = next.pools[meta.pool] ?? { name: meta.poolName ?? null, inUsd: 0, outUsd: 0 };
    next.pools[meta.pool] = ['open', 'add'].includes(meta.act)
      ? { ...was, inUsd: was.inUsd - change.usd, open: true }
      : { ...was, outUsd: was.outUsd + change.usd, open: meta.act !== 'close' };
  }
  return { next, paid };
};

// pure — the journal line for one act: what it did to the wallet, in its own terms.
const actLine = (meta, change, paid, pool) => {
  const net = meta.act === 'send' || meta.act === 'reward' ? change.usd + paid : change.usd;
  const result = pool && meta.act === 'close'
    ? ` Pool result: in $${pool.inUsd.toFixed(2)}, out $${pool.outUsd.toFixed(2)}, ${signedUsd(pool.outUsd - pool.inUsd)}${pool.inUsd > 0 ? ` (${(((pool.outUsd - pool.inUsd) / pool.inUsd) * 100).toFixed(1)}%)` : ''}.`
    : '';
  return `${meta.what}${change.moved.length ? ` — wallet moved ${movedWords(change.moved)}` : ''}; ${meta.act === 'send' || meta.act === 'reward' ? `cost beyond the amount ${signedUsd(net)}` : `wallet value ${signedUsd(net)}`}.${result}`;
};

// impure — what the act's transactions burned in gas, from their receipts (raw reads); null when unread.
const gasOf = async (provider, hashes) => {
  const base = provider ?? await lpBase().catch(() => null);
  if (!base || !hashes.length) return null;
  let units = 0n;
  let wei = 0n;
  for (const hash of hashes) {
    const receipt = await base.send('eth_getTransactionReceipt', [hash]).catch(() => null);
    if (!receipt) return null;
    units += BigInt(receipt.gasUsed);
    wei += BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice ?? 0);
  }
  return { units: Number(units), eth: Number(wei) / 1e18 };
};

/** The gas units the member's last swap burned, from its book; null before its first. Pure. */
export const lastSwapGas = (book) => [...(book?.journal ?? [])].reverse().find((j) => j.act === 'swap' && Number.isFinite(j.gasUnits))?.gasUnits ?? null;

/**
 * Run one act of the LP wallet through the book. Never throws on the book's
 * account: a book that cannot be read or written leaves the act's own result
 * as it was. impure — reads Base and Umbrae, writes config and the journal.
 *
 * @param {string} neumaId
 * @param {{act: string, what: string|Function, why?: string, pool?: string, poolName?: string, paid?: {key: string, amount: string}|Function}} meta
 *   what and paid may be functions of the act's result (read once it ran)
 *   paid: for a send or a reward, the token (address or 'ETH') and whole amount paid out
 * @param {() => Promise<object>} run - the act; its result has ok, txHash or txHashes
 * @param {{provider?: object}} [opts]
 */
export const bookAct = (neumaId, meta, run, { provider } = {}) => serialized(neumaId, async () => {
  const address = await lpWalletAddress(neumaId).catch(() => null);
  const before = address ? await readHoldings(address, { provider }).catch(() => null) : null;
  let book = before ? await readBook(neumaId).catch(() => null) : null;
  if (book) book = settle(book, before, Date.now()).book;
  const result = await run();
  if (!book) return result;
  try {
    const onChain = result?.ok || result?.txHash || result?.txHashes?.length;
    if (!onChain) {
      await writeBook(neumaId, book);
      return result;
    }
    const after = await readHoldings(address, { provider }).catch(() => null);
    if (!after) {
      await writeBook(neumaId, { ...book, stale: true });
      return result;
    }
    const change = actChange(before, after);
    const m = Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, typeof v === 'function' ? v(result) : v]));
    const { next, paid } = actTotals(book, { ...m, poolName: m.poolName ?? result.poolName ?? null }, change, before);
    const what = result?.ok ? m.what : `${m.what} — FAILED on Base (${result.reason ?? 'reverted'})`;
    const hashes = result.txHashes ?? (result.txHash ? [result.txHash] : []);
    // Gas is told apart, so a member sees what the chain charged beside what the trade made.
    const gas = await gasOf(provider, hashes);
    const gasUsd = gas ? gas.eth * (before.find((h) => h.key === 'ETH')?.priceUsd ?? 0) : null;
    const line = `${actLine({ ...m, what }, change, paid, m.pool ? next.pools[m.pool] : null)}${gas ? ` Gas: ${(gas.units / 1e6).toFixed(2)}M units, $${gasUsd.toFixed(2)}.` : ''}`;
    const at = new Date().toISOString();
    next.held = heldAfter(book.held, after);
    next.journal = [...(book.journal ?? []), { at, act: meta.act, what: line, why: meta.why ? String(meta.why).slice(0, 300) : null, deltaUsd: change.usd + paid, txHashes: hashes, ...(gas ? { gasUnits: gas.units, gasUsd: Math.round(gasUsd * 10000) / 10000 } : {}) }];
    await writeBook(neumaId, next);
    await neumaWorkspace.addJournalEntry(neumaId, {
      type: 'lp-trade', act: meta.act, deltaUsd: Math.round((change.usd + paid) * 100) / 100,
      content: `My LP wallet: ${line}${meta.why ? ` Why I did it: ${String(meta.why).slice(0, 300)}` : ''}`,
    }).catch((err) => log.warn('LP act not written to the journal', { neumaId, error: err.message }));
    return Object.freeze({ ...result, walletChangeUsd: Math.round(change.usd * 100) / 100 });
  } catch (err) {
    log.warn('LP book not written', { neumaId, error: err.message });
    return result;
  }
});

/**
 * The book's figures from what was just read. Pure.
 * @param {object} book
 * @param {Array<object>|null} holdings
 * @param {Array<object>|null} positions - Umbrae's positions answer
 */
const figuresOf = (book, holdings, positions) => {
  const wallet = walletUsd(holdings ?? []);
  const inPositions = positionsUsd(positions);
  return { ...bookFigures(book, wallet.usd + inPositions), walletUsd: Math.round(wallet.usd * 100) / 100, positionsUsd: Math.round(inPositions * 100) / 100, unpriced: wallet.unpriced };
};

// pure — positions out of their range now that were in range at the last look (or never looked at).
const rangeExits = (ranges, positions) => {
  const now = {};
  const exits = [];
  for (const pool of Array.isArray(positions) ? positions : []) {
    const active = pool?.positions?.activeBin?.binId;
    if (!Number.isInteger(active)) continue;
    for (const p of pool?.positions?.userPositions ?? []) {
      const d = p.positionData ?? {};
      const inRange = active >= Number(d.lowerBinId) && active <= Number(d.upperBinId);
      const id = String(p.publicKey);
      now[id] = inRange;
      if (!inRange && ranges?.[id] !== false) exits.push({ id, pool: pool.lbPairAddress, name: pool.poolInfo?.name ?? null, bins: `${d.lowerBinId}..${d.upperBinId}`, active });
    }
  }
  return { now, exits };
};

/**
 * One look between acts: takes what arrived, keeps today's point (when the
 * positions were read), and returns the book as it now stands. The watch
 * (watch: true) also takes positions leaving their range and the arrivals no
 * wake has told of yet, and marks both as told. While an act runs on this
 * wallet the look passes by and returns the book unsettled.
 * impure — reads and writes config.
 *
 * @param {string} neumaId
 * @param {{holdings: Array<object>|null, positions: Array<object>|null, nowMs?: number, watch?: boolean}} read
 * @returns {Promise<{book: object, figures: object, arrivals: Array<object>, exits: Array<object>}>}
 */
export const bookTick = async (neumaId, { holdings, positions, nowMs = Date.now(), watch = false }) => {
  const look = async (write) => {
    const book = holdings ? settle(await readBook(neumaId), holdings, nowMs).book : await readBook(neumaId);
    const figures = figuresOf(book, holdings, positions);
    if (!write) return { book, figures, arrivals: [], exits: [] };
    const ranges = watch && positions ? rangeExits(book.ranges, positions) : { now: book.ranges, exits: [] };
    const arrivals = watch ? (book.arrivals ?? []).filter((a) => !a.told) : [];
    const next = {
      ...book, ranges: ranges.now,
      arrivals: watch ? (book.arrivals ?? []).map((a) => ({ ...a, told: true })) : book.arrivals,
      days: positions ? { ...book.days, [dayOf(nowMs)]: { valueUsd: figures.valueUsd, earnedUsd: figures.earnedUsd } } : book.days,
    };
    await writeBook(neumaId, next);
    return { book: next, figures, arrivals, exits: ranges.exits };
  };
  if (busy.has(neumaId) || !holdings) return look(false);
  return serialized(neumaId, () => look(true));
};

/**
 * The book as lines the member reads (wallet_view, lp_book, a wake). Pure.
 * @param {object} book
 * @param {object} figures - figuresOf
 * @param {{nowMs?: number, last?: number}} [opts] - last: how many journal lines
 * @returns {string[]}
 */
export const bookLines = (book, figures, { nowMs = Date.now(), last = 8 } = {}) => {
  const today = dayOf(nowMs);
  const day = earnedSince(book.days, today, figures.earnedUsd, 1);
  const week = earnedSince(book.days, today, figures.earnedUsd, 7);
  const pools = Object.entries(book.pools ?? {});
  const journal = (book.journal ?? []).slice(-last).reverse();
  return [
    'YOUR BOOK (what your LP wallet has made; a reward draws on "free to spend"):',
    `  Value now $${figures.valueUsd.toFixed(2)} (wallet $${figures.walletUsd.toFixed(2)} + positions $${figures.positionsUsd.toFixed(2)})${figures.unpriced?.length ? `; no price for ${figures.unpriced.join(', ')}` : ''}`,
    `  Given to you $${figures.fundedUsd.toFixed(2)} · sent on to the house $${figures.returnedUsd.toFixed(2)} · rewards paid $${figures.rewardsUsd.toFixed(2)}`,
    `  EARNED ${signedUsd(figures.earnedUsd)}${day === null ? '' : ` · since yesterday ${signedUsd(day)}`}${week === null ? '' : ` · 7 days ${signedUsd(week)}`} · free to spend on rewards $${figures.freeUsd.toFixed(2)}`,
    ...(pools.length ? ['  By pool (dollars in and out of positions, gas included):', ...pools.map(([address, p]) => `    ${p.name ?? address}: in $${p.inUsd.toFixed(2)}, out $${p.outUsd.toFixed(2)}${p.open ? ' (still open: its value counts above)' : `, ${signedUsd(p.outUsd - p.inUsd)}`}`)] : []),
    ...(journal.length ? ['  Your last acts, newest first:', ...journal.map((j) => `    ${j.at.slice(5, 16).replace('T', ' ')} ${j.what}${j.why ? ` (why: ${j.why})` : ''}`)] : ['  No acts yet.']),
  ];
};
