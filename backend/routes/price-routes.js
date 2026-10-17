// Price proxy — spot fiat prices for the wallet portfolio.
//
// Prices are NOT on-chain data: a Base RPC can report balances but cannot price
// them in USD. Like Rabby/MetaMask, we read spot prices from a public price feed
// (CoinGecko, no API key). We proxy it through our own backend for three reasons:
//   1. CSP — the renderer is held to `connect-src 'self'`, so it cannot fetch an
//      external host directly; a same-origin /api call can.
//   2. Caching — one short-lived in-memory cache serves every wallet instance, so
//      we make at most one upstream call per TTL and stay inside the free tier.
//   3. Swappability — the price source can change here without touching clients.
//
// Auth-gated: the price data itself is non-secret, but the renderer already holds
// a witness session token, so we require it here too. That keeps the […] posture and denies an anonymous caller the ability to drive our
// outbound price fetches as an amplification vector.
//
// Every failure degrades to `{ usd: null }` so the UI shows "—" and never a
// fabricated number (honest-stats: no invented data). A failure is never cached.

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';

const router = express.Router();
const log = createLogger('Prices');

router.use(requireAuth);

// The upstream price feed. Read PER CALL through NEUMA_COINGECKO_URL — the
// same isolation law as the settings paths — so this route can be aimed at a
// mirror, a cache, or a local server. Without it the URL was a hardcoded
// const, which meant the price lane could not be exercised at all without
// reaching the live public API: rate-limited, flaky, and outbound network from
// a test suite that has no business making any (#390 tranche 6).
const coingecko = () => process.env.NEUMA_COINGECKO_URL || 'https://api.coingecko.com/api/v3';
const TTL_MS = 60_000;   // one upstream call per minute, shared across clients
const FETCH_MS = 6000;   // upstream timeout — never hang the wallet on a slow feed

let ethCache = null;    // { at:number, data:object } — only ever a SUCCESS is cached
let ethInFlight = null; // Promise — single-flight a cold miss so a burst makes ONE upstream call

// Token prices are keyed by a sorted id-set, so the wallet's fixed curated set
// maps to ONE cache entry + ONE upstream call/min. Bounded against unbounded
// growth (callers are auth-gated and send a stable set).
const ID_RE = /^[a-z0-9-]{1,64}$/; // CoinGecko coin ids: lowercase, digits, hyphens
const TOKEN_CACHE_CAP = 32;
const tokenCache = new Map();    // idsKey -> { at, data }
const tokenInFlight = new Map(); // idsKey -> Promise

const fetchJson = async (url) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) {
      log.warn('Price feed HTTP error', { status: res.status });
      return null;
    }
    return await res.json();
  } catch (err) {
    // Capture the reason (DNS, timeout/abort, parse) — do not swallow it silently.
    log.warn('Price feed fetch failed', { err: err?.message });
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// Null-safe finite-number coercion: null/undefined/non-finite → null. Guarding
// null FIRST is essential — Number(null) === 0 (finite), so a feed that returns
// `usd: null` must never be read as a real $0 (the footgun this whole flow exists
// to avoid). A genuine 0 still coerces to 0.
const toFiniteNumber = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Fetch + map the ETH spot price. Caches only on success; returns the same shape
// on failure so callers uniformly see { usd: null }.
const loadEthPrice = async () => {
  const body = await fetchJson(`${coingecko()}/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true`);
  const usd = toFiniteNumber(body?.ethereum?.usd);
  if (usd == null) {
    // covers fetch failure (body null) AND a 200 body shaped { ethereum: { usd: null } }
    log.warn('ETH price feed unavailable or malformed — returning null price');
    return { usd: null }; // not cached: retry on the next request
  }
  const data = { usd, change24h: toFiniteNumber(body.ethereum.usd_24h_change), asOf: new Date().toISOString() };
  ethCache = { at: Date.now(), data };
  return data;
};

// GET /api/v1/prices/eth → { usd, change24h, asOf } | { usd: null }
router.get('/eth', async (_req, res) => {
  try {
    if (ethCache && Date.now() - ethCache.at < TTL_MS) return res.json(ethCache.data);
    // Coalesce concurrent cold-miss callers onto one in-flight upstream request.
    if (!ethInFlight) ethInFlight = loadEthPrice().finally(() => { ethInFlight = null; });
    return res.json(await ethInFlight);
  } catch (err) {
    log.warn('Price route error', { err: err?.message });
    return res.json({ usd: null });
  }
});

// Price a set of CoinGecko ids in one upstream call. Caches the (possibly partial)
// success keyed by the sorted id-set; a fetch failure (body null) is NOT cached.
const loadTokenPrices = async (ids, key) => {
  const body = await fetchJson(
    `${coingecko()}/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd&include_24hr_change=true`,
  );
  if (!body || typeof body !== 'object') return {}; // upstream failed — not cached, retry next time
  const out = {};
  for (const id of ids) {
    const usd = toFiniteNumber(body[id]?.usd);
    if (usd != null) out[id] = { usd, change24h: toFiniteNumber(body[id].usd_24h_change) };
  }
  if (tokenCache.size >= TOKEN_CACHE_CAP) tokenCache.clear();
  tokenCache.set(key, { at: Date.now(), data: out });
  return out;
};

// GET /api/v1/prices/tokens?ids=usd-coin,weth,… → { <id>: { usd, change24h } }
// Only ids that resolved to a price are present; an unpriced id is omitted so the
// caller renders "—" rather than a fabricated value.
router.get('/tokens', async (req, res) => {
  try {
    const ids = [...new Set(String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean))]
      .filter((id) => ID_RE.test(id));
    if (ids.length === 0) return res.json({});
    if (ids.length > 50) return res.status(400).json({ error: 'Too many ids (max 50).' });
    const key = ids.slice().sort().join(',');
    const hit = tokenCache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return res.json(hit.data);
    if (!tokenInFlight.has(key)) {
      tokenInFlight.set(key, loadTokenPrices(ids, key).finally(() => tokenInFlight.delete(key)));
    }
    return res.json(await tokenInFlight.get(key));
  } catch (err) {
    log.warn('Token price route error', { err: err?.message });
    return res.json({});
  }
});

export default router;
