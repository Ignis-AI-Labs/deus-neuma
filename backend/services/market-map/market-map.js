// market-map.js — the field a house member maps before it puts money to work
// (Design note, 2026-11-14: […]). Reads market-data.js; the shaping is pure.
//
//   field  — a network's pools by 24h volume and trending, and for Base, the
//            UMBRAE GAPS: pairs that trade elsewhere and have no Umbrae pool
//            (each a candidate for lp/create-pool when Umbrae trades one side)
//   new    — a network's newest pools (early, and the riskiest)
//   token  — every market a token trades in, on every chain
//   yields — yields across every chain and protocol, filtered
//
// The text is dense on purpose: it is read by a model deciding where money goes.

import { ethers } from 'ethers';
import { callUmbrae } from '../umbrae-lp/umbrae-lp-client.js';
import { lpBase } from '../umbrae-lp/lp-base.js';
import { UMBRAE_FACTORY, orientPair } from '../../../core/wallet/pool-policy.js';
import { networkPools, tokenMarkets, yieldPools } from './market-data.js';

// A figure, or null when unread (null, '' and undefined are not zero: an unread figure never shows as $0).
const n = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** A dollar figure, short: $1.2M, $45.3K, $812. Pure. */
export const usdShort = (v) => {
  const x = n(v);
  if (x === null) return '?';
  const a = Math.abs(x);
  return a >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${x.toFixed(0)}`;
};
const pct = (v, d = 1) => (n(v) === null ? '?' : `${Number(v).toFixed(d)}%`);
const ageOf = (iso, now) => {
  const ms = now - Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return '?';
  const h = ms / 3_600_000;
  return h < 48 ? `${Math.max(0, Math.round(h))}h old` : `${Math.round(h / 24)}d old`;
};
// USDC and WETH on Base, lowercased.
const PREFERRED_QUOTES = Object.freeze(['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '0x4200000000000000000000000000000000000006']);
// GeckoTerminal ids read "<network>_<address>".
const addressOf = (id) => String(id ?? '').split('_').slice(1).join('_').toLowerCase();

/**
 * One GeckoTerminal pool as the fields the map reads. Pure.
 * @param {object} p - a GeckoTerminal pool resource
 */
export const poolRow = (p) => {
  const a = p?.attributes ?? {};
  const fee = /(\d+(?:\.\d+)?)%\s*$/.exec(String(a.name ?? ''));
  const feePct = fee ? Number(fee[1]) : null;
  const vol24 = n(a.volume_usd?.h24);
  return {
    name: String(a.name ?? '?'), dex: p?.relationships?.dex?.data?.id ?? '?', address: String(a.address ?? ''),
    base: addressOf(p?.relationships?.base_token?.data?.id), quote: addressOf(p?.relationships?.quote_token?.data?.id),
    vol24, tvl: n(a.reserve_in_usd), feePct, feesPerDay: feePct !== null && vol24 !== null ? (vol24 * feePct) / 100 : null,
    change24: n(a.price_change_percentage?.h24), created: a.pool_created_at ?? null,
    trades24: (n(a.transactions?.h24?.buys) ?? 0) + (n(a.transactions?.h24?.sells) ?? 0),
  };
};

/**
 * Volume that few, huge trades make is wash trading or a trap (read live 2026-11-14:
 * $159M over 234 trades, the price −59%). Pure.
 * @returns {string|null} why it looks fake, or null
 */
export const suspectOf = (r) => {
  if (!r.vol24 || r.vol24 < 1_000_000) return null;
  const perTrade = r.trades24 > 0 ? r.vol24 / r.trades24 : Infinity;
  return r.trades24 < 300 || perTrade > 250_000 ? `${usdShort(perTrade)} a trade over ${r.trades24} trades: wash trading or a trap, not real demand` : null;
};

/** One pool as a line. Pure. */
export const poolLine = (r, now = Date.now()) => `${suspectOf(r) ? `SUSPECT (${suspectOf(r)}) ` : ''}${r.name} on ${r.dex} · 24h volume ${usdShort(r.vol24)} · TVL ${usdShort(r.tvl)}${r.feesPerDay !== null ? ` · fees ~${usdShort(r.feesPerDay)}/day to its LPs` : ''}${r.change24 !== null ? ` · price ${r.change24 >= 0 ? '+' : ''}${pct(r.change24)} 24h` : ''} · ${r.trades24} trades · ${ageOf(r.created, now)} · ${r.address}`;

/**
 * What Umbrae covers, from its pool list: every pair (sorted addresses) and every token. Pure.
 * @param {object|null} payload - Umbrae's /pools answer
 */
export const umbraeCoverage = (payload) => {
  const pairs = new Set();
  const tokens = new Map();
  for (const g of Array.isArray(payload?.groups) ? payload.groups : []) {
    for (const p of g.pairs ?? []) {
      const x = String(p.mint_x ?? g.mint_x ?? '').toLowerCase();
      const y = String(p.mint_y ?? g.mint_y ?? '').toLowerCase();
      if (!x || !y) continue;
      pairs.add([x, y].sort().join('|'));
      tokens.set(x, g.tokenX);
      tokens.set(y, g.tokenY);
    }
  }
  return { pairs, tokens };
};

// pure — a gap Umbrae can fill and that is real comes first; a fake one last.
const rank = (g) => (g.umbraeQuote ? 2 : 0) + (suspectOf(g) ? -3 : 1);

/**
 * The pairs that trade on the network and have no Umbrae pool, the busiest
 * first; each says what Umbrae would need to host it. Pure.
 * @param {Array<object>} rows - poolRow of the network's pools
 * @param {{pairs: Set<string>, tokens: Map<string, string>}} umbrae
 */
export const umbraeGaps = (rows, umbrae) => {
  const seen = new Set();
  return rows.filter((r) => r.base && r.quote).flatMap((r) => {
    const key = [r.base, r.quote].sort().join('|');
    if (umbrae.pairs.has(key) || seen.has(key)) return [];
    seen.add(key);
    // The side Umbrae holds becomes the new pool's quote: USDC or WETH first (what members carry), then any token Umbrae trades.
    const held = [r.quote, r.base].filter((t) => umbrae.tokens.has(t));
    const quote = held.find((t) => PREFERRED_QUOTES.includes(t)) ?? held[0] ?? null;
    const base = quote === r.quote ? r.base : r.quote;
    return [{ ...r, umbraeQuote: quote, umbraeBase: quote ? base : null }];
  }).sort((a, b) => rank(b) - rank(a) || (b.vol24 ?? 0) - (a.vol24 ?? 0));
};

const FACTORY = new ethers.Interface(['function getAllPairs(address tokenX, address tokenY) view returns (address[])']);

/**
 * The pools Umbrae's factory already holds for each gap's pair. Its public list
 * leaves some out (read 2026-11-14: three cbBTC-WETH pools on the factory, none
 * listed), so a gap is checked on the factory before it is called empty.
 * impure — reads Base; a pair Base does not answer for keeps factoryPools null.
 */
const withFactoryPools = async (gaps) => {
  const base = await lpBase().catch(() => null);
  if (!base) return gaps;
  return Promise.all(gaps.map(async (g) => {
    if (!g.umbraeQuote) return g;
    try {
      const { tokenX, tokenY } = orientPair(g.base, g.quote);
      const raw = await base.send('eth_call', [{ to: UMBRAE_FACTORY, data: FACTORY.encodeFunctionData('getAllPairs', [tokenX, tokenY]) }, 'latest']);
      return { ...g, factoryPools: FACTORY.decodeFunctionResult('getAllPairs', raw)[0].map((a) => ethers.getAddress(a)) };
    } catch {
      return g;
    }
  }));
};

// pure — a gap as a line, with the act that would fill it when it can be filled.
export const gapLine = (g, now) => `${poolLine(g, now)}\n    ${g.factoryPools?.length
  ? `Umbrae's factory already has ${g.factoryPools.length} pool(s) for this pair that its public list does not show: ${g.factoryPools.join(', ')}. Most are seeded and abandoned (2026-11-14: ~$10 each, no volume, at stale prices): read one with lp_market {pool} and compare its price to the market FIRST, because liquidity added at a stale price is taken by the first arbitrage. Add to one with lp/open only at the market price, or open a free tier: lp/create-pool {baseToken: "${g.umbraeBase}", quoteToken: "${g.umbraeQuote}", check: true} lists them`
  : g.umbraeQuote
  ? `Umbrae has no pool for this pair: lp/create-pool {baseToken: "${g.umbraeBase}", quoteToken: "${g.umbraeQuote}", check: true} plans one`
  : 'Umbrae trades neither token: a pool needs one side Umbrae trades (route through a WETH or USDC pair of either token)'}`;

/**
 * A network's field: its busiest pools, what is trending, and on Base the
 * Umbrae gaps. Never throws. impure — reads GeckoTerminal and Umbrae.
 * @param {{network?: string, now?: number}} [opts]
 * @returns {Promise<string>}
 */
export const fieldMap = async ({ network = 'base', now = Date.now() } = {}) => {
  const [top, trending, umbrae] = await Promise.all([
    networkPools(network, 'top'), networkPools(network, 'trending'),
    network === 'base' ? callUmbrae('pools') : Promise.resolve(null),
  ]);
  if (!top.ok) return `The field on ${network} was not read: ${top.error}`;
  const rows = top.data.map(poolRow);
  const lines = [`THE FIELD ON ${network.toUpperCase()}: busiest pools by 24h volume (GeckoTerminal, every DEX):`, ...rows.slice(0, 12).map((r) => `- ${poolLine(r, now)}`)];
  if (trending.ok && trending.data.length) lines.push('TRENDING now:', ...trending.data.slice(0, 6).map(poolRow).map((r) => `- ${poolLine(r, now)}`));
  if (network === 'base') {
    if (!umbrae?.ok) {
      lines.push(`UMBRAE GAPS: not read (Umbrae's pool list: ${umbrae?.error ?? 'no answer'}).`);
    } else {
      const found = umbraeGaps([...rows, ...(trending.ok ? trending.data.map(poolRow) : [])], umbraeCoverage(umbrae.payload));
      const gaps = [...await withFactoryPools(found.slice(0, 10)), ...found.slice(10)];
      lines.push(`UMBRAE GAPS: pairs trading on Base with no Umbrae pool (${gaps.length}); the ones Umbrae can host first, busiest first, the suspect last. A pool you open on Umbrae for one is yours to be first in:`, ...gaps.slice(0, 10).map((g) => `- ${gapLine(g, now)}`));
    }
  }
  lines.push('More: market_map {network: "eth"|"solana"|"arbitrum"|"robinhood"|…} · {network, new: true} newest pools · {token} every market of a token · {yields: true, chain?, project?, symbol?, minTvlUsd?, stable?} yields everywhere.');
  return lines.join('\n');
};

/**
 * A network's newest pools: early, and the riskiest. Never throws. impure.
 * @param {{network?: string, now?: number}} [opts]
 */
export const newPoolsMap = async ({ network = 'base', now = Date.now() } = {}) => {
  const out = await networkPools(network, 'new');
  if (!out.ok) return `New pools on ${network} were not read: ${out.error}`;
  return [`NEWEST POOLS ON ${network.toUpperCase()} (early; most fail or are traps: a thin pool can be drained by its own creator):`,
    ...out.data.slice(0, 15).map(poolRow).map((r) => `- ${poolLine(r, now)}`)].join('\n');
};

/** One DexScreener pair as a line. Pure. */
export const marketLine = (p) => `${p.chainId ?? '?'} · ${p.dexId ?? '?'} · ${p.baseToken?.symbol ?? '?'}/${p.quoteToken?.symbol ?? '?'} · liquidity ${usdShort(p.liquidity?.usd)} · 24h volume ${usdShort(p.volume?.h24)} · price $${p.priceUsd ?? '?'}${n(p.priceChange?.h24) !== null ? ` (${p.priceChange.h24 >= 0 ? '+' : ''}${p.priceChange.h24}% 24h)` : ''} · ${p.pairAddress ?? ''}`;

/**
 * Every market a token trades in, deepest first. Never throws. impure — reads DexScreener.
 * @param {{token: string, chain?: string}} ask
 */
export const tokenMap = async ({ token, chain = 'base' }) => {
  const out = await tokenMarkets(token, chain);
  if (!out.ok) return `Markets for ${token} were not read: ${out.error}`;
  const pairs = out.data.slice().sort((a, b) => (n(b.liquidity?.usd) ?? 0) - (n(a.liquidity?.usd) ?? 0));
  if (!pairs.length) return `No market trades ${token} that DexScreener knows of.`;
  const chains = [...new Set(pairs.map((p) => p.chainId))];
  return [`MARKETS FOR ${token} (${pairs.length}, on ${chains.join(', ')}), deepest first (DexScreener):`, ...pairs.slice(0, 15).map((p) => `- ${marketLine(p)}`)].join('\n');
};

/**
 * Yields filtered from DefiLlama's list. Pure.
 * @param {Array<object>} rows
 * @param {{chain?: string, project?: string, symbol?: string, minTvlUsd?: number, stable?: boolean, limit?: number}} f
 */
export const pickYields = (rows, { chain, project, symbol, minTvlUsd = 1_000_000, stable, limit = 15 } = {}) => {
  const like = (v, want) => !want || String(v ?? '').toLowerCase().includes(String(want).toLowerCase());
  return rows.filter((r) => like(r.chain, chain) && like(r.project, project) && like(r.symbol, symbol)
    && (n(r.tvlUsd) ?? 0) >= minTvlUsd && (stable === undefined || Boolean(r.stablecoin) === stable) && n(r.apy) !== null)
    .sort((a, b) => b.apy - a.apy).slice(0, Math.min(50, Math.max(1, limit)));
};

/** One yield as a line. Pure. */
export const yieldLine = (r) => `${r.chain} · ${r.project} · ${r.symbol}${r.poolMeta ? ` (${r.poolMeta})` : ''} · APY ${pct(r.apy)}${n(r.apyReward) ? ` (base ${pct(r.apyBase)} + rewards ${pct(r.apyReward)}, paid in its reward token)` : ''} · TVL ${usdShort(r.tvlUsd)}${n(r.apyMean30d) !== null ? ` · 30d mean ${pct(r.apyMean30d)}` : ''}${r.ilRisk === 'yes' ? ' · IL risk' : ''}${r.outlier ? ' · OUTLIER: likely short-lived' : ''}`;

/**
 * Yields across every chain and protocol. Never throws. impure — reads DefiLlama.
 * @param {object} f - pickYields' filter
 */
export const yieldMap = async (f = {}) => {
  const out = await yieldPools();
  if (!out.ok) return `Yields were not read: ${out.error}`;
  const picked = pickYields(out.data, f);
  const said = [f.chain, f.project, f.symbol, f.stable === true ? 'stablecoins' : f.stable === false ? 'not stablecoins' : null].filter(Boolean).join(', ');
  return [
    `YIELDS${said ? ` (${said})` : ''}, TVL at least ${usdShort(f.minTvlUsd ?? 1_000_000)}, highest first, of ${out.data.length} tracked (DefiLlama):`,
    ...(picked.length ? picked.map((r) => `- ${yieldLine(r)}`) : ['- none match']),
    'A high APY on thin TVL, or one paid mostly in a reward token, is the least lasting. On Base your LP wallet reaches swaps today (lp/swap); bringing a yield found here into Umbrae is opening the pool for it (lp/create-pool).',
  ].join('\n');
};
