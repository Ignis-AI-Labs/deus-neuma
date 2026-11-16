// CONTACT-DATA PROVIDERS — the paid sources an operator attaches with their
// own key (Design note, 2026-11-15: […]).
// Each answers ONE question: who works at this company's domain, and how are
// they reached. Each returns the same row, so a new provider is one entry:
//   { name, role, email, confidence, sourceUrl, basis }
//   basis 'published'  the address was found on a public page (sourceUrl)
//   basis 'verified'   the provider holds it in its own database and verified
//                      it; sourceUrl is the person's public profile
// An address with neither is never returned. Every call spends the operator's
// credits, so each provider states its `cost` (credits one lookup may spend)
// and what it spent; lead-spend.js decides whether a lookup may run at all.
//
// Read from each provider's own API documentation on 2026-11-15:
//   hunter  GET  /domain-search?domain=&type=personal&required_field=full_name,position&api_key=
//           1 credit, counted only when the call returns at least one result: asked
//           only for named people with a role, a company with none costs nothing
//   tomba   GET  /domain-search?domain=  (X-Tomba-Key, X-Tomba-Secret)   1 per search
//   apollo  POST /mixed_people/api_search (free) then POST /people/match per person
//           (x-api-key; 1 credit per address returned)
// The parsing is PURE; every lookup is impure (network), never throws.

import process from 'node:process';
import { rankOf } from './top-first.js';

export const HUNTER_URL = 'https://api.hunter.io/v2';
export const TOMBA_URL = 'https://api.tomba.io/v1';
export const APOLLO_URL = 'https://api.apollo.io/api/v1';
const urlOf = (name, real) => process.env[`NEUMA_LEAD_SOURCE_${name}`] || real;
const PEOPLE_MAX = 10;
// Apollo charges per address revealed: at most this many people are asked for in one lookup.
export const APOLLO_REVEAL_MAX = 5;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const https = (u) => (/^https:\/\/\S+$/.test(String(u ?? '')) ? String(u) : null);
// Kept in the order given when equal: a caller may have put the people worth writing to first.
const whole = (rows) => rows.filter((p) => p.name && p.role && p.email && p.sourceUrl).sort((x, y) => y.confidence - x.confidence).slice(0, PEOPLE_MAX);

/** pure — Hunter's answer: only a person with a name, a role and an address found on a page. */
export const peopleOfHunter = (answer) => whole((answer?.data?.emails ?? []).map((e) => ({
  name: [e.first_name, e.last_name].filter(Boolean).join(' ').trim(),
  role: String(e.position ?? '').trim(),
  email: String(e.value ?? '').toLowerCase(),
  confidence: num(e.confidence),
  sourceUrl: (e.sources ?? []).map((s) => https(s?.uri)).find(Boolean) ?? null,
  // What else Hunter says about the person: how senior, which department, whether it has confirmed the address exists.
  seniority: e.seniority || null, department: e.department || null, checked: e.verification?.status || null, linkedin: https(e.linkedin) ?? null,
  decisionMaker: e.decision_maker === true,
}))).sort((x, y) => rankOf(x) - rankOf(y) || Number(y.checked === 'valid') - Number(x.checked === 'valid')); // TOP FIRST (top-first.js)

/** pure — Tomba's answer, the same law: a name, a role, an address, and the page it stands on. */
export const peopleOfTomba = (answer) => whole((answer?.data?.emails ?? []).map((e) => ({
  name: String(e.full_name ?? [e.first_name, e.last_name].filter(Boolean).join(' ')).trim(),
  role: String(e.position ?? '').trim(),
  email: String(e.email ?? '').toLowerCase(),
  confidence: num(e.score),
  sourceUrl: (e.sources ?? []).map((s) => https(s?.uri)).find(Boolean) ?? null,
  basis: 'published',
})));

/** pure — from Apollo's search: the people worth revealing (a title, and an address on file), first listed first. */
export const apolloToReveal = (answer) => (answer?.people ?? []).filter((p) => p?.id && p.has_email === true && String(p.title ?? '').trim()).slice(0, APOLLO_REVEAL_MAX).map((p) => String(p.id));

/** pure — one Apollo match: a person only when the address is verified and the profile is public. */
export const personOfApollo = (answer) => {
  const p = answer?.person;
  if (!p || p.email_status !== 'verified' || !p.email || !https(p.linkedin_url)) return null;
  const row = { name: String(p.name ?? '').trim(), role: String(p.title ?? '').trim(), email: String(p.email).toLowerCase(), confidence: 100, sourceUrl: https(p.linkedin_url), basis: 'verified' };
  return row.name && row.role ? row : null;
};

// impure — one call, JSON or a thrown reason in words.
const ask = async (url, { method = 'GET', headers = {}, signal } = {}) => {
  const res = await fetch(url, { method, headers: { accept: 'application/json', ...headers }, signal });
  if (res.ok) return res.json();
  const why = { 401: 'the key was refused — check it in SETTINGS, API, Lead data', 403: 'this key\'s plan may not use the API', 402: 'the account is out of credits', 422: 'the request was refused', 429: 'the provider is busy or the plan\'s limit is reached' }[res.status];
  throw new Error(why ?? `the provider answered ${res.status}`);
};
const answer = async (fn) => { try { return await fn(); } catch (err) { return { ok: false, detail: err.message }; } };

/** @returns {Promise<{ok: true, people: object[], spent: number} | {ok: false, detail: string}>} */
export const hunterContacts = ({ domain, apiKey, baseUrl = urlOf('HUNTER', HUNTER_URL), signal }) => answer(async () => {
  // Only named people with a role are asked for: Hunter counts a search only when it returns something, so a
  // company where it holds nobody the house could write to costs no credit (2026-11-16: every lookup used to
  // ask for everything, pay, and then throw the nameless addresses away).
  // THE TOP FIRST (Design note, 2026-11-16: […]): the company's decision makers are
  // asked for first; only when Hunter holds none (which costs nothing) is everyone named asked for.
  const search = (extra) => ask(`${baseUrl}/domain-search?domain=${encodeURIComponent(domain)}&type=personal&required_field=full_name,position&limit=10${extra}&api_key=${encodeURIComponent(apiKey)}`, { signal });
  const top = await search('&decision_maker=true');
  const got = (top?.data?.emails ?? []).length ? top : await search('');
  const people = peopleOfHunter(got).map((p) => ({ ...p, basis: 'published' }));
  return { ok: true, people, spent: (got?.data?.emails ?? []).length ? 1 : 0, deciders: got === top };
});

/** Tomba takes a key and a secret: the operator saves them together as `key:secret`. */
export const tombaContacts = ({ domain, apiKey, baseUrl = urlOf('TOMBA', TOMBA_URL), signal }) => answer(async () => {
  const [key, secret] = String(apiKey).split(':').map((s) => s.trim());
  if (!key || !secret) return { ok: false, detail: 'the Tomba entry needs the key and the secret together, as key:secret' };
  const found = await ask(`${baseUrl}/domain-search?domain=${encodeURIComponent(domain)}&limit=10&type=personal`, { headers: { 'X-Tomba-Key': key, 'X-Tomba-Secret': secret }, signal });
  return { ok: true, people: peopleOfTomba(found), spent: 1 };
});

/** Apollo: the search is free; each person revealed spends a credit when an address comes back. */
export const apolloContacts = ({ domain, apiKey, baseUrl = urlOf('APOLLO', APOLLO_URL), signal }) => answer(async () => {
  const headers = { 'x-api-key': apiKey, 'content-type': 'application/json' };
  const ids = apolloToReveal(await ask(`${baseUrl}/mixed_people/api_search?q_organization_domains_list[]=${encodeURIComponent(domain)}&per_page=25`, { method: 'POST', headers, signal }));
  const people = [];
  let spent = 0;
  for (const id of ids) {
    const match = await ask(`${baseUrl}/people/match?id=${encodeURIComponent(id)}`, { method: 'POST', headers, signal });
    if (match?.person?.email) spent += 1;
    const person = personOfApollo(match);
    if (person) people.push(person);
  }
  return { ok: true, people, spent };
});

/**
 * The providers, cheapest first (the order a lookup tries them in when the seat names none).
 * key: the service key id (Settings, API, Lead data) · cost: the most credits one lookup spends.
 */
export const PEOPLE_PROVIDERS = Object.freeze({
  hunter: Object.freeze({ kind: 'people', key: 'hunter', cost: 1, label: 'people and addresses at a company (Hunter, your own key; 1 credit a lookup)', contacts: hunterContacts }),
  tomba: Object.freeze({ kind: 'people', key: 'tomba', cost: 1, label: 'people and addresses at a company (Tomba, your own key and secret; 1 credit a lookup)', contacts: tombaContacts }),
  apollo: Object.freeze({ kind: 'people', key: 'apollo', cost: APOLLO_REVEAL_MAX, label: `verified work addresses from Apollo's database (your own key, a paid Apollo plan; up to ${APOLLO_REVEAL_MAX} credits a lookup)`, contacts: apolloContacts }),
});
