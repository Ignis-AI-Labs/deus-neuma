// market-data.js — the field outside Umbrae, read from three public sources
// (Design note, 2026-11-14: […]). No key, nothing signed, no wallet address sent:
//
//   GeckoTerminal — pools on any network (top by 24h volume, trending, new)
//   DexScreener   — every market a token trades in, on every chain
//   DefiLlama     — yields across every chain and protocol
//
// Host-pinned (each source's own host; a loopback server only for a test,
// through its env door) and behind one connection switch, off until the
// operator turns it on. Answers are cached: GeckoTerminal allows ~30 calls a
// minute, and DefiLlama's yield list is ~10 MB (only the fields read are kept).
// Never throws: the caller gets the answer or a reason it can say.

import { isConnectionOn } from '../connections/connection-switches.js';

export const MARKET_DATA_CONNECTION = 'market-data';

const SOURCES = Object.freeze({
  gecko: { host: 'api.geckoterminal.com', env: 'NEUMA_GECKO_ORIGIN', cacheMs: 5 * 60_000 },
  dex: { host: 'api.dexscreener.com', env: 'NEUMA_DEXSCREENER_ORIGIN', cacheMs: 2 * 60_000 },
  llama: { host: 'yields.llama.fi', env: 'NEUMA_LLAMA_ORIGIN', cacheMs: 30 * 60_000 },
});
const NETWORK = /^[a-z0-9_-]{1,40}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const cache = new Map(); // url → {at, value}
const refused = (error) => ({ ok: false, error });

// pure — the source's own host over https, or a loopback test server over http.
const pinned = (raw, host) => {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol === 'https:') return url.hostname === host;
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
};

// impure — one GET, cached per source, cut short after timeoutMs.
const get = async (source, path, { shape = (v) => v, timeoutMs = 30000 } = {}) => {
  const s = SOURCES[source];
  const url = `${(process.env[s.env] || `https://${s.host}`).replace(/\/+$/, '')}${path}`;
  if (!pinned(url, s.host)) return refused(`refusing to call a host that is not ${s.host}`);
  if (!isConnectionOn(MARKET_DATA_CONNECTION)) return refused('market data is turned off on this computer — the operator can turn it on in Settings → Security → Connections');
  const kept = cache.get(url);
  if (kept && Date.now() - kept.at < s.cacheMs) return { ok: true, data: kept.value, cached: true };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'error', signal: abort.signal, headers: { Accept: source === 'gecko' ? 'application/json;version=20230302' : 'application/json' } });
    if (res.status === 429) return refused(`${s.host} asked to slow down (too many reads this minute); try again in a minute`);
    if (!res.ok) return refused(`${s.host} answered HTTP ${res.status}`);
    const value = shape(await res.json());
    cache.set(url, { at: Date.now(), value });
    return { ok: true, data: value };
  } catch (err) {
    return refused(err.name === 'AbortError' ? `the call to ${s.host} was cut short` : `${s.host} is unreachable: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Pools on one network, from GeckoTerminal. impure — network.
 * @param {string} network - GeckoTerminal's id: base, eth, solana, arbitrum, robinhood…
 * @param {'top'|'trending'|'new'} kind - top: by 24h volume
 */
export const networkPools = (network = 'base', kind = 'top') => {
  if (!NETWORK.test(String(network))) return Promise.resolve(refused('name the network by its GeckoTerminal id (base, eth, solana, arbitrum, robinhood…)'));
  const path = kind === 'trending' ? 'trending_pools?page=1' : kind === 'new' ? 'new_pools?page=1' : 'pools?sort=h24_volume_usd_desc&page=1';
  return get('gecko', `/api/v2/networks/${network}/${path}`, { shape: (j) => (Array.isArray(j?.data) ? j.data : []) });
};

/**
 * Every market a token trades in, on every chain, from DexScreener. impure — network.
 * @param {string} query - a symbol or name (searched), or an address (its pairs on `chain`)
 * @param {string} [chain] - DexScreener chain id, for an address (default base)
 */
export const tokenMarkets = (query, chain = 'base') => {
  const q = String(query ?? '').trim();
  if (!q || q.length > 80) return Promise.resolve(refused('name the token by symbol, name or address'));
  if (ADDRESS.test(q)) {
    if (!NETWORK.test(String(chain))) return Promise.resolve(refused('name the chain by its DexScreener id (base, ethereum, solana…)'));
    return get('dex', `/token-pairs/v1/${chain}/${q}`, { shape: (j) => (Array.isArray(j) ? j : []) });
  }
  return get('dex', `/latest/dex/search?q=${encodeURIComponent(q)}`, { shape: (j) => (Array.isArray(j?.pairs) ? j.pairs : []) });
};

/** Current USD price for one token from GeckoTerminal. impure — network. */
export const tokenPriceGecko = async (query, chain = 'base') => {
  const q = String(query ?? '').trim();
  if (!ADDRESS.test(q) || !NETWORK.test(String(chain))) return { ok: false, error: 'name a token address and chain' };
  const out = await get('gecko', `/api/v2/simple/networks/${chain}/token_price/${q}`, {
    shape: (j) => j?.data?.attributes?.token_prices ?? {},
  });
  if (!out.ok) return out;
  const usd = Number(out.data[q.toLowerCase()]);
  return Number.isFinite(usd) && usd > 0 ? { ok: true, usd } : { ok: false, error: 'GeckoTerminal returned no usable token price' };
};

// The fields of a DefiLlama yield row the map reads (the list is ~15k rows, ~10 MB).
const YIELD_FIELDS = Object.freeze(['chain', 'project', 'symbol', 'tvlUsd', 'apyBase', 'apyReward', 'apy', 'apyPct7D', 'apyMean30d', 'stablecoin', 'ilRisk', 'exposure', 'poolMeta', 'outlier', 'volumeUsd1d', 'pool', 'underlyingTokens']);

/** Every yield DefiLlama tracks, on every chain and protocol. impure — network. */
export const yieldPools = () => get('llama', '/pools', {
  timeoutMs: 60000,
  shape: (j) => (Array.isArray(j?.data) ? j.data : []).map((p) => Object.fromEntries(YIELD_FIELDS.map((k) => [k, p?.[k] ?? null]))),
});

/** Forget every cached answer (a test between cases). */
export const clearMarketCache = () => cache.clear();
