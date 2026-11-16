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
// The shaping is PURE; the gather is impure (network), never throws.

import process from 'node:process';
import { HUNTER_URL } from './lead-providers.js';
import { SIZES } from './company-index.js';

export const DISCOVER_MAX = 500;
const PER_CALL = 100;
const PACE_MS = 1300; // Hunter allows 50 Discover calls a minute
const urlOf = () => process.env.NEUMA_LEAD_SOURCE_HUNTER || HUNTER_URL;
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** pure — the filters one Discover call is asked with: Hunter's own reading of the words, narrowed to the audience's countries and one or more sizes. */
export const discoverFilters = ({ filters = {}, countries = [], sizes = [], industries = [] } = {}) => ({
  ...filters,
  ...(countries.length ? { headquarters_location: { include: countries.map((c) => ({ country: String(c).toUpperCase() })) } } : {}),
  ...(sizes.length ? { headcount: sizes } : {}),
  ...(industries.length ? { industry: { include: industries } } : {}),
});

/** pure — how many addresses Hunter holds for a company, in words. */
export const heldWords = (n) => (n.personal ? `Hunter holds ${n.personal} named ${n.personal === 1 ? 'person' : 'people'} there${n.generic ? ` and ${n.generic} general address${n.generic === 1 ? '' : 'es'}` : ''}`
  : n.generic ? `Hunter holds no named person there, only ${n.generic} general address${n.generic === 1 ? '' : 'es'}` : 'Hunter holds no address there');

/** pure — one Discover answer as candidate rows; a row with no usable domain is left out. */
export const companiesOfDiscover = (answer, size = null) => (Array.isArray(answer?.data) ? answer.data : []).flatMap((c) => {
  const domain = String(c?.domain ?? '').trim().toLowerCase();
  if (!HOST.test(domain)) return [];
  const held = { personal: Number(c.emails_count?.personal) || 0, generic: Number(c.emails_count?.generic) || 0 };
  return [{
    source: 'hunter-discover', domain, name: String(c.organization || domain).slice(0, 80), symbol: null, description: '', site: `https://${domain}`, twitter: null, telegram: null, categories: [],
    size: SIZES.includes(size) ? size : null, hunterEmails: held, signal: [size ? `${size} people` : null, heldWords(held)].filter(Boolean).join(' · '), sourceUrl: `https://${domain}`,
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

/**
 * Gather up to `count` companies the house has not seen from Hunter's free company search. impure. Never throws.
 * @param {{count?: number, known?: {domains: Set<string>}, segment?: object, query?: {words?: string, industries?: string[], sizes?: string[], countries?: string[]},
 *   apiKey: string, paceMs?: number, signal?: AbortSignal, onProgress?: (words: string) => void}} opts
 * @returns {Promise<{candidates: object[], looked: number, stopped: ?string, matched?: number}>}
 */
export const gatherHunterDiscover = async ({ count = PER_CALL, known = { domains: new Set() }, segment = null, query = {}, apiKey, paceMs = PACE_MS, signal, onProgress = () => {} } = {}) => {
  const want = Math.min(Math.max(parseInt(count, 10) || PER_CALL, 1), DISCOVER_MAX);
  const candidates = [];
  let looked = 0;
  let matched = 0;
  try {
    if (!apiKey) return { candidates, looked, stopped: 'no Hunter key is attached — the operator adds one in SETTINGS, API, Lead data (a free Hunter account is enough: this search spends no credits)' };
    const badSize = (query.sizes ?? []).find((s) => !SIZES.includes(s));
    if (badSize) return { candidates, looked, stopped: `"${badSize}" is not a size — sizes are: ${SIZES.join(', ')}` };
    // The words once, in Hunter's own reading (free): its assistant answers with the filters it understood.
    onProgress('asking Hunter what your words mean as a search');
    const read = await discover({ query: String(query.words).slice(0, 300), limit: 1 }, { apiKey, signal });
    const filters = read?.meta?.filters ?? {};
    matched = Number(read?.meta?.results) || 0;
    const countries = query.countries?.length ? query.countries : segment?.countries ?? [];
    const take = (answer, size) => {
      for (const row of companiesOfDiscover(answer, size)) {
        looked += 1;
        if (candidates.length < want && !known.domains.has(row.domain) && !candidates.some((c) => c.domain === row.domain)) candidates.push(row);
      }
    };
    // One search a size: each has its own first hundred. The sizes asked for, else every size, smallest first.
    for (const size of query.sizes?.length ? query.sizes : SIZES) {
      if (candidates.length >= want) break;
      await wait(paceMs, signal);
      const page = await discover({ ...discoverFilters({ filters, countries, sizes: [size], industries: query.industries ?? [] }), limit: PER_CALL }, { apiKey, signal });
      take(page, size);
      onProgress(`${candidates.length} of ${want} found — size ${size} searched (${(Number(page?.meta?.results) || 0).toLocaleString('en-US')} match there)`);
    }
    return { candidates, looked, matched, stopped: null };
  } catch (err) {
    return { candidates, looked, matched, stopped: err.message };
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
