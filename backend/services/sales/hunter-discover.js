// HUNTER DISCOVER — the operator's own Hunter key, used for the part of Hunter that costs nothing.
//
// Design note, 2026-11-16, after one search in Hunter's own Discover screen returned 272,672 companies:
// […] We were not. The house called ONE Hunter endpoint, Domain Search (one
// credit a company), and never the one that FINDS companies. Read from Hunter's API documentation
// and proven with two real calls on 2026-11-16:
//   POST /discover   FREE ([…]). A sentence in `query` is turned into filters by
//                    Hunter's own assistant (returned in meta.filters), or filters are sent
//                    directly: keywords {include, match}, headcount [buckets], headquarters_location
//                    {include: [{country}]}, industry, company_type. Up to 100 companies a call:
//                    { domain, organization, emails_count: { personal, generic, total } }.
//                    Paging (offset) is a paid-plan feature; a free plan gets the first 100 of a search.
// So a gather here asks in plain words once (free), keeps Hunter's own filters, adds the
// audience's countries, and then asks size bucket by size bucket: each bucket is its own search
// with its own first 100, which reaches several hundred companies on a free plan without paging.
// Every company comes back with HOW MANY addresses Hunter holds for it, so a paid lookup
// (lead-providers.js, one credit) is spent only where there is somebody to find.
//
// DISCOVER IS THE FIRST STEP, AND IT IS AIMED (Design note, 2026-11-16, later: […]). For the Umbrae
// audience, Hunter's assistant read the words as ANY of […], […], […], […]…, and the
// gather brought back German gymnastics clubs, a valves supplier and a radio station. Asked with
// Hunter's own industry filter instead ([…], from the list Hunter publishes at
// hunter.io/files/industries.json, kept here as hunter-industries.json), the same search answered
// Cardano Foundation, Sui, Gnosis, Starknet Foundation, Monad Foundation. So: the being may give
// its own filters — industries (Hunter's names, checked here, a wrong one answered with the
// nearest), keywords (phrases, any or all), exclude — and then Hunter's guess is not used at all;
// and DISCOVER LOOKS FIRST (previewDiscover, sales/discover): how Hunter reads the search, how many
// match, the first companies — free, nothing kept — before a gather fills the pool.
//
// A WIDE NET FIRST, THEN FILTER DOWN (Design note, 2026-11-16: […]). The
// API answers exactly what Hunter's own screen shows — the same companies, the same order, the same
// address counts (proven 11-16: 97,856 matches, Revolut 7,574, IBM 3,107, Crypto.com 2,822 …). The
// gather used to ask size by size, smallest first, and stop at the count asked for: twenty-five
// one-to-ten-person companies, never the screen's list. Now one gather walks every search a free
// plan answers, each with its own first hundred: the search as Hunter ranks it (the screen's list),
// then each size, then each of the audience's countries by size — every company once, the most
// addresses first, each with the count the screen shows. Filtering down is the pool's work after:
// read the sites, score the fit.
// The shaping is PURE; the calls are impure (network), never throw.

import process from 'node:process';
import { HUNTER_URL } from './lead-providers.js';
import { SIZES } from './company-index.js';
import INDUSTRIES from './hunter-industries.json' with { type: 'json' };
import { testEndpoint } from '../test-endpoint-door.js';

export const DISCOVER_MAX = 3000;
const PER_CALL = 100;
const SAMPLE = 15; // what a look shows
const PACE_MS = 1300; // Hunter allows 50 Discover calls a minute
const urlOf = () => testEndpoint(process.env, 'NEUMA_LEAD_SOURCE_HUNTER', HUNTER_URL);
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export const HUNTER_INDUSTRIES = Object.freeze([...INDUSTRIES]);
const INDUSTRY_OF = new Map(HUNTER_INDUSTRIES.map((name) => [name.toLowerCase(), name]));
const wordsOf = (text) => String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/** pure — Hunter's own name for an industry (any case), or null. */
export const hunterIndustry = (name) => INDUSTRY_OF.get(String(name ?? '').trim().toLowerCase()) ?? null;

/** pure — Hunter's industry names sharing the most words with a name it does not know (at most 5). */
export const nearestIndustries = (name) => {
  const asked = wordsOf(name);
  return HUNTER_INDUSTRIES.map((n) => [n, wordsOf(n).filter((w) => asked.some((a) => w.startsWith(a) || a.startsWith(w))).length])
    .filter(([, shared]) => shared > 0).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).slice(0, 5).map(([n]) => n);
};

/** pure — why these industries cannot be asked of Hunter, with the names it would take instead; null when they all can. */
export const industryRefusal = (names = []) => {
  const unknown = names.filter((n) => !hunterIndustry(n));
  if (!unknown.length) return null;
  return unknown.map((n) => {
    const near = nearestIndustries(n);
    return `"${n}" is not one of Hunter's industries${near.length ? ` — nearest: ${near.join('; ')}` : ''}`;
  }).join('. ');
};

/** pure — the being's own filters (industries, keywords any/all, exclude), or null when it gave none and Hunter's reading of its words is to be used. */
export const ownFilters = ({ industries = [], keywords = [], exclude = [], match = 'any' } = {}) => {
  if (!industries.length && !keywords.length) return null;
  return {
    ...(industries.length ? { industry: { include: industries.map(hunterIndustry).filter(Boolean) } } : {}),
    ...(keywords.length || exclude.length ? { keywords: {
      ...(keywords.length ? { include: keywords } : {}), ...(exclude.length ? { exclude } : {}), match: match === 'all' ? 'all' : 'any',
    } } : {}),
  };
};

/** pure — the filters one Discover call is asked with: the being's own or Hunter's reading, narrowed to the audience's countries and one or more sizes. */
export const discoverFilters = ({ filters = {}, countries = [], sizes = [] } = {}) => ({
  ...filters,
  ...(countries.length ? { headquarters_location: { include: countries.map((c) => ({ country: String(c).toUpperCase() })) } } : {}),
  ...(sizes.length ? { headcount: sizes } : {}),
});

/** pure — a search in words the being can read back: what was asked of Hunter. */
export const filtersWords = (filters = {}) => [
  filters.industry?.include?.length ? `industry: ${filters.industry.include.join(' or ')}` : null,
  filters.keywords?.include?.length ? `keywords (${filters.keywords.match ?? 'all'}): ${filters.keywords.include.join(', ')}` : null,
  filters.keywords?.exclude?.length ? `excluding: ${filters.keywords.exclude.join(', ')}` : null,
  filters.headcount?.length ? `sizes: ${filters.headcount.join(', ')}` : null,
].filter(Boolean).join(' · ') || 'no filter';

/** pure — how many addresses Hunter holds for a company, in words: the number its own screen shows, then who they are. */
export const heldWords = (n) => {
  const total = Number(n?.total) || (Number(n?.personal) || 0) + (Number(n?.generic) || 0);
  if (!total) return 'Hunter holds no address there';
  const people = n.personal ? `${n.personal.toLocaleString('en-US')} named ${n.personal === 1 ? 'person' : 'people'}` : 'no named person';
  return `${total.toLocaleString('en-US')} address${total === 1 ? '' : 'es'} at Hunter (${people}${n.generic ? `, ${n.generic.toLocaleString('en-US')} general` : ''})`;
};

// pure — a candidate's line of what the list says: its size when known, and what Hunter holds there.
const signalOf = (size, held) => [size ? `${size} people` : null, heldWords(held)].filter(Boolean).join(' · ');

/** pure — one Discover answer as candidate rows; a row with no usable domain is left out. */
export const companiesOfDiscover = (answer, size = null) => (Array.isArray(answer?.data) ? answer.data : []).flatMap((c) => {
  const domain = String(c?.domain ?? '').trim().toLowerCase();
  if (!HOST.test(domain)) return [];
  const held = { personal: Number(c.emails_count?.personal) || 0, generic: Number(c.emails_count?.generic) || 0, total: Number(c.emails_count?.total) || 0 };
  return [{
    source: 'hunter-discover', domain, name: String(c.organization || domain).slice(0, 80), symbol: null, description: '', site: `https://${domain}`, twitter: null, telegram: null, categories: [],
    size: SIZES.includes(size) ? size : null, hunterEmails: held, signal: signalOf(SIZES.includes(size) ? size : null, held), sourceUrl: `https://${domain}`,
  }];
});

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('interrupted')); }, { once: true });
});

// impure — one free Discover call, or a thrown reason in words.
const discover = async (body, { apiKey, signal }) => {
  const res = await fetch(`${urlOf()}/discover?api_key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal });
  if (res.ok) return res.json();
  const said = await res.json().then((j) => j?.errors?.[0]?.details).catch(() => null);
  throw new Error({ 401: 'Hunter refused the key — check it in SETTINGS, API, Lead data', 429: 'Hunter is busy (its limit of calls a minute) — gather again in a minute' }[res.status] ?? `Hunter answered ${res.status}${said ? `: ${said}` : ''}`);
};

/** pure — an audience in words Hunter's assistant can read as a search: what makes a company fit it. */
export const audienceWords = (segment) => String((segment?.positiveCriteria?.length ? segment.positiveCriteria.join('; ') : segment?.offer) || segment?.name || '').slice(0, 300);

// impure — what a search asks Hunter. EVERY search of an audience starts from Hunter's own assistant
// reading it (Design note, 2026-11-16: […]):
// the seat's words, else the audience's own signs of fit, read once (free, and counted on the
// operator's key as an AI search). The seat's own aim — keywords, industries, exclusions — then
// stands over that reading where it gave one; Hunter's reading fills the rest.
const searchOf = async (query, { segment = null, apiKey, signal, onProgress = () => {} }) => {
  const own = ownFilters(query);
  const words = (String(query.words ?? '').trim() || audienceWords(segment)).slice(0, 300);
  if (!words) return { filters: own ?? {}, matched: 0, read: false };
  onProgress('asking Hunter what this audience means as a search');
  const answer = await discover({ query: words, limit: 1 }, { apiKey, signal });
  const reading = answer?.meta?.filters ?? {};
  return { filters: own ? { ...reading, ...own } : reading, matched: Number(answer?.meta?.results) || 0, read: true, words };
};

/**
 * Gather up to `count` companies the house has not seen from Hunter's free company search. impure. Never throws.
 * @param {{count?: number, known?: {domains: Set<string>}, segment?: object, query?: {words?: string, industries?: string[], sizes?: string[], countries?: string[]},
 *   apiKey: string, paceMs?: number, signal?: AbortSignal, onProgress?: (words: string) => void}} opts
 * @returns {Promise<{candidates: object[], looked: number, stopped: ?string, matched?: number}>}
 */
export const gatherHunterDiscover = async ({ count = DISCOVER_MAX, known = { domains: new Set() }, segment = null, query = {}, apiKey, paceMs = PACE_MS, signal, onProgress = () => {} } = {}) => {
  const want = Math.min(Math.max(parseInt(count, 10) || DISCOVER_MAX, 1), DISCOVER_MAX);
  const candidates = [];
  let looked = 0;
  let matched = 0;
  try {
    if (!apiKey) return { candidates, looked, stopped: 'no Hunter key is attached — the operator adds one in SETTINGS, API, Lead data (a free Hunter account is enough: this search spends no credits)' };
    const badSize = (query.sizes ?? []).find((s) => !SIZES.includes(s));
    if (badSize) return { candidates, looked, stopped: `"${badSize}" is not a size — sizes are: ${SIZES.join(', ')}` };
    const search = await searchOf(query, { segment, apiKey, signal, onProgress });
    const { filters } = search;
    matched = search.matched;
    const countries = query.countries?.length ? query.countries : segment?.countries ?? [];
    const sizes = query.sizes?.length ? query.sizes : SIZES;
    const take = (answer, size) => {
      for (const row of companiesOfDiscover(answer, size)) {
        looked += 1;
        const had = candidates.find((c) => c.domain === row.domain);
        // Seen already in a wider search: a size search says how big it is.
        if (had) { if (size && !had.size) Object.assign(had, { size, signal: signalOf(size, had.hunterEmails) }); continue; }
        if (candidates.length < want && !known.domains.has(row.domain)) candidates.push(row);
      }
    };
    // THE WIDE NET: every search a free plan answers with its own first hundred — the search as Hunter
    // ranks it (its screen's list), each size, then each of the audience's countries by size.
    const searches = [
      { words: 'as Hunter ranks it', sizes, countries },
      ...sizes.map((size) => ({ words: `size ${size}`, sizes: [size], countries })),
      ...(countries.length > 1 ? countries.flatMap((country) => sizes.map((size) => ({ words: `${country}, size ${size}`, sizes: [size], countries: [country] }))) : []),
    ];
    for (const [i, search] of searches.entries()) {
      if (candidates.length >= want) break;
      if (i) await wait(paceMs, signal);
      const page = await discover({ ...discoverFilters({ filters, countries: search.countries, sizes: search.sizes }), limit: PER_CALL }, { apiKey, signal });
      take(page, search.sizes.length === 1 ? search.sizes[0] : null);
      onProgress(`${candidates.length} companies so far — ${i + 1} of ${searches.length} searches, ${search.words} (${(Number(page?.meta?.results) || 0).toLocaleString('en-US')} match there)`);
    }
    // The most addresses first, as Hunter's own screen orders them.
    candidates.sort((a, b) => (b.hunterEmails.total || 0) - (a.hunterEmails.total || 0));
    return { candidates, looked, matched, asked: filtersWords(filters), stopped: null };
  } catch (err) {
    return { candidates, looked, matched, stopped: err.message };
  }
};

/**
 * DISCOVER LOOKS FIRST: one free call showing what a search would bring — how it was asked of Hunter,
 * how many companies match in the audience's countries, and the first of them — nothing kept. impure.
 * Never throws.
 * @returns {Promise<{ok: true, asked: string, read: boolean, matched: number, sample: object[]}|{ok: false, reason: string}>}
 */
export const previewDiscover = async ({ query = {}, segment = null, apiKey, signal } = {}) => {
  try {
    if (!apiKey) return { ok: false, reason: 'no Hunter key is attached — the operator adds one in SETTINGS, API, Lead data (a free Hunter account is enough: this search spends no credits)' };
    const search = await searchOf(query, { segment, apiKey, signal });
    const countries = query.countries?.length ? query.countries : segment?.countries ?? [];
    const asked = discoverFilters({ filters: search.filters, countries, sizes: query.sizes ?? [] });
    const page = await discover({ ...asked, limit: SAMPLE }, { apiKey, signal });
    return { ok: true, asked: filtersWords(asked), read: search.read, matched: Number(page?.meta?.results) || 0, sample: companiesOfDiscover(page) };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
};

// What the operator's Hunter account holds is asked at most once in five minutes: the settings row and the
// seat's briefing both read it, and it changes only when a lookup is spent.
const ACCOUNT_FRESH_MS = 5 * 60_000;
let account = null;

/** pure — Hunter's own account answer as the plan's name and its credits for the month. */
export const accountOf = (answer) => {
  const credits = answer?.data?.requests?.credits;
  return answer?.data && credits ? { plan: String(answer.data.plan_name ?? '').trim() || 'unknown', used: Number(credits.used) || 0, available: Number(credits.available) || 0, resetsOn: answer.data.reset_date ?? null } : null;
};

/** pure — the account in the operator's words. */
export const accountWords = (a) => (a ? `HUNTER · ${a.plan.toUpperCase()} PLAN · ${Math.max(0, a.available - a.used)} OF ${a.available} CREDITS LEFT THIS MONTH · ITS COMPANY SEARCH SPENDS NONE` : null);

/** impure — the operator's Hunter plan and credits (GET /account, free), or null when it cannot be read. Never throws. */
export const hunterAccount = async (apiKey, { now = Date.now() } = {}) => {
  if (!apiKey) return null;
  if (account && account.key === apiKey && now - account.at < ACCOUNT_FRESH_MS) return account.value;
  try {
    const res = await fetch(`${urlOf()}/account?api_key=${encodeURIComponent(apiKey)}`, { headers: { accept: 'application/json' } });
    const value = res.ok ? accountOf(await res.json()) : null;
    account = { key: apiKey, at: now, value };
    return value;
  } catch {
    return null;
  }
};
