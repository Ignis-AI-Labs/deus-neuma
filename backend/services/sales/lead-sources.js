// LEAD SOURCES — gathering in bulk (Design note, 2026-11-15: […]). The outbound tools
// this was studied from do not find leads; they look them up in a database
// they own. The house owns none, so it reads public lists that already hold
// the companies an audience is made of, through ONE seam: a source returns
// candidate rows, each a real company with the page it was read on. A
// candidate is not a prospect: the sales seat still scores it on the
// audience's own criteria (sales/prospect) before it can become a lead.
//
// FREE SOURCES (no key):
//   base-tokens     every token trading on Base, from GeckoTerminal's public
//                   API: the pools by 24 h volume, then each token's profile
//                   (site, socials, holders). Paced under the public limit.
//   base-protocols  every DeFi protocol on Base, from DefiLlama's public list
//                   (one read): site, X handle, category, value locked.
//   company-index   the house's OWN company database on this machine
//                   (company-index.js): 22M+ companies with industry, size,
//                   country, founding year and a traffic rank, searched by
//                   words and filters. Hundreds at a time, nothing leaves.
//   hunter-discover Hunter's company search (hunter-discover.js): free with the
//                   operator's own key, plain words in, companies out with how
//                   many addresses Hunter holds for each.
// ATTACHED SOURCES (the operator's own key, Settings, API, Service keys):
//   hunter, tomba, apollo — the people at a company's domain with their
//                   addresses (lead-providers.js). They spend the operator's
//                   credits, so lead-spend.js decides when one may run.
// Free first (Design note, 2026-11-15: […]). A new source is one entry in LEAD_SOURCES.
// The parsing is PURE; every gather is impure (network), behind the
// `lead-sources` connection switch.

import process from 'node:process';
import { PEOPLE_PROVIDERS, peopleOfHunter } from './lead-providers.js';
import { gatherHunterDiscover, DISCOVER_MAX } from './hunter-discover.js';
import { searchIndex, indexStats, industriesOf, candidateOfCompany, SIZES } from './company-index.js';

export { peopleOfHunter };

export const GECKO_URL = 'https://api.geckoterminal.com/api/v2';
export const LLAMA_URL = 'https://api.llama.fi';
// Each list's address, read per call: a test serves the same list from this machine.
const urlOf = (name, real) => process.env[`NEUMA_LEAD_SOURCE_${name}`] || real;
export const GATHER_MAX = 25;
const PACE_MS = 4000;
const BUSY_WAIT_MS = 20000;
// A team worth writing to has a real market and real holders; below these the token is noise.
export const MIN_LIQUIDITY_USD = 25000;
export const MIN_HOLDERS = 300;
// A site that is the token's launchpad or exchange is not the team's own: there is nobody there to write to.
const NOT_A_TEAM_SITE = /(^|\.)(clanker\.world|coinbase\.com|zora\.co|virtuals\.io|pump\.fun|flaunch\.gg|bankr\.bot|dexscreener\.com|geckoterminal\.com|basescan\.org|uniswap\.org|aerodrome\.finance|t\.me|x\.com|twitter\.com|linktr\.ee|github\.com|github\.io)$/;
// Tokens that are money or infrastructure, never a team to sell a pool to.
const MAJORS = new Set(['WETH', 'ETH', 'USDC', 'USDT', 'DAI', 'USDBC', 'CBBTC', 'CBETH', 'WBTC', 'WSTETH', 'EURC', 'USDS', 'AERO', 'VIRTUAL']);

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^(www|app)\./, '').toLowerCase(); } catch { return null; } };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const usd = (n) => `$${n.toLocaleString('en-US')}`;

/**
 * pure — from one page of pools: each non-major base token once, with its deepest pool.
 * @returns {Array<{address: string, symbol: string, name: string, pool: {dex: string, name: string, liquidityUsd: number, volume24hUsd: number}}>}
 */
export const tokensOfPools = (page) => {
  const tokens = new Map((page?.included ?? []).filter((i) => i.type === 'token').map((t) => [t.id, t.attributes]));
  const best = new Map();
  for (const p of page?.data ?? []) {
    const token = tokens.get(p.relationships?.base_token?.data?.id);
    if (!token || MAJORS.has(String(token.symbol).toUpperCase())) continue;
    const pool = {
      dex: String(p.relationships?.dex?.data?.id ?? 'unknown'),
      name: String(p.attributes?.name ?? ''),
      liquidityUsd: Math.round(num(p.attributes?.reserve_in_usd)),
      volume24hUsd: Math.round(num(p.attributes?.volume_usd?.h24)),
    };
    const prior = best.get(token.address);
    if (!prior || pool.liquidityUsd > prior.pool.liquidityUsd) best.set(token.address, { address: token.address, symbol: token.symbol, name: token.name, pool });
  }
  return [...best.values()];
};

/**
 * pure — a candidate row from a token and its profile, or null when it is not
 * a company to write to (no site of its own, or flagged by the list).
 */
export const candidateOf = (token, info) => {
  const a = info?.data?.attributes ?? {};
  const site = (Array.isArray(a.websites) ? a.websites : []).find((u) => hostOf(u));
  const domain = site ? hostOf(site) : null;
  if (!domain || NOT_A_TEAM_SITE.test(domain) || a.is_honeypot === true || a.is_honeypot === 'yes' || a.is_nsfw === true) return null;
  if (num(a.holders?.count) < MIN_HOLDERS) return null;
  return {
    source: 'base-tokens',
    domain,
    name: String(a.name || token.name).slice(0, 80),
    symbol: String(a.symbol || token.symbol).slice(0, 16),
    description: String(a.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
    site,
    twitter: a.twitter_handle || null,
    telegram: a.telegram_handle || null,
    categories: (Array.isArray(a.categories) ? a.categories : []).slice(0, 4),
    holders: num(a.holders?.count),
    verified: a.gt_verified === true,
    pool: token.pool,
    token: token.address,
    signal: `deepest pool ${token.pool.name} on ${token.pool.dex}, ${usd(token.pool.liquidityUsd)} liquidity, ${usd(token.pool.volume24hUsd)} traded in 24 h — ${num(a.holders?.count).toLocaleString('en-US')} holders`,
    sourceUrl: `https://www.geckoterminal.com/base/tokens/${token.address}`,
  };
};

/** pure — one line a person or a being reads to judge a candidate. */
export const candidateLine = (c) => [
  `${c.name}${c.symbol ? ` (${c.symbol})` : ''}`, c.domain, c.signal,
  ...(c.categories?.length ? [c.categories.join(', ')] : []),
  ...(c.twitter ? [`X @${c.twitter}`] : []),
  ...(c.telegram ? [`Telegram ${c.telegram}`] : []),
].filter(Boolean).join(' — ');

/**
 * pure — the protocols on Base from DefiLlama's list, biggest first, each a
 * candidate row; a protocol with no site of its own is left out.
 */
export const protocolsOnBase = (list) => (Array.isArray(list) ? list : [])
  .filter((p) => Array.isArray(p?.chains) && p.chains.includes('Base') && hostOf(p.url) && !NOT_A_TEAM_SITE.test(hostOf(p.url)))
  // A team that lives on Base: at least half of what it holds is there. An exchange is not a protocol team.
  .filter((p) => p.category !== 'CEX' && num(p.chainTvls?.Base) > 0 && num(p.chainTvls.Base) >= 0.5 * num(p.tvl))
  .sort((x, y) => num(y.chainTvls.Base) - num(x.chainTvls.Base))
  .map((p) => ({
    source: 'base-protocols',
    domain: hostOf(p.url),
    name: String(p.name).slice(0, 80),
    symbol: p.symbol && p.symbol !== '-' ? String(p.symbol).slice(0, 16) : null,
    description: String(p.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
    site: p.url,
    twitter: p.twitter || null,
    telegram: null,
    categories: p.category ? [String(p.category)] : [],
    signal: `${usd(Math.round(num(p.chainTvls.Base)))} locked on Base, ${Math.round(100 * num(p.chainTvls.Base) / num(p.tvl))}% of all it holds`,
    sourceUrl: `https://defillama.com/protocol/${encodeURIComponent(String(p.slug ?? p.name).toLowerCase().replace(/\s+/g, '-'))}`,
  }));

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('interrupted')); }, { once: true });
});

// impure — one GET, JSON or a thrown reason. A busy answer (429) waits and asks again, three times.
const getJson = async (url, signal, busyWaitMs, onBusy = () => {}) => {
  for (let tries = 0; ; tries += 1) {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal });
    if (res.ok) return res.json();
    if (res.status !== 429 || tries >= 3) throw new Error(res.status === 429 ? 'the list is busy (its public limit) — gather again in a few minutes' : `the list answered ${res.status}`);
    onBusy(tries + 1);
    await wait(busyWaitMs, signal);
  }
};

/**
 * Gather up to `count` NEW candidates: walk the pool pages until enough tokens
 * the house has not seen (`known` domains and token addresses) have a profile.
 * impure — network. Never throws: what was gathered so far comes back with why it stopped.
 * @param {{count?: number, known?: {domains: Set<string>, tokens: Set<string>}, baseUrl?: string, paceMs?: number, busyWaitMs?: number, signal?: AbortSignal, onProgress?: (words: string) => void}} opts
 * @returns {Promise<{candidates: object[], looked: number, stopped: ?string}>}
 */
export const gatherBaseTokens = async ({ count = GATHER_MAX, known = { domains: new Set(), tokens: new Set() }, baseUrl = urlOf('GECKO', GECKO_URL), paceMs = PACE_MS, busyWaitMs = BUSY_WAIT_MS, signal, onProgress = () => {} } = {}) => {
  const want = Math.min(Math.max(parseInt(count, 10) || GATHER_MAX, 1), GATHER_MAX);
  const candidates = [];
  // A paced gather runs for minutes: say where it stands after every token, and when the list makes it wait.
  const busy = (n) => onProgress(`the list is busy, waiting ${Math.round(busyWaitMs / 1000)} s (${n} of 3) — ${candidates.length} of ${want} found so far`);
  const seen = new Set(known.tokens);
  let looked = 0;
  try {
    for (let page = 1; page <= 10 && candidates.length < want; page += 1) {
      onProgress(`reading page ${page} of the most traded pools — ${candidates.length} of ${want} found`);
      const pools = await getJson(`${baseUrl}/networks/base/pools?page=${page}&sort=h24_volume_usd_desc&include=base_token,dex`, signal, busyWaitMs, busy);
      if (!(pools?.data ?? []).length) break;
      for (const token of tokensOfPools(pools)) {
        if (candidates.length >= want) break;
        if (seen.has(token.address) || token.pool.liquidityUsd < MIN_LIQUIDITY_USD) continue;
        seen.add(token.address);
        await wait(paceMs, signal);
        looked += 1;
        const row = candidateOf(token, await getJson(`${baseUrl}/networks/base/tokens/${token.address}/info`, signal, busyWaitMs, busy));
        if (row && !known.domains.has(row.domain) && !candidates.some((c) => c.domain === row.domain)) candidates.push(row);
        onProgress(`${candidates.length} of ${want} found — ${looked} tokens read, last ${token.symbol}${row ? '' : ' (no team site, skipped)'}`);
      }
      await wait(paceMs, signal);
    }
    return { candidates, looked, stopped: null };
  } catch (err) {
    return { candidates, looked, stopped: err.message };
  }
};

/**
 * Gather up to `count` protocols on Base the house has not seen. impure — one read. Never throws.
 * @returns {Promise<{candidates: object[], looked: number, stopped: ?string}>}
 */
export const gatherBaseProtocols = async ({ count = GATHER_MAX, known = { domains: new Set() }, baseUrl = urlOf('LLAMA', LLAMA_URL), signal } = {}) => {
  const want = Math.min(Math.max(parseInt(count, 10) || GATHER_MAX, 1), GATHER_MAX);
  try {
    const all = protocolsOnBase(await getJson(`${baseUrl}/protocols`, signal, BUSY_WAIT_MS));
    const fresh = [];
    for (const row of all) {
      if (fresh.length >= want) break;
      if (!known.domains.has(row.domain) && !fresh.some((c) => c.domain === row.domain)) fresh.push(row);
    }
    return { candidates: fresh, looked: all.length, stopped: null };
  } catch (err) {
    return { candidates: [], looked: 0, stopped: err.message };
  }
};

export const INDEX_GATHER_MAX = 500;
export const INDEX_EMPTY = 'the company index is not loaded on this machine yet — tell your operator: download the free company file (peopledatalabs.com/data-lab/dataset/company-dataset) and run "node scripts/load-company-index.mjs <that file>" once';

/**
 * Gather up to `count` companies the house has not seen from its own company index, most visited
 * first. The audience's countries apply unless the search names its own. impure — one local read. Never throws.
 * @param {{count?: number, known?: {domains: Set<string>}, segment?: object, query?: {words?: string, industries?: string[], countries?: string[], sizes?: string[], foundedFrom?: number, live?: boolean}}} opts
 * @returns {Promise<{candidates: object[], looked: number, stopped: ?string}>}
 */
export const gatherCompanyIndex = async ({ count = 100, known = { domains: new Set() }, segment = null, query = {} } = {}) => {
  const want = Math.min(Math.max(parseInt(count, 10) || 100, 1), INDEX_GATHER_MAX);
  try {
    if (!indexStats().loaded) return { candidates: [], looked: 0, stopped: INDEX_EMPTY };
    const countries = query.countries?.length ? query.countries : segment?.countries ?? [];
    const badSize = (query.sizes ?? []).find((s) => !SIZES.includes(s));
    if (badSize) return { candidates: [], looked: 0, stopped: `"${badSize}" is not a size the index knows — sizes are: ${SIZES.join(', ')}` };
    const { rows, looked } = searchIndex({ ...query, countries }, { count: want, known: known.domains });
    if (!looked && query.industries?.length) {
      const near = query.industries.flatMap((i) => industriesOf({ like: String(i).split(/\s+/)[0], limit: 8 })).map((i) => i.industry);
      return { candidates: [], looked: 0, stopped: `no company matches. The index files industries under exact names${near.length ? `; close to yours: ${[...new Set(near)].join(', ')}` : ''}. The most common: ${industriesOf({ limit: 15 }).map((i) => i.industry).join(', ')}` };
    }
    return { candidates: rows.map(candidateOfCompany), looked, stopped: null };
  } catch (err) {
    return { candidates: [], looked: 0, stopped: err.message };
  }
};

/**
 * Every source, free first. kind: what it returns. key: the service key it
 * needs (null: free). A new source is one entry here.
 */
export const LEAD_SOURCES = Object.freeze({
  'base-protocols': Object.freeze({ kind: 'companies', key: null, label: 'DeFi protocols on Base (DefiLlama, free)', gather: gatherBaseProtocols }),
  'base-tokens': Object.freeze({ kind: 'companies', key: null, label: 'tokens trading on Base (GeckoTerminal, free, about 50 an hour)', gather: gatherBaseTokens }),
  'company-index': Object.freeze({ kind: 'companies', key: null, local: true, max: INDEX_GATHER_MAX, label: `the house's own company database: 22M+ companies with industry, size, country, founding year and traffic rank (free, on this machine, up to ${INDEX_GATHER_MAX} at a time)`, gather: gatherCompanyIndex }),
  'hunter-discover': Object.freeze({ kind: 'companies', key: 'hunter', free: true, max: DISCOVER_MAX, label: `Hunter's company search with your own key: describe the companies in plain words; each comes back with how many people Hunter holds there (FREE, it spends no credits; up to ${DISCOVER_MAX} at a time)`, gather: gatherHunterDiscover }),
  ...PEOPLE_PROVIDERS,
});
