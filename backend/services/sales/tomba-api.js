// TOMBA — the same steps Hunter serves, through the operator's own Tomba key and secret (Design note, 2026-11-18: […]). Read from docs.tomba.io on 2026-11-18. Every call sends X-Tomba-Key and X-Tomba-Secret.
//   GET  /domain-search?domain=&type=personal&limit=10[&department=…]  people at a company: 1 search credit per 10
//        of limit, charged only when an address comes back (a repeat inside the usage window is free)
//   GET  /email-finder?domain=&full_name=     one named person: 1 search credit, only when an address comes back
//        with a status other than unknown
//   GET  /email-verifier?email=               does an address exist: 1 VERIFICATION credit (its own balance), none
//        for disposable or unknown; the status is at data.email.status, webmail a flag beside it
//   GET  /me                                  free: the plan and both balances left
//   POST /reveal/search {query|filters, page} companies from plain words: 50 a page, 1 search credit a page that
//        holds any (company-search.js); a free plan sees the first page only
// The parsing is PURE; every call is impure and never throws.

import process from 'node:process';
import { sourceText } from './source-text.js';
import { topFirst } from './top-first.js';
import { testEndpoint } from '../test-endpoint-door.js';
import { askJson, answer, num, https, profileUrl, whole } from './provider-call.js';

export const TOMBA_URL = 'https://api.tomba.io/v1';
export const NO_SECRET = 'Tomba needs both its API key and its secret — add the secret under SETTINGS, API, Lead data, Tomba';
const urlOf = () => testEndpoint(process.env, 'NEUMA_LEAD_SOURCE_TOMBA', TOMBA_URL);
const NAME = 'Tomba';
const enc = encodeURIComponent;

/** pure — the two headers, from the two rows (or the older `key:secret` in one), or null when one is missing. */
export const tombaAuth = (apiKey, savedSecret) => {
  const [key, joined] = String(apiKey ?? '').split(':').map((s) => s.trim());
  const secret = String(savedSecret ?? '').trim() || joined;
  return key && secret ? { 'X-Tomba-Key': key, 'X-Tomba-Secret': secret } : null;
};

/**
 * pure — Tomba's people at a domain, the same law as Hunter's: a name, a role, an address, and where it stands — a
 * public page it was seen on, or (with none) Tomba's own confirmation that it exists and the person's profile. Top first.
 * @returns {{people: object[], left: number}} left: what Tomba returned that cannot be stood behind
 */
export const peopleOfTomba = (answer) => {
  const rows = (answer?.data?.emails ?? []).map((e) => {
    const page = (e.sources ?? []).map((s) => https(s?.uri)).find(Boolean) ?? null;
    const checked = sourceText(e.verification?.status, 40) || null;
    const linkedin = profileUrl(e.linkedin);
    return {
      name: sourceText(e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' '), 120),
      role: sourceText(e.position, 120),
      email: sourceText(e.email, 254).toLowerCase(),
      confidence: num(e.score),
      sourceUrl: page ?? (checked === 'valid' ? linkedin : null),
      basis: page ? 'published' : 'verified',
      seniority: sourceText(e.seniority, 40) || null, department: sourceText(e.department, 40) || null, checked, linkedin,
      decisionMaker: e.seniority === 'executive',
    };
  });
  const people = topFirst(whole(rows));
  return { people, left: rows.length - people.length };
};

/**
 * impure — the people at a company. THE TOP FIRST: its executives and management are asked for first (Tomba has no
 * decision-maker flag; its department is the nearest), everyone named only when it holds none there. A search that
 * returns nobody costs nothing.
 * @returns {Promise<{ok: true, people: object[], spent: number, left: number, deciders: boolean} | {ok: false, detail: string}>}
 */
export const tombaContacts = ({ domain, apiKey, secret, baseUrl = urlOf(), signal }) => answer(async () => {
  const headers = tombaAuth(apiKey, secret);
  if (!headers) return { ok: false, detail: NO_SECRET };
  const search = (extra) => askJson(`${baseUrl}/domain-search?domain=${enc(domain)}&type=personal&limit=10${extra}`, { headers, signal, name: NAME });
  const top = await search('&department=executive,management');
  const got = (top?.data?.emails ?? []).length ? top : await search('');
  const spent = [top, got === top ? null : got].filter((a) => (a?.data?.emails ?? []).length).length;
  return { ok: true, ...peopleOfTomba(got), spent, deciders: got === top };
});

/** pure — Tomba's finder answer, in the shape Hunter's has (address-check.js foundOf), or null when it found none. */
export const foundOfTomba = (answer) => {
  const d = answer?.data;
  if (!d?.email) return null;
  return {
    email: sourceText(d.email, 254).toLowerCase(), score: num(d.score), role: sourceText(d.position, 120), linkedin: profileUrl(d.linkedin),
    status: d.verification?.status ?? null, sourceUrl: (d.sources ?? []).map((s) => https(s?.uri)).find(Boolean) ?? null,
  };
};

/** impure — the address of one named person at a domain. @returns {Promise<{ok: true, found: ?object, spent: number} | {ok: false, why: string}>} */
export const tombaFind = async ({ domain, name, apiKey, secret, baseUrl = urlOf(), signal }) => {
  const headers = tombaAuth(apiKey, secret);
  if (!headers) return { ok: false, why: NO_SECRET };
  try {
    const found = foundOfTomba(await askJson(`${baseUrl}/email-finder?domain=${enc(domain)}&full_name=${enc(name)}`, { headers, signal, name: NAME }));
    return { ok: true, found, spent: found && found.status !== 'unknown' ? 1 : 0 };
  } catch (err) {
    return { ok: false, why: err.message };
  }
};

/** pure — Tomba's verifier answer as the house keeps a check (address-check.js checkOf): a webmail address is said as one. */
export const checkOfTomba = (answer) => {
  const e = answer?.data?.email;
  if (!e?.status) return null;
  const status = e.webmail === true && e.status !== 'invalid' ? 'webmail' : String(e.status);
  return { status, score: num(e.score), mx: Boolean(e.mx_check), smtp: Boolean(e.smtp_check) };
};

/** impure — does one address exist. @returns {Promise<{ok: true, check: object, spent: number} | {ok: false, why: string}>} */
export const tombaVerify = async (email, { apiKey, secret, baseUrl = urlOf(), signal } = {}) => {
  const headers = tombaAuth(apiKey, secret);
  if (!headers) return { ok: false, why: NO_SECRET };
  try {
    const check = checkOfTomba(await askJson(`${baseUrl}/email-verifier?email=${enc(email)}`, { headers, signal, name: NAME }));
    if (!check) return { ok: false, why: 'Tomba gave no answer for this address' };
    return { ok: true, check, spent: ['disposable', 'unknown'].includes(check.status) ? 0 : 1 };
  } catch (err) {
    return { ok: false, why: err.message };
  }
};

/** pure — the plan and the balances left, in the shape Hunter's account has (hunter-discover.js accountOf). */
export const accountOfTomba = (answer) => {
  const d = answer?.data;
  const search = d?.requests?.domains;
  if (!d || !search) return null;
  const checks = d.requests.verifications;
  return {
    plan: sourceText(d.pricing?.name, 60) || 'unknown', used: num(search.used), available: num(search.available),
    ...(checks ? { checks: { used: num(checks.used), available: num(checks.available) } } : {}),
  };
};

/** impure — the operator's Tomba plan and credits (GET /me, free), or null when it cannot be read. Never throws. */
export const tombaAccount = async ({ apiKey, secret, baseUrl = urlOf() } = {}) => {
  const headers = tombaAuth(apiKey, secret);
  if (!headers) return null;
  try {
    return accountOfTomba(await askJson(`${baseUrl}/me`, { headers, name: NAME }));
  } catch {
    return null;
  }
};
