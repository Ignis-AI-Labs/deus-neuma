// DISCOVERY FROM YOUR FITS — the companies a confirmed fit itself names on its own pages.
//
// What the sales bench measured (2026-11-22): a keyword search finds an audience by a LABEL. The house's own company
// index matches a name or an industry tag and surfaced 0 to 3 of the 8 to 10 companies a good search should find; a
// paid keyword search gave 47 fits in 100 on its first pages and 17 in 100 five pages deep, once the best matches
// were already held. Meanwhile the best signal the house has is sitting in its own records: every company it has
// CONFIRMED as a fit. A fund's portfolio page names the projects it backed; a project's backers page names the funds
// behind it; an ecosystem or partners page names the companies around it. Those are companies of the same world,
// named by someone the house already judged to be the right kind — and reading them is free and never runs out,
// because every new fit names more.
//
// So: for each fit of an audience (the one being gathered for, or another the operator names — a funds audience's
// portfolios feed a projects audience, and the other way round), its home page is read, the pages it links to that
// LIST companies (portfolio, investments, companies, backers, investors, partners, ecosystem) are read, and every
// company those pages link OUT to is taken as a candidate, with who named it and where. Nothing is judged here: a
// lead run screens each one from its own page, exactly as it screens any other candidate.
// The link reading is PURE; the gather is impure (the house's records, the network).

import { normalizeDomain } from './prospect-shape.js';
import { definingFit } from './lead-run-shape.js';
import { guardedPage } from './company-reader.js';
import { readProspects, readSegments } from './sales-store.js';

export const FITS_READ_MAX = 40;        // fits read in one gather
export const LIST_PAGES_A_FIT = 3;      // pages of one fit that list companies
export const NAMED_A_FIT = 80;          // companies taken from one fit
export const FROM_FITS_MAX = 500;
const LISTS = /(portfolio|investments?|companies|backers|backed|investors|partners|ecosystem|projects|network|clients|customers|integrations)/i;
// Where a link goes that is never a company the fit names: networks, tools, stores, its own plumbing.
const NOT_A_COMPANY = /(^|\.)(x|twitter|linkedin|facebook|instagram|youtube|youtu|tiktok|threads|medium|substack|mirror|github|gitlab|discord|discordapp|t|telegram|reddit|google|goo|apple|microsoft|notion|typeform|calendly|docsend|airtable|hubspot|mailchimp|linktr|bit|crunchbase|pitchbook|angel|wellfound|wikipedia|cloudflare|vercel|webflow|wix|squarespace|wordpress|w3|schema|gstatic|googleapis|jsdelivr|unpkg|cookiebot|onetrust|zoom|spotify|whatsapp|vimeo|coingecko|coinmarketcap|etherscan|basescan|defillama|dexscreener|getro|workable|greenhouse|lever|ashbyhq|website-files|browsehappy|luma|lu|eventbrite|docusign|dropbox|box|slack|figma|canva|shopify|stripe|paypal|amazon|amazonaws|cloudfront|youtube-nocookie|cryptocurrencyjobs|seiinvestorportal|altareturn|sharesecurely)\.[a-z.]+$/i;
const attr = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(2).find((v) => v !== undefined) ?? null;
const text = (html) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
// A company is taken by its SITE, not by its app, its docs or its jobs board: app.acme.xyz, docs.acme.xyz and
// jobs.acme.xyz are all acme.xyz (and acme.co.uk keeps its three parts).
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);
const siteOf = (host) => {
  const labels = String(host ?? '').toLowerCase().split('.').filter(Boolean);
  const keep = labels.length > 2 && labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2)) ? 3 : 2;
  return normalizeDomain(labels.slice(-keep).join('.'));
};
// The same firm under another ending (dragonfly.com, dragonfly.xyz; blockchaincapital.com, blockchain.capital) names itself, not a company.
const brand = (domain) => String(domain).replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '');
const sameFirm = (a, b) => a === b || brand(a) === brand(b) || brand(a) === String(b).replace(/[^a-z0-9]/g, '') || brand(b) === String(a).replace(/[^a-z0-9]/g, '');

/**
 * pure — the pages of a company's own site, linked from one of its pages, that LIST other companies.
 * @returns {string[]} absolute URLs, the likeliest first, at most LIST_PAGES_A_FIT
 */
export const listPages = (html, pageUrl) => {
  const here = new URL(pageUrl);
  const found = new Map();
  for (const [, tag, inner] of String(html ?? '').matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)) {
    const href = attr(tag, 'href');
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let url;
    try { url = new URL(href, here); } catch { continue; }
    if (url.hostname !== here.hostname || !/^https?:$/.test(url.protocol) || /\.(pdf|png|jpe?g|svg|zip)$/i.test(url.pathname)) continue;
    url.hash = '';
    if (url.pathname === here.pathname || !LISTS.test(`${url.pathname} ${text(inner)}`)) continue;
    // A page named for the list ("/portfolio") before one that only mentions it in its link's words.
    if (!found.has(url.href)) found.set(url.href, LISTS.test(url.pathname) ? 0 : 1);
  }
  return [...found].sort((a, b) => a[1] - b[1] || a[0].length - b[0].length).slice(0, LIST_PAGES_A_FIT).map(([href]) => href);
};

/**
 * pure — the companies a page links out to: each by its own site, with the words of its link.
 * @param {string} html
 * @param {string} pageUrl
 * @returns {Array<{domain: string, name: string}>} each company once, in the page's order, at most NAMED_A_FIT
 */
export const namedOn = (html, pageUrl) => {
  const own = siteOf(new URL(pageUrl).hostname);
  const out = new Map();
  for (const [, tag, inner] of String(html ?? '').matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)) {
    const href = attr(tag, 'href');
    if (!href || !/^https?:\/\//i.test(href)) continue;
    let url;
    try { url = new URL(href); } catch { continue; }
    const domain = siteOf(url.hostname);
    if (!domain || sameFirm(domain, own) || NOT_A_COMPANY.test(domain)) continue;
    const words = text(inner) || text(attr(tag, 'aria-label') ?? '') || text(/alt\s*=\s*"([^"]*)"/i.exec(inner)?.[1] ?? '');
    if (!out.has(domain)) out.set(domain, words && words.length <= 60 && !/^(visit|website|learn more|read more|view|link|here|↗|→)$/i.test(words) ? words : domain.split('.')[0]);
    if (out.size >= NAMED_A_FIT) break;
  }
  return [...out].map(([domain, name]) => ({ domain, name }));
};

/**
 * Gather up to `count` companies the house has not seen, from the pages of its own confirmed fits. Never throws.
 * @param {{count?: number, known?: {domains: Set<string>}, wallet: string, segment: object, from?: ?string, fetchPage?: Function, signal?: AbortSignal, onProgress?: Function}} o
 *   segment: the audience being gathered for · from: the audience whose fits are read (default: the same one)
 * @returns {Promise<{candidates: object[], looked: number, stopped: ?string, asked: string}>} looked: fits read
 */
export const gatherFromFits = async ({ count = 100, known = { domains: new Set() }, wallet, segment, from = null, fetchPage = guardedPage, signal, onProgress = () => {} } = {}) => {
  const want = Math.min(Math.max(parseInt(count, 10) || 100, 1), FROM_FITS_MAX);
  try {
    const sourceId = from || segment?.id;
    const source = from ? (await readSegments(wallet)).find((s) => s.id === from) : segment;
    if (!source) return { candidates: [], looked: 0, stopped: `"${from}" is not one of this house's audiences`, asked: '' };
    const asked = `the companies named by the fits of "${source.name}"`;
    // The strongest fits first: what a firm the house is surest of names is likeliest to be its kind.
    const fits = (await readProspects(wallet)).filter((p) => p.segmentId === sourceId && p.stage !== 'dropped' && definingFit(p))
      .sort((a, b) => (b.fit?.[0]?.score ?? 0) - (a.fit?.[0]?.score ?? 0) || String(b.foundAt ?? '').localeCompare(String(a.foundAt ?? ''))).slice(0, FITS_READ_MAX);
    if (!fits.length) return { candidates: [], looked: 0, stopped: `"${source.name}" has no confirmed fit yet to read from: run it first, or name another audience (from: its id) whose fits name this kind of company`, asked };
    const taken = new Map();
    let read = 0;
    for (const fit of fits) {
      if (taken.size >= want || signal?.aborted) break;
      onProgress(`reading what ${fit.name ?? fit.domain} names`);
      const home = await fetchPage(`https://${fit.domain}/`, { signal }).catch(() => null);
      if (!home?.ok) continue;
      read += 1;
      const pages = [{ url: home.url ?? `https://${fit.domain}/`, html: home.html }];
      for (const url of listPages(home.html, pages[0].url)) { const got = await fetchPage(url, { signal }).catch(() => null); if (got?.ok) pages.push({ url: got.url ?? url, html: got.html }); }
      // The pages that LIST companies first; its home page last (it names a few, among much else).
      for (const page of [...pages.slice(1), pages[0]]) {
        for (const named of namedOn(page.html, page.url)) {
          if (taken.size >= want) break;
          if (known.domains.has(named.domain) || taken.has(named.domain)) continue;
          taken.set(named.domain, { source: 'from-fits', domain: named.domain, name: String(named.name).slice(0, 80), symbol: null, description: '', site: `https://${named.domain}`, twitter: null, telegram: null, categories: [],
            signal: `named by ${fit.name ?? fit.domain}, a confirmed fit of "${source.name}"`, sourceUrl: /^https:/.test(page.url) ? page.url : `https://${fit.domain}/`, via: fit.domain });
        }
      }
    }
    return { candidates: [...taken.values()], looked: read, stopped: taken.size ? null : `the ${read} fit(s) read name no company the house does not already hold`, asked };
  } catch (err) {
    return { candidates: [], looked: 0, stopped: err.message, asked: '' };
  }
};
