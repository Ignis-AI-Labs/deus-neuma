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
// Each provider serves the same steps Hunter does (Design note, 2026-11-18: […]): the people
// at a company here, one named person's address and the check of an address
// before a first email (address-check.js), its credits left (lead-spend.js).
//   hunter  GET  /domain-search?domain=&type=personal&required_field=full_name,position&api_key=
//           1 credit, counted only when the call returns at least one result: asked
//           only for named people with a role, a company with none costs nothing
//   tomba   tomba-api.js   apollo  apollo-api.js  (each from its own API documentation, 2026-11-18)
// The parsing is PURE; every lookup is impure (network), never throws.

import process from 'node:process';
import { rankOf } from './top-first.js';
import { sourceText } from './source-text.js';
import { testEndpoint } from '../test-endpoint-door.js';
import { askJson, answer, num, https, whole } from './provider-call.js';
import { tombaContacts } from './tomba-api.js';
import { apolloContacts, APOLLO_REVEAL_MAX } from './apollo-api.js';

export { TOMBA_URL, peopleOfTomba, tombaContacts } from './tomba-api.js';
export { APOLLO_URL, APOLLO_REVEAL_MAX, apolloToReveal, personOfApollo, apolloContacts } from './apollo-api.js';

export const HUNTER_URL = 'https://api.hunter.io/v2';
const urlOf = (name, real) => testEndpoint(process.env, `NEUMA_LEAD_SOURCE_${name}`, real);

/** pure — Hunter's answer: only a person with a name, a role and an address found on a page. */
export const peopleOfHunter = (answer) => whole((answer?.data?.emails ?? []).map((e) => ({
  name: sourceText([e.first_name, e.last_name].filter(Boolean).join(' '), 120),
  role: sourceText(e.position, 120),
  email: sourceText(e.value, 254).toLowerCase(),
  confidence: num(e.confidence),
  sourceUrl: (e.sources ?? []).map((s) => https(s?.uri)).find(Boolean) ?? null,
  // What else Hunter says about the person: how senior, which department, whether it has confirmed the address exists.
  seniority: sourceText(e.seniority, 80) || null, department: sourceText(e.department, 80) || null, checked: sourceText(e.verification?.status, 40) || null, linkedin: https(e.linkedin) ?? null,
  decisionMaker: e.decision_maker === true,
}))).sort((x, y) => rankOf(x) - rankOf(y) || Number(y.checked === 'valid') - Number(x.checked === 'valid')); // TOP FIRST (top-first.js)

/** @returns {Promise<{ok: true, people: object[], spent: number} | {ok: false, detail: string}>} */
export const hunterContacts = ({ domain, apiKey, baseUrl = urlOf('HUNTER', HUNTER_URL), signal }) => answer(async () => {
  // Only named people with a role are asked for: Hunter counts a search only when it returns something, so a
  // company where it holds nobody the house could write to costs no credit (2026-11-16: every lookup used to
  // ask for everything, pay, and then throw the nameless addresses away).
  // THE TOP FIRST (Design note, 2026-11-16: […]): the company's decision makers are
  // asked for first; only when Hunter holds none (which costs nothing) is everyone named asked for.
  const search = (extra) => askJson(`${baseUrl}/domain-search?domain=${encodeURIComponent(domain)}&type=personal&required_field=full_name,position&limit=10${extra}&api_key=${encodeURIComponent(apiKey)}`, { signal, name: 'Hunter' });
  const top = await search('&decision_maker=true');
  const got = (top?.data?.emails ?? []).length ? top : await search('');
  const people = peopleOfHunter(got).map((p) => ({ ...p, basis: 'published' }));
  return { ok: true, people, spent: (got?.data?.emails ?? []).length ? 1 : 0, deciders: got === top };
});

/**
 * The providers, cheapest first (the order a lookup tries them in when the seat names none).
 * key: the service key id (Settings, API, Lead data) · secret: a second value the provider takes · cost: the most
 * credits one lookup spends.
 */
export const PEOPLE_PROVIDERS = Object.freeze({
  hunter: Object.freeze({ kind: 'people', key: 'hunter', name: 'Hunter', cost: 1, label: 'people and addresses at a company (Hunter, your own key; 1 credit a lookup)', contacts: hunterContacts }),
  tomba: Object.freeze({ kind: 'people', key: 'tomba', secret: 'tomba-secret', name: 'Tomba', cost: 1, label: 'people and addresses at a company (Tomba, your own key and secret; 1 credit a lookup, none when it holds nobody)', contacts: tombaContacts }),
  apollo: Object.freeze({ kind: 'people', key: 'apollo', name: 'Apollo', cost: APOLLO_REVEAL_MAX, label: `verified work addresses from Apollo's database, its decision makers first (your own key; the search is free, then up to ${APOLLO_REVEAL_MAX} credits a lookup, one a person revealed)`, contacts: apolloContacts }),
});
