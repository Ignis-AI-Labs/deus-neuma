// company-entity — what a company IS, read from its own words, never from its name (2026-11-19: […], a Thai robotics company, was scored a fit for a FUNDING audience because "Ventures" is in its name, and a
// raise email was staged to a company that will never write a SAFE; Founder: […]).
//
// One record a company (by domain), kept for good beside the research (research-store.js), for every campaign:
// its type, a quote from its own site, and that page. For a funding campaign the type decides: an investor is written
// to; a product company, a service company or anything else is NO FIT there — its record stays, and it may suit a
// customer campaign. THE EVIDENCE RULE: an investor's quote must say it invests — […], "portfolio", "fund",
// "AUM", "LPs", […], "seed" — with the company's own name taken out first (a name with "Ventures", "Capital",
// "Holdings" or "Partners" in it is not evidence), on a page of its OWN site. The page is read again here and the
// quote must stand on it; a page that turns readers away leaves the record standing, marked unchecked, with why.
// Pure, but for verifyQuote (the page read).

import { guardedPage } from './company-reader.js';
import { htmlToText } from '../html-to-text.js';

export const ENTITY_TYPES = Object.freeze({
  'vc-fund': { investor: true, words: 'a venture capital fund' },
  'corporate-vc': { investor: true, words: 'a company\'s venture arm' },
  'pe-fund': { investor: true, words: 'a private equity fund' },
  'family-office': { investor: true, words: 'a family office that invests' },
  'angel-syndicate': { investor: true, words: 'an angel group or syndicate' },
  accelerator: { investor: true, words: 'an accelerator that invests' },
  'grant-program': { investor: true, words: 'a grant program' },
  'product-company': { investor: false, words: 'a company that builds or sells a product' },
  'service-company': { investor: false, words: 'a company that sells a service' },
  other: { investor: false, words: 'something else' },
});
const EVIDENCE = /\b(we invest|invest(s|ing|ed)?|investments?|portfolio|funds?|fund (i|ii|iii|iv)|aum|assets under management|limited partners|lps?|we back|backs|backing|backed|pre-seed|seed|series a|venture capital|check sizes?|cheques?|grants?|cohorts?)\b/i;

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
/** pure — words as compared on a page: lowercase, letters and digits only, single spaces. */
const flat = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** pure — is this type one that invests. */
export const isInvestor = (entity) => Boolean(ENTITY_TYPES[entity?.entityType]?.investor);

/**
 * pure — a company's record, or a thrown reason naming every missing part at once.
 * @param {{domain: string, name?: string, entityType: string, quote: string, source: string}} f
 */
export const makeEntity = (f) => {
  const domain = clean(f?.domain, 200).toLowerCase().replace(/^www\./, '');
  const e = { domain, entityType: clean(f?.entityType, 30).toLowerCase(), quote: clean(f?.quote, 400), source: clean(f?.source, 500) };
  const host = hostOf(e.source);
  const name = clean(f?.name, 160);
  // The name is never evidence: taken out of the quote before it is read for investing words.
  const said = name ? flat(e.quote).replace(new RegExp(`\\b${flat(name).replace(/\s+/g, '\\s+')}\\b`, 'g'), ' ') : flat(e.quote);
  const problems = [
    ...(!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? ['domain: the company\'s own web domain'] : []),
    ...(!ENTITY_TYPES[e.entityType] ? [`entityType: what the company IS — one of ${Object.keys(ENTITY_TYPES).join(', ')}`] : []),
    ...(e.quote.length < 15 ? ['quote: its own words, copied from its site, that say what it does'] : []),
    ...(!/^https:\/\//.test(e.source) || !(host === domain || host.endsWith(`.${domain}`)) ? [`source: the https page on its OWN site (${domain || 'its domain'}) the quote is copied from`] : []),
    ...(ENTITY_TYPES[e.entityType]?.investor && e.quote.length >= 15 && !EVIDENCE.test(said)
      ? ['quote: for an investor, its own words must say it invests ("we invest", "portfolio", "fund", "AUM", "LPs", "we back", "seed") — its name is not evidence; if its site shows it builds or sells something, it is a product-company'] : []),
  ];
  if (problems.length) throw new Error(problems.join('; '));
  return Object.freeze(e);
};

/**
 * impure — the quote, looked for on its page. The page that says otherwise refuses it; one that cannot be read leaves
 * it standing, unchecked.
 * @returns {Promise<{ok: true, verified: boolean, why: ?string} | {ok: false, why: string}>}
 */
export const verifyQuote = async ({ source, quote }, { fetchPage = guardedPage, signal } = {}) => {
  const page = await fetchPage(source, { signal }).catch((err) => ({ ok: false, why: err.message }));
  if (!page?.ok) return { ok: true, verified: false, why: `the page could not be read to check the quote (${page?.why ?? 'no answer'})` };
  return flat(htmlToText(page.html, 200_000)).includes(flat(quote))
    ? { ok: true, verified: true, why: null }
    : { ok: false, why: `the quote is not on ${source} — copy its own words exactly from the page you read` };
};

/** pure — is this campaign one that raises money: its email plan says so, or its name or goal does. */
export const isFundingCampaign = (campaign) => {
  if (!campaign) return false;
  const p = campaign.emailPlan;
  const objective = p?.approved?.objective ?? p?.proposed?.objective ?? null;
  if (objective) return objective === 'funding';
  const said = `${campaign.name ?? ''} ${campaign.goal ?? ''}`;
  return /\b(funding|fundrais\w*|raise|raising|investors?|seed round|pre-seed)\b/i.test(said) || /\bSAFE\b/.test(said);
};

/** pure — the record in words, for the seat. */
export const entityWords = (e) => `${e.domain} is ${ENTITY_TYPES[e.entityType]?.words ?? e.entityType} ("${e.quote}", ${e.source}${e.verified === false ? `; NOT CHECKED: ${e.why}` : ''})`;

/** pure — why a funding campaign may not write to this company yet (no record, or not an investor), or null. */
export const entityRefusal = (entity, domain) => {
  if (!entity) return `say what ${domain} IS first, from its own site: sales/entity {domain: "${domain}", name, entityType, quote, source} — a funding campaign writes only to investors, and a name is not evidence`;
  return isInvestor(entity) ? null : `${entityWords(entity)} — NOT AN INVESTOR: no funding email to it; if it suits a customer campaign, place its lead there (sales/place)`;
};
