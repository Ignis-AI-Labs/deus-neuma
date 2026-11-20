// lp-figures.js — the numbers behind the LIQUIDITY pictures: what a position
// is worth, where the pool's price sits against a position's range, how full
// the budget is, and which pool an address names. Pure: the view record from
// GET /api/v1/neuma/:id/lp in, plain figures out.

import { buildPortfolio } from './wallet-portfolio.js';
import { positionAmounts, positionStrings } from '../../../core/wallet/lp-book-math.js';

// pure — a finite number or 0 (display only; the backend sizes the budget itself).
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/**
 * Every position, flattened, with its dollar value, fees and where the pool
 * stands against its range. Pure.
 * @param {Array<object>|null} pools - the view's `positions` (Umbrae's answer)
 * @returns {Array<{id: string, pool: string, name: string, usd: number, feesUsd: number,
 *   x: string, y: string, inRange: boolean|null, range: {from: number, to: number, at: number|null}}>}
 */
export const positionRows = (pools) => (Array.isArray(pools) ? pools : []).flatMap((pool) => {
  const px = num(pool?.poolInfo?.tokenXPriceUsd);
  const py = num(pool?.poolInfo?.tokenYPriceUsd);
  const active = pool?.positions?.activeBin?.binId;
  return (pool?.positions?.userPositions ?? []).map((p) => {
    const d = p.positionData ?? {};
    // Umbrae gives totals and fees in raw units with each token's decimals (positionStrings).
    const a = positionAmounts(pool, d);
    const s = positionStrings(pool, d);
    const lower = num(d.lowerBinId);
    const upper = num(d.upperBinId);
    const hasActive = Number.isInteger(active);
    // The window shows the range and the pool's bin together, with a margin.
    const lo = hasActive ? Math.min(lower, active) : lower;
    const hi = hasActive ? Math.max(upper, active) : upper;
    const pad = Math.max(1, Math.round((hi - lo) * 0.15));
    const span = (hi - lo) + 2 * pad || 1;
    const at = (bin) => ((bin - (lo - pad)) / span) * 100;
    return {
      id: String(p.publicKey),
      pool: pool.lbPairAddress,
      name: pool?.poolInfo?.name ?? '',
      usd: a.x * px + a.y * py,
      feesUsd: a.feeX * px + a.feeY * py,
      x: String(Number(Number(s.x).toPrecision(8))),
      y: String(Number(Number(s.y).toPrecision(8))),
      inRange: hasActive ? active >= lower && active <= upper : null,
      range: { from: at(lower), to: at(upper), at: hasActive ? at(active) : null },
    };
  });
});

/**
 * The budget picture: what is in positions, what waits, against the budget,
 * each as a share of the bar's full width. Pure.
 * @param {{budgetUsd: number|null, inPositionsUsd: number, waitingUsd: number}} figures
 * @returns {{scale: number, used: number, waiting: number, budgetAt: number|null, over: boolean}}
 */
export const budgetBar = ({ budgetUsd, inPositionsUsd, waitingUsd }) => {
  const budget = budgetUsd === null || budgetUsd === undefined ? null : num(budgetUsd);
  const scale = Math.max(budget ?? 0, inPositionsUsd + waitingUsd, 1);
  const pct = (v) => Math.min(100, (v / scale) * 100);
  return {
    scale,
    used: pct(inPositionsUsd),
    waiting: pct(waitingUsd),
    budgetAt: budget === null ? null : pct(budget),
    over: budget !== null && inPositionsUsd > budget,
  };
};

/**
 * The pool an address names, from the view's pool list or a pending action's verified symbols. Pure.
 * @param {Array<{address: string, name: string, tokens: Array<[string, string]>}>} pools
 * @param {string} address
 * @param {{tokenXSymbol?: string, tokenYSymbol?: string}} [action]
 * @returns {{name: string, symbolX: string, symbolY: string, known: boolean}}
 */
export const poolNamed = (pools, address, action) => {
  const pool = (pools ?? []).find((p) => same(p.address, address));
  return pool
    ? { name: pool.name, symbolX: pool.tokens?.[0]?.[1] ?? '', symbolY: pool.tokens?.[1]?.[1] ?? '', known: true }
    : { name: typeof address === 'string' ? address : '?', symbolX: action?.tokenXSymbol ?? '', symbolY: action?.tokenYSymbol ?? '', known: false };
};

/**
 * The wallet's idle tokens worth anything, with dollars where a price is known. Pure.
 * @param {Array<{symbol: string, amount: string, priceUsd?: number|null}>} tokens
 * @returns {Array<{symbol: string, amount: string, usd: number|null}>}
 */
export const heldTokens = (tokens) => (tokens ?? [])
  .filter((t) => num(t.amount) > 0)
  .map((t) => ({ symbol: t.symbol, amount: t.amount, usd: Number.isFinite(t.priceUsd) ? num(t.amount) * t.priceUsd : null }));

/**
 * What the wallet is worth and where: in positions, idle in the wallet, and
 * what waits on the operator. Pure.
 * @param {object} lp - the LP view
 * A figure that could not be read is null, never 0: positions unread (the
 * connection off, Umbrae not answering) or a held token with no price.
 * @returns {{inPositions: number|null, inWallet: number|null, total: number|null, waiting: number}}
 */
export const lpTotals = (lp) => {
  const inPositions = Array.isArray(lp?.positions) ? positionRows(lp.positions).reduce((s, r) => s + r.usd, 0) : null;
  const held = heldTokens(lp?.tokens);
  const inWallet = Array.isArray(lp?.tokens) && held.every((t) => t.usd !== null) ? held.reduce((s, t) => s + t.usd, 0) : null;
  const waiting = (lp?.pending ?? []).reduce((s, r) => s + num(r.depositUsd), 0);
  return { inPositions, inWallet, total: inPositions === null || inWallet === null ? null : inPositions + inWallet, waiting };
};

/**
 * The one line a waiting deposit stakes its ask on: what goes in, and why it
 * waits. A side of zero is left out; verified symbols print whenever present. Pure.
 * @param {{action: object, reason: string}} request
 * @param {{name: string, symbolX: string, symbolY: string, known?: boolean}} pool - from poolNamed
 * @param {number|null} budgetUsd
 * @returns {string}
 */
export const waitingLine = (request, pool, budgetUsd) => {
  const sides = [[request.action.amountX, pool.symbolX], [request.action.amountY, pool.symbolY]]
    .filter(([amount]) => num(amount) > 0)
    .map(([amount, symbol]) => (symbol ? `${amount} ${symbol}` : String(amount)));
  const why = /^No budget/.test(request.reason) ? 'no budget set'
    : /could not be sized/.test(request.reason) ? 'could not be sized in dollars'
      : budgetUsd === null ? 'past the budget' : `past the ${usd(budgetUsd)} budget`;
  return `${sides.join(' + ') || '0'} · ${why}`;
};

/** Dollars, to the cent; a figure that was not read shows as a dash. Pure. */
export const usd = (v) => (v === null || v === undefined ? '—' : `$${num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** A name as a person reads it in a sentence: "RUGEVIL" → "Rugevil". Pure. */
export const nameCase = (name) => String(name ?? '').toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

/** A signed dollar figure: "+$1.20", "−$0.40"; "—" when unknown. Pure. */
export const signedUsd = (v) => {
  if (!Number.isFinite(Number(v))) return '—';
  const n = Math.round(Number(v) * 100) / 100;
  return `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`;
};

/**
 * What the member earned since an earlier day, from the book's day points;
 * null when the book has no point that old. Pure.
 * @param {Record<string, {earnedUsd: number}>} days
 * @param {number} earnedNow
 * @param {number} back - days back
 * @param {Date} [now]
 */
export const earnedBack = (days, earnedNow, back, now = new Date()) => {
  const want = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
  const key = `${want.getFullYear()}-${String(want.getMonth() + 1).padStart(2, '0')}-${String(want.getDate()).padStart(2, '0')}`;
  const at = Object.keys(days ?? {}).filter((d) => d <= key).sort().pop();
  return at ? Number(earnedNow) - Number(days[at].earnedUsd) : null;
};

/**
 * The member's goals with its progress toward each, open ones first. Pure.
 * @param {Array<object>} goals - from GET /lp
 * @param {number} freeUsd - the book's free-to-spend figure
 */
export const goalRows = (goals, freeUsd) => {
  const free = Math.max(0, num(freeUsd));
  const order = { requested: 0, paying: 0, working: 1, paid: 2, delivered: 3 };
  return (Array.isArray(goals) ? goals : [])
    .filter((g) => g.status !== 'dropped')
    .map((g) => ({ ...g, pct: Math.min(100, Math.floor((free / Math.max(num(g.costUsd), 0.01)) * 100)) }))
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
};

/**
 * The LP wallet's holdings as the wallet screen's portfolio (the same rows and
 * total every wallet shows): ETH first, at the desk's market price and 24h
 * change when given (else Umbrae's), then EVERY token it holds, largest first,
 * at Umbrae's price. A token with no price shows its amount, never $0. Pure.
 * @param {object|null} lp - the LP view (GET /api/v1/neuma/:id/lp)
 * @param {{usd: number, change24h: number|null}|null} eth - the desk's ETH price
 */
export const lpPortfolioOf = (lp, eth) => {
  if (!lp?.address) return null;
  const ethPrice = eth && Number.isFinite(Number(eth.usd)) ? eth
    : Number.isFinite(lp.ethPriceUsd) ? { usd: lp.ethPriceUsd, change24h: null } : null;
  const tokens = (lp.tokens ?? []).filter((t) => num(t.amount) > 0)
    .map((t) => ({ symbol: t.symbol, balance: t.amount, price: Number.isFinite(t.priceUsd) ? { usd: t.priceUsd, change24h: null } : null }))
    .sort((a, b) => num(b.balance) * (b.price?.usd ?? 0) - num(a.balance) * (a.price?.usd ?? 0));
  return buildPortfolio([...(lp.balanceEth != null ? [{ symbol: 'ETH', balance: lp.balanceEth, price: ethPrice }] : []), ...tokens, ...positionTokens(lp)]);
};

// pure — what sits in its positions, by token (fees waiting included), so the
// wallet's total is everything it holds: […].
const positionTokens = (lp) => {
  const held = new Map();
  for (const pool of Array.isArray(lp?.positions) ? lp.positions : []) {
    const named = poolNamed(lp.pools, pool?.lbPairAddress);
    const [nameX, nameY] = String(pool?.poolInfo?.name ?? '').split('-');
    const symX = pool?.poolInfo?.tokenX?.symbol || named.symbolX || nameX;
    const symY = pool?.poolInfo?.tokenY?.symbol || named.symbolY || nameY;
    for (const p of pool?.positions?.userPositions ?? []) {
      const a = positionAmounts(pool, p.positionData);
      for (const [symbol, amount, price] of [[symX, a.x + a.feeX, pool?.poolInfo?.tokenXPriceUsd], [symY, a.y + a.feeY, pool?.poolInfo?.tokenYPriceUsd]]) {
        if (!symbol) continue;
        const was = held.get(symbol) ?? { amount: 0, price: Number.isFinite(Number(price)) && Number(price) > 0 ? Number(price) : null };
        held.set(symbol, { ...was, amount: was.amount + amount });
      }
    }
  }
  return [...held].filter(([, h]) => h.amount > 0)
    .map(([symbol, h]) => ({ symbol: `${symbol} · IN POSITIONS`, balance: h.amount, price: h.price === null ? null : { usd: h.price, change24h: null } }));
};
