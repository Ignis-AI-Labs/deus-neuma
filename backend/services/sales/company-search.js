// PAID COMPANY SEARCH — DISCOVER through Tomba and Apollo, beside Hunter's free one (Design note, 2026-11-18: […]). Each gathers companies for an audience, the same candidate row every list source
// gives, and says what it spent: unlike Hunter's company search, these spend the operator's credits, so the gather
// runs under PAID LEAD DATA (lead-spend.js) and the search is kept with its cost (sales-store.js noteSearch).
//   tomba-discover   POST /reveal/search  page 1 {query}: Tomba reads the plain words into its own filters
//                    (meta.filters) and later pages are asked {filters, page}. 50 companies a page, 1 search credit a
//                    page that holds any. A free plan sees the first page only (a later page comes back as the
//                    first again), so a page that repeats ends the search. Each company says how many addresses
//                    Tomba holds there.
//   apollo-discover  POST /mixed_companies/search  keywords (q_organization_keyword_tags[]), the audience's
//                    countries (organization_locations[]), sizes (organization_num_employees_ranges[] "min,max").
//                    Up to 100 a page, 1 credit a page. Paid Apollo plans only (a free key is answered 403).
// Read from docs.tomba.io and docs.apollo.io on 2026-11-18. The shaping is PURE; the search is impure, never throws.

import { isWide } from './wide-search.js';
import process from 'node:process';
import { sourceText } from './source-text.js';
import { testEndpoint } from '../test-endpoint-door.js';
import { askJson, num } from './provider-call.js';
import { tombaAuth, TOMBA_URL, NO_SECRET } from './tomba-api.js';
import { APOLLO_URL } from './apollo-api.js';
import { audienceWords } from './hunter-discover.js';

export const TOMBA_PAGE = 50;
export const APOLLO_PAGE = 100;
export const PAID_SEARCH_MAX = 500;
const enc = encodeURIComponent;

/** pure — a bare domain from a site address or a domain: "https://www.acme.io/about" → "acme.io". */
export const bareDomain = (site) => {
  const raw = String(site ?? '').trim().toLowerCase();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^(www|app)\./, '') || null;
  } catch {
    return null;
  }
};

/** pure — how many pages a count asks for, and so the most credits a gather may spend. */
export const pagesFor = (count, perPage, max = PAID_SEARCH_MAX) => Math.max(1, Math.ceil(Math.min(Number(count) || perPage, max) / perPage));

const countryName = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(String(code).toUpperCase()) ?? code; } catch { return code; } };

/** pure — the plain words Tomba reads into its filters (8 to 100 characters): the being's words or the audience's own, the keywords, the places and sizes. */
export const tombaQuery = (query = {}, segment = null) => {
  const what = String(query.words || '').trim() || audienceWords(segment);
  const extra = [
    ...(query.keywords?.length ? [query.keywords.join(', ')] : []),
    ...((query.countries?.length ? query.countries : segment?.countries ?? []).length ? [`in ${(query.countries?.length ? query.countries : segment.countries).map(countryName).join(', ')}`] : []),
    ...(query.sizes?.length ? [`with ${query.sizes.join(' or ')} employees`] : []),
  ];
  const text = [what, ...extra].join(' ').replace(/\s+/g, ' ').trim();
  return text.length > 100 ? text.slice(0, 100).replace(/\s+\S*$/, '') : text;
};

/** pure — one Tomba company as a candidate row. */
export const candidateOfTomba = (c) => {
  const domain = bareDomain(c?.website_url ?? c?.domain);
  if (!domain || !c?.name) return null;
  const held = num(c.total_emails);
  return {
    source: 'tomba-discover', domain, name: sourceText(c.name, 120), description: sourceText(c.description, 400),
    size: sourceText(c.company_size, 20) || null, country: sourceText(c.country, 40) || null, industry: sourceText(c.industry, 80) || null,
    sourceUrl: `https://${domain}`, emailsAt: { tomba: held },
    signal: [c.industry, c.company_size ? `${c.company_size} people` : null, c.country, `${held} address${held === 1 ? '' : 'es'} at Tomba`].filter(Boolean).map((s) => sourceText(s, 80)).join(' · '),
  };
};

/** pure — one Apollo organization as a candidate row. */
export const candidateOfApollo = (o) => {
  const domain = bareDomain(o?.primary_domain ?? o?.website_url);
  if (!domain || !o?.name) return null;
  return {
    source: 'apollo-discover', domain, name: sourceText(o.name, 120), description: '', size: null, country: null,
    sourceUrl: `https://${domain}`,
    signal: [o.founded_year ? `founded ${o.founded_year}` : null, o.linkedin_url ? 'on LinkedIn' : null, 'from Apollo\'s company search'].filter(Boolean).join(' · '),
  };
};

// pure — Apollo's employee ranges from our sizes: "11-50" → "11,50", "10001+" → "10001,1000000".
const apolloRange = (size) => (/^(\d+)\+$/.test(size) ? `${size.slice(0, -1)},1000000` : String(size).replace('-', ','));

/** pure — the query string of one Apollo company search page. */
export const apolloSearchQuery = (query = {}, segment = null, page = 1) => {
  const tags = [...(query.keywords ?? []), ...(query.industries ?? [])];
  const places = (query.countries?.length ? query.countries : segment?.countries ?? []).map(countryName);
  return [
    ...tags.map((t) => `q_organization_keyword_tags[]=${enc(t)}`),
    ...places.map((p) => `organization_locations[]=${enc(p)}`),
    ...(query.sizes ?? []).map((s) => `organization_num_employees_ranges[]=${enc(apolloRange(s))}`),
    `page=${page}`, `per_page=${APOLLO_PAGE}`,
  ].join('&');
};

const fresh = (rows, known, seen) => rows.filter((c) => c && !known.domains.has(c.domain) && !seen.has(c.domain) && seen.add(c.domain));

/**
 * impure — companies from Tomba's search for an audience.
 * @returns {Promise<{candidates: object[], spent: number, matched: number, asked: string, stopped?: string}>}
 */
export const gatherTombaReveal = async ({ count = TOMBA_PAGE, known = { domains: new Set() }, segment = null, query = {}, apiKey, secret, signal, onProgress = () => {} } = {}) => {
  const headers = tombaAuth(apiKey, secret);
  const asked = tombaQuery(query, segment);
  if (!headers) return { candidates: [], spent: 0, matched: 0, asked, stopped: NO_SECRET };
  if (asked.length < 8) return { candidates: [], spent: 0, matched: 0, asked, stopped: 'Tomba needs at least a short sentence (8 characters) saying what kind of company' };
  const base = testEndpoint(process.env, 'NEUMA_LEAD_SOURCE_TOMBA', TOMBA_URL);
  const candidates = [];
  const seen = new Set();
  let spent = 0; let matched = 0; let filters = null; let first = null;
  try {
    for (let page = 1; page <= pagesFor(count, TOMBA_PAGE); page += 1) {
      onProgress(`Tomba, page ${page}`);
      const got = await askJson(`${base}/reveal/search`, { method: 'POST', headers, signal, name: 'Tomba', body: page === 1 ? { query: asked } : { filters, page } });
      const rows = got?.data?.companies ?? [];
      if (rows.length) spent += 1;
      if (page === 1) { filters = got?.meta?.filters ?? null; matched = num(got?.meta?.total); first = rows.map((c) => c.website_url).join('|'); }
      else if (rows.map((c) => c.website_url).join('|') === first) return { candidates, spent, matched, asked, stopped: 'this Tomba plan sees the first page only' };
      // Too wide to be an audience's (wide-search.js): nothing is kept and no further page is paid for.
      if (isWide(matched)) return { candidates: [], spent, matched, asked, wide: true };
      candidates.push(...fresh(rows.map(candidateOfTomba), known, seen));
      if (!rows.length || !filters || page >= num(got?.meta?.pages)) break;
    }
    return { candidates: candidates.slice(0, Number(count) || TOMBA_PAGE), spent, matched, asked };
  } catch (err) {
    return { candidates, spent, matched, asked, stopped: err.message };
  }
};

/** pure — the terms Apollo's company search is asked with, as they are kept on a search's record. */
export const apolloAsked = (query = {}) => [...(query.keywords ?? []), ...(query.industries ?? [])].join(', ');

/**
 * impure — companies from Apollo's company search for an audience (paid Apollo plans only).
 * @returns {Promise<{candidates: object[], spent: number, matched: number, asked: string, stopped?: string}>}
 */
export const gatherApolloCompanies = async ({ count = APOLLO_PAGE, known = { domains: new Set() }, segment = null, query = {}, apiKey, signal, onProgress = () => {}, startPage = 1 } = {}) => {
  const asked = [...(query.keywords ?? []), ...(query.industries ?? [])].join(', ');
  if (!asked) return { candidates: [], spent: 0, matched: 0, asked, stopped: 'Apollo searches companies by keywords — give keywords (phrases such as "defi", "market making") or industries' };
  const base = testEndpoint(process.env, 'NEUMA_LEAD_SOURCE_APOLLO', APOLLO_URL);
  const candidates = [];
  const seen = new Set();
  let spent = 0; let matched = 0;
  try {
    // It continues where the house left this search (search-memory.js): the pages before startPage were taken already.
    const from = Math.max(1, parseInt(startPage, 10) || 1);
    for (let page = from; page < from + pagesFor(count, APOLLO_PAGE); page += 1) {
      onProgress(`Apollo, page ${page}`);
      const got = await askJson(`${base}/mixed_companies/search?${apolloSearchQuery(query, segment, page)}`, { method: 'POST', headers: { 'x-api-key': apiKey }, signal, name: 'Apollo' });
      spent += 1;
      const rows = got?.organizations ?? [];
      if (page === from) matched = num(got?.pagination?.total_entries);
      // Too wide to be an audience's (wide-search.js): nothing is kept and no further page is paid for.
      if (isWide(matched)) return { candidates: [], spent, matched, asked, wide: true, pages: spent, fromPage: from };
      candidates.push(...fresh(rows.map(candidateOfApollo), known, seen));
      if (rows.length < APOLLO_PAGE || page >= num(got?.pagination?.total_pages)) break;
    }
    return { candidates: candidates.slice(0, Number(count) || APOLLO_PAGE), spent, matched, asked, pages: spent, fromPage: from };
  } catch (err) {
    return { candidates, spent, matched, asked, stopped: err.message };
  }
};
