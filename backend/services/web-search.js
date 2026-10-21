// Web search — independent indexes queried together, not one provider's view:
//
//   - Exa Instant (EXA_API_KEY) — AI-native search + page highlights in one call
//   - SearXNG (SEARXNG_URL) — operator-owned metasearch, when configured
//   - Brave (BRAVE_SEARCH_API_KEY) — independent JSON index, when configured
//   - DuckDuckGo-lite — zero-config public fallback, always queried
//
// Providers run concurrently, fail independently, and their rows are
// round-robin merged with URL deduplication. A total failure says so honestly
// (an air-gapped rig learns it has no egress from the error, not from a hang).
// Each provider is one impure fetch + one pure normalizer.

import { getAppConfig } from '../config.js';
import { decodeEntities } from './html-to-text.js';
import { serviceValue } from './stored-secrets.js';

const TIMEOUT_MS = 10_000;

// Search endpoints are operator/config-supplied (SearXNG is typically
// loopback — exactly what the strict web guard forbids for page fetches),
// so these calls do NOT pass the web guard; the URL comes from config, not
// from the being.

// --- Pure normalizers ---

const exaSnippet = (row) => {
  const highlights = Array.isArray(row?.highlights)
    ? row.highlights.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  return highlights.length > 0 ? highlights.join('\n') : String(row?.text || '');
};

/** Exa /search → unified rows with LLM-selected page evidence. Pure. */
export const normalizeExa = (data, limit) =>
  (Array.isArray(data?.results) ? data.results : [])
    .map((row) => ({
      title: String(row?.title || ''),
      url: String(row?.url || ''),
      snippet: exaSnippet(row),
    }))
    .filter((row) => row.url)
    .slice(0, limit);

/** SearXNG /search?format=json → unified rows. Pure. */
export const normalizeSearxng = (data, limit) =>
  (Array.isArray(data?.results) ? data.results : [])
    .map((r) => ({ title: String(r?.title || ''), url: String(r?.url || ''), snippet: String(r?.content || '') }))
    .filter((r) => r.url)
    .slice(0, limit);

/** Brave /res/v1/web/search → unified rows. Pure. */
export const normalizeBrave = (data, limit) =>
  (Array.isArray(data?.web?.results) ? data.web.results : [])
    .map((r) => ({ title: String(r?.title || ''), url: String(r?.url || ''), snippet: String(r?.description || '') }))
    .filter((r) => r.url)
    .slice(0, limit);

const resultKey = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return String(rawUrl || '').trim();
  }
};

/**
 * Interleave independent indexes so the first provider cannot occupy the
 * whole result set. Duplicate URLs keep the earliest provider's row. Pure.
 * @param {Array<{name: string, results: Array<object>}>} groups
 * @param {number} limit
 * @returns {Array<object>}
 */
export const mergeSearchResults = (groups, limit) => {
  const cap = Math.max(0, Math.floor(Number(limit) || 0));
  const depth = Math.max(0, ...groups.map(({ results }) => results.length));
  const seen = new Set();
  const merged = [];
  for (let index = 0; index < depth && merged.length < cap; index += 1) {
    for (const { name, results } of groups) {
      const row = results[index];
      if (!row?.url) continue;
      const key = resultKey(row.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...row, backend: name });
      if (merged.length >= cap) break;
    }
  }
  return merged;
};

/** Brave /res/v1/images/search → unified IMAGE rows (pure). The image's own
 *  direct URL lives at properties.url — the row's top-level url is the PAGE
 *  it came from, and a download aimed at the page fetches markup, not
 *  bytes. The thumbnail rides so the operator's chip can show what the being
 *  is looking at without fetching anything itself. */
export const normalizeBraveImages = (data, limit) =>
  (Array.isArray(data?.results) ? data.results : [])
    .map((r) => ({
      title: String(r?.title || ''),
      url: String(r?.properties?.url || ''),
      pageUrl: String(r?.url || ''),
      thumbnail: String(r?.thumbnail?.src || ''),
      width: Number.isFinite(r?.properties?.width) ? r.properties.width : null,
      height: Number.isFinite(r?.properties?.height) ? r.properties.height : null,
      contentType: String(r?.properties?.format || ''),
    }))
    .filter((r) => r.url)
    .slice(0, limit);

/**
 * DuckDuckGo-lite result page → unified rows. The lite layout lists each
 * result as an <a class='result-link'> whose href wraps the target in an
 * `uddg` redirect param (decoded here), followed by a result-snippet cell.
 * The anchor scan is attribute-ORDER agnostic — the live markup emits
 * href BEFORE class (a class-first regex silently parses zero rows, which
 * is exactly how this read as "absolute silence", 2026-07-19). Pure.
 */
export const parseDdgLite = (html, limit) => {
  const stripTags = (s) => decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const links = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(String(html))) !== null) {
    const attrs = m[1];
    if (!/class=['"][^'"]*result-link[^'"]*['"]/.test(attrs)) continue;
    const href = /href=['"]([^'"]+)['"]/.exec(attrs);
    if (!href) continue;
    let url = decodeEntities(href[1]);
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) {
      try { url = decodeURIComponent(uddg[1]); } catch { /* keep the wrapped form */ }
    }
    links.push({ title: stripTags(m[2]), url });
  }
  const snippets = [];
  const snippetRe = /<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
  while ((m = snippetRe.exec(String(html))) !== null) snippets.push(stripTags(m[1]));
  const out = [];
  for (let i = 0; i < links.length && out.length < limit; i++) {
    if (links[i].url) out.push({ ...links[i], snippet: snippets[i] || '' });
  }
  return out;
};

/**
 * Did DuckDuckGo answer with an empty FIELD, or with a WALL?
 *
 * Both parse to zero rows, and they mean opposite things. A block reported as
 * "No results" tells a researching model the subject does not exist — the most
 * expensive lie this tool can tell, because the model stops looking. Under a
 * real research run (dozens of queries a minute from one IP) DDG rate-limiting
 * is the expected case, not the edge case; the module's own header records this
 * happening on 2026-07-19.
 *
 * A genuine empty result page says so in words. A rate-limit, anomaly or
 * CAPTCHA page does not — and neither does markup that has changed under us,
 * which must also never read as an answer.
 *
 * Pure.
 * @param {string} html the raw lite.duckduckgo.com body
 * @param {number} rows how many results parsed out of it
 * @returns {boolean} true when zero rows cannot be trusted as "nothing here"
 */
export const ddgLooksBlocked = (html, rows) => {
  if (rows > 0) return false;
  return !/no\s+results|no\s+web\s+results|did not match any/i.test(String(html || ''));
};

// --- Providers (impure) ---

const exaApiRoot = () => process.env.NEUMA_EXA_API_ROOT || 'https://api.exa.ai';

const searchExa = async (apiKey, query, limit, root = exaApiRoot()) => {
  const res = await fetch(`${root.replace(/\/$/, '')}/search`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      type: 'instant',
      numResults: limit,
      moderation: true,
      contents: { highlights: true },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`exa answered ${res.status}`);
  return normalizeExa(await res.json(), limit);
};

const searchSearxng = async (base, query, limit) => {
  const url = `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`searxng answered ${res.status}`);
  return normalizeSearxng(await res.json(), limit);
};

const searchBrave = async (apiKey, query, limit, root = braveApiRoot()) => {
  const url = `${root}/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`brave answered ${res.status}`);
  return normalizeBrave(await res.json(), limit);
};

// The same env door the X lane carries: the platform's own tests aim the
// REAL request path at a loopback Brave-shaped server instead of the live
// API (RULE 0 — the wire shape is asserted, never mocked away).
const braveApiRoot = () => process.env.NEUMA_BRAVE_API_ROOT || 'https://api.search.brave.com';

// impure — one real fetch against Brave's image index.
const searchBraveImages = async (apiKey, query, limit) => {
  const url = `${braveApiRoot()}/res/v1/images/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`brave answered ${res.status}`);
  return normalizeBraveImages(await res.json(), limit);
};

/**
 * Search for IMAGES (GIFs included — a GIF is an image; "gif" in the query
 * finds them). Brave only: the text ladder's other backends have no image
 * index worth scraping, and a fake ladder would read as coverage that is
 * not there. impure — real network.
 * @param {string} query
 * @param {number} [limit]
 * @returns {Promise<{ok: true, backend: string, results: Array<object>} | {ok: false, error: string}>}
 */
export const searchImages = async (query, limit = 6) => {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'empty query' };
  const cap = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 12);
  const { braveKey } = searchConfig();
  if (!braveKey) {
    return { ok: false, error: 'image search needs the Brave key (BRAVE_SEARCH_API_KEY) — there is no image fallback backend' };
  }
  try {
    return { ok: true, backend: 'brave', results: await searchBraveImages(braveKey, q, cap) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

const searchDdg = async (query, limit) => {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NeumaWeb/1.0 (local research tool)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`duckduckgo answered ${res.status}`);
  const html = await res.text();
  const results = parseDdgLite(html, limit);
  // THROW rather than return []. Throwing lets the ladder fall through to
  // another backend and, if none answers, report an honest failure. Returning
  // an empty list would hand back `ok: true` and render as "No results" — a
  // block dressed as an answer.
  if (ddgLooksBlocked(html, results.length)) {
    throw new Error('duckduckgo returned no result rows and no "no results" notice '
      + '— a rate-limit or verification page, or the markup changed. This is NOT an empty field.');
  }
  return results;
};

// Config may be unloaded in tests — absence reads as "nothing configured".
const searchConfig = () => {
  // Saved in Settings → API wins; the env-loaded config is the fallback.
  let cfg = {};
  try { cfg = getAppConfig(); } catch { /* config unloaded: only saved values apply */ }
  return {
    exaKey: serviceValue('exa', {}) || cfg.exaApiKey || '',
    searxngUrl: serviceValue('searxng', {}) || cfg.searxngUrl || '',
    braveKey: serviceValue('brave', {}) || cfg.braveSearchApiKey || '',
  };
};

/**
 * Search operators the lite DuckDuckGo backend silently drops (pure). A being
 * that reads zero results through an unsupported operator would mistake its
 * instrument's limit for the field's answer (proven live 2026-07-20) — the
 * result must say so itself. SHINKEI: an instrument reports its own range.
 * @param {string} query
 * @param {string} backend
 * @returns {string|null}
 */
export const unsupportedOperatorHint = (query, backend) => {
  if (backend !== 'duckduckgo') return null;
  if (!/\b(?:site|intitle|inurl|filetype):/i.test(query)) return null;
  return 'This backend does not honor operators like site: — zero or thin results may be your syntax, not the field. Retry with plain words.';
};

/** Which indexes will be queried today. Pure on config. */
export const activeSearchBackends = ({
  exaKey = '',
  searxngUrl = '',
  braveKey = '',
} = searchConfig()) => [
  ...(exaKey ? ['exa'] : []),
  ...(searxngUrl ? ['searxng'] : []),
  ...(braveKey ? ['brave'] : []),
  'duckduckgo',
];

/**
 * Query all selected indexes concurrently and merge their answers.
 * impure — real network.
 * @param {string} query
 * @param {number} [limit]
 * @param {{exaKey?: string, exaRoot?: string, searxngUrl?: string, braveKey?: string, braveRoot?: string, includeDdg?: boolean}} [options]
 * @returns {Promise<{ok: true, backend: string, backends: string[], results: Array<object>, hint?: string, failures?: string[]} | {ok: false, error: string}>}
 */
export const searchAcrossBackends = async (query, limit = 5, options = {}) => {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'empty query' };
  const cap = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 10);
  const {
    exaKey = '',
    exaRoot = exaApiRoot(),
    searxngUrl = '',
    braveKey = '',
    braveRoot = braveApiRoot(),
    includeDdg = true,
  } = options;
  const providers = [
    ...(exaKey ? [['exa', () => searchExa(exaKey, q, cap, exaRoot)]] : []),
    ...(searxngUrl ? [['searxng', () => searchSearxng(searxngUrl, q, cap)]] : []),
    ...(braveKey ? [['brave', () => searchBrave(braveKey, q, cap, braveRoot)]] : []),
    ...(includeDdg ? [['duckduckgo', () => searchDdg(q, cap)]] : []),
  ];
  if (providers.length === 0) return { ok: false, error: 'no search backend configured' };

  const outcomes = await Promise.all(providers.map(async ([name, run]) => {
    try {
      return { name, results: await run() };
    } catch (error) {
      return { name, error: error.message };
    }
  }));
  const answered = outcomes.filter(({ results }) => Array.isArray(results));
  const failures = outcomes
    .filter(({ error }) => error)
    .map(({ name, error }) => `${name}: ${error}`);
  if (answered.length === 0) {
    return { ok: false, error: `no search backend answered (${failures.join('; ')})` };
  }

  const backends = answered.map(({ name }) => name);
  const results = mergeSearchResults(answered, cap);
  const notes = [];
  if (backends.length === 1) {
    const range = unsupportedOperatorHint(q, backends[0]);
    if (range) notes.push(range);
  }
  if (failures.length > 0) notes.push(`Some search sources did not answer: ${failures.join('; ')}.`);
  return {
    ok: true,
    backend: backends.join('+'),
    backends,
    results,
    ...(notes.length > 0 ? { hint: notes.join('\n') } : {}),
    ...(failures.length > 0 ? { failures } : {}),
  };
};

/**
 * Search through every configured index plus the zero-config fallback.
 * impure — real network.
 * @param {string} query
 * @param {number} [limit]
 */
export const searchWeb = async (query, limit = 5) => {
  const config = searchConfig();
  return searchAcrossBackends(query, limit, {
    ...config,
    exaRoot: exaApiRoot(),
    braveRoot: braveApiRoot(),
    includeDdg: true,
  });
};
