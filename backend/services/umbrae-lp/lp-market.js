// lp-market.js — market sight for a house member that trades (Design note, 2026-11-13:
// […]). Three reads, all public, none signs:
//
//   · every Umbrae pool at a glance: price, TVL, 24h volume, fee, APR;
//   · one pool close up: price, active bin, 24h volume and fees, reserves, and
//     the liquidity in each bin around the price (where depth is, where it is not);
//   · a swap quote from the router itself: route, amount out, price impact.
//
// The text is dense on purpose: it is read by a model deciding a trade.

import { ethers } from 'ethers';
import { callUmbrae } from './umbrae-lp-client.js';
import { quoteSwap } from './lp-trade.js';
import { lpBase } from './lp-base.js';
import { poolTokens } from './lp-holdings.js';
import { readBook, lastSwapGas } from './lp-book.js';

const num = (v, digits = 2) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: digits }) : '?');
const usd = (v) => (Number.isFinite(Number(v)) ? `$${num(v, 2)}` : '?');

// pure — one line per pool from Umbrae's pool list.
const poolLines = (payload) => (payload?.groups ?? []).flatMap((g) => (g.pairs ?? []).map((p) => (
  `${g.name} ${p.address} · price ${num(p.current_price, 8)} ${g.tokenY} per ${g.tokenX} · TVL ${usd(p.liquidity)} · 24h volume ${usd(p.trade_volume_24h)} · fee ${p.base_fee_percentage}% · bin step ${p.bin_step} · APR ${p.aprPct === null || p.aprPct === undefined ? 'none yet' : `${num(p.aprPct, 2)}%`}`
)));

/**
 * Where one pair trades at different prices in different pools: the spread a
 * scalper works. One record per pair with two priced pools or more. Pure.
 * @param {object} payload - Umbrae's /pools answer
 * @returns {Array<{pair: string, pct: number, low: {address: string, price: number, tvl: number}, high: {address: string, price: number, tvl: number}}>}
 */
export const pairSpreads = (payload) => (payload?.groups ?? []).flatMap((g) => {
  const priced = (g.pairs ?? []).map((p) => ({ address: p.address, price: Number(p.current_price), tvl: Number(p.liquidity) }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0);
  if (priced.length < 2) return [];
  const low = priced.reduce((a, b) => (b.price < a.price ? b : a));
  const high = priced.reduce((a, b) => (b.price > a.price ? b : a));
  return [{ pair: g.name, pct: ((high.price - low.price) / low.price) * 100, low, high }];
});

// pure — the spreads worth a line (0.1 % and more).
const spreadLines = (payload) => pairSpreads(payload).filter((s) => s.pct >= 0.1).map(({ pair, pct, low, high }) => (
  `${pair}: ${num(low.price, 6)} in ${low.address} (TVL ${usd(low.tvl)}) vs ${num(high.price, 6)} in ${high.address} (TVL ${usd(high.tvl)}) · spread ${pct.toFixed(2)}% before fees and depth`
));

// pure — the depth around the price, one compact line per bin with liquidity.
const binLines = (bins, x = 'X', y = 'Y') => {
  const rows = (bins?.bins ?? []).filter((b) => Number(b.xAmount) > 0 || Number(b.yAmount) > 0);
  const dx = 10 ** -(Number(bins?.tokenXDecimals) || 0);
  const dy = 10 ** -(Number(bins?.tokenYDecimals) || 0);
  return rows.map((b) => {
    const mark = b.binId === bins.activeBin ? ' ← price now' : '';
    return `  bin ${b.binId} @ ${num(b.pricePerToken, 8)}: ${num(Number(b.xAmount) * dx, 6)} ${x} + ${num(Number(b.yAmount) * dy, 6)} ${y}${mark}`;
  });
};

/**
 * Every Umbrae pool, at a glance. Never throws. impure — reads Umbrae.
 * @returns {Promise<string>}
 */
export const marketOverview = async () => {
  const out = await callUmbrae('pools');
  if (!out.ok) return `Umbrae's pool list did not answer: ${out.error}`;
  const lines = poolLines(out.payload);
  const spreads = spreadLines(out.payload);
  return [`UMBRAE POOLS on Base (${lines.length}):`, ...lines.map((l) => `- ${l}`),
    ...(spreads.length ? ['PRICE SPREADS between pools of one pair (quote both legs before trading them):', ...spreads.map((l) => `- ${l}`)] : []),
    'Close up: lp_market {pool}. A quote: lp_market {tokenIn, tokenOut, amount}.'].join('\n');
};

/**
 * One pool close up, with its depth by bin. Never throws. impure — reads Umbrae.
 * @param {string} pool
 * @param {number} [bins] - bins each side of the price (default 20)
 * @returns {Promise<string>}
 */
export const marketPool = async (pool, bins = 20) => {
  if (!ethers.isAddress(String(pool ?? ''))) return 'Name the pool by its address.';
  const [detail, depth] = await Promise.all([
    callUmbrae('pool', { params: { address: pool } }),
    callUmbrae('bins', { params: { address: pool, bins } }),
  ]);
  if (!detail.ok) return `Umbrae did not answer for that pool: ${detail.error}`;
  const d = detail.payload;
  const x = d.tokenX?.symbol ?? 'X';
  const y = d.tokenY?.symbol ?? 'Y';
  return [
    `${d.name ?? `${x}-${y}`} ${d.address}`,
    `price ${num(d.currentPrice, 8)} ${y} per ${x} (${x} ${usd(d.tokenXPriceUsd)}, ${y} ${usd(d.tokenYPriceUsd)}) · active bin ${d.activeBinId} · bin step ${d.binStep} · fee ${d.baseFeePercentage}%`,
    `TVL ${usd(d.tvl)} · 24h volume ${usd(d.volume24h)} · 24h fees ${usd(d.fees24h)} · APY ${d.apy === null || d.apy === undefined ? '?' : `${num(d.apy, 2)}%`}`,
    `reserves: ${num(Number(d.reserveX) / 10 ** (d.tokenX?.decimals ?? 0), 6)} ${x} + ${num(Number(d.reserveY) / 10 ** (d.tokenY?.decimals ?? 0), 6)} ${y}`,
    ...(depth.ok
      ? [`LIQUIDITY BY BIN (${bins} each side; empty bins left out):`, ...binLines(depth.payload, x, y)]
      : [`depth not read: ${depth.error}`]),
  ].join('\n');
};

const WETH = '0x4200000000000000000000000000000000000006';

// impure — gas now in dollars per million units, and each token's dollar price by symbol; null parts when unread.
const gasNow = async () => {
  const [base, pools] = await Promise.all([lpBase().catch(() => null), callUmbrae('pools')]);
  const tokens = poolTokens(pools.ok ? pools.payload : null);
  const prices = new Map([...tokens.values()].map((t) => [t.symbol, t.priceUsd]));
  const ethUsd = tokens.get(WETH)?.priceUsd ?? null;
  const wei = base ? await base.send('eth_gasPrice', []).then(BigInt, () => null) : null;
  return { gwei: wei === null ? null : Number(wei) / 1e9, perMillionUsd: wei === null || !ethUsd ? null : (Number(wei) / 1e12) * ethUsd, prices };
};

// pure — the gas line of a quote: today's price, and what the member's own last swap would cost at it.
const gasLine = (gas, units) => {
  if (gas.perMillionUsd === null) return 'Gas: not read.';
  const own = units
    ? ` Your last swap took ${(units / 1e6).toFixed(2)}M units: about $${((units / 1e6) * gas.perMillionUsd).toFixed(4)} at this price.`
    : ' Until you have swapped, the units are unknown; a swap that crosses many bins takes more.';
  return `Gas now ${gas.gwei} gwei = $${gas.perMillionUsd.toFixed(4)} per million units.${own}`;
};

// pure — each road's answer for one quote, the better one marked (Umbrae's router; KyberSwap's aggregator).
const roadLines = (q) => {
  const umbrae = q.amountOut === null ? null : Number(q.amountOut);
  const kyber = q.kyberswap?.amountOut ? Number(q.kyberswap.amountOut) : null;
  const best = Math.max(umbrae ?? -Infinity, kyber ?? -Infinity);
  const mark = (v) => (v === best && umbrae !== null && kyber !== null ? ' ← better' : '');
  const pct = umbrae !== null && kyber !== null && umbrae > 0 ? ` (KyberSwap ${kyber >= umbrae ? '+' : ''}${(((kyber - umbrae) / umbrae) * 100).toFixed(2)}% vs Umbrae)` : '';
  return [
    umbrae === null ? "  Umbrae's router: no route takes this amount whole" : `  Umbrae's router: ${q.amountOut} ${q.symbolOut} via ${q.route.join(' → ')} · price impact ${(Number(q.priceImpact) / 100).toFixed(2)}% (fees included)${mark(umbrae)}`,
    kyber === null ? `  KyberSwap: ${q.kyberswap?.error ?? 'not asked'}` : `  KyberSwap: ${q.kyberswap.amountOut} ${q.symbolOut} via ${q.kyberswap.exchanges.join(', ') || 'its route'}${mark(kyber)}${pct}`,
  ];
};

/**
 * A swap quote from Umbrae's router, signing nothing, with what gas costs
 * now and, for a round trip, the net after gas sized by the member's own last
 * swap. Never throws. impure.
 * @param {{tokenIn: string, tokenOut: string, amount: string}} ask
 * @param {{neumaId?: string}} [who] - the member asking (its book gives its last swap's gas)
 * @returns {Promise<string>}
 */
export const marketQuote = async (ask, { neumaId } = {}) => {
  const [q, gas, book] = await Promise.all([
    quoteSwap(ask),
    gasNow().catch(() => ({ perMillionUsd: null, prices: new Map() })),
    neumaId ? readBook(neumaId).catch(() => null) : null,
  ]);
  if (!q.ok) return `No quote: ${q.reason}`;
  const units = lastSwapGas(book);
  const gasWords = gasLine(gas, units);
  // The router states price impact in basis points (1 USDC → 37, 100 USDC → 1462 on WETH-USDC, read 2026-11-13).
  if (q.route && q.route[0] === q.route[q.route.length - 1]) {
    const gain = Number(q.amountOut) - Number(q.amountIn);
    const gainUsd = gain * (gas.prices?.get(q.route[0]) ?? NaN);
    const net = units && gas.perMillionUsd !== null && Number.isFinite(gainUsd) ? gainUsd - (units / 1e6) * gas.perMillionUsd : null;
    const after = net === null ? '' : `, about ${net < 0 ? '−' : '+'}$${Math.abs(net).toFixed(4)} after gas at your last swap's size`;
    return `ROUND TRIP ${q.amountIn} ${q.route[0]} → ${q.amountOut} via ${q.route.join(' → ')} · ${gain > 0 ? `profit ${gain.toPrecision(4)} ${q.route[0]} before gas${after}; lp/swap with tokenIn = tokenOut runs it` : 'no profit now'}. ${gasWords}`;
  }
  return [`QUOTE ${q.amountIn} ${q.symbolIn} → ${q.symbolOut}, two roads:`, ...roadLines(q), `lp/swap takes the road that pays more. ${gasWords}`].join('\n');
};
