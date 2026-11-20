// APOLLO — the same steps Hunter serves, through the operator's own Apollo key (Design note, 2026-11-18: […]). Read from docs.apollo.io on 2026-11-18; header x-api-key.
//   POST /mixed_people/api_search?q_organization_domains_list[]=&contact_email_status[]=verified&person_seniorities[]=…
//        people at a company: FREE, and it shows no address (only whether Apollo holds a verified one, has_email);
//        it matches people who worked there BEFORE too, so every revealed address is checked to be at the company
//   POST /people/match?id=  |  ?name=&domain=  reveal one person: 1 credit when Apollo returns a person, none when it
//        matches nobody (match_confidence none); the work address comes without any extra flag
//   POST /usage_stats/credit_usage_stats      free: the credits left in the cycle (a key may need that endpoint allowed)
//   POST /mixed_companies/search              companies by keywords, place and size: 1 credit a page, paid plans only
//        (company-search.js)
//   POST /enrich {action: email_verifier, action_type: tool, input_attributes: [{email}], poll_only: true}
//        THE ADDRESS CHECK (Design note, 2026-11-19: […]),
//        read from docs.apollo.io that day: a beta, for plans on unified credits (a legacy plan is answered 403). It
//        answers 202 with a request id; GET /webhook_result/{id} gives the result once ready (404 result_pending,
//        retry_after_seconds, until then). 1 credit an address checked; none for one it could not run. Each row says
//        validated (the address takes mail) or not_validated — which is NOT […], only not confirmed (an
//        accept-all domain), so Apollo's answer is valid or unknown, never a refusal on its own.
//
// 2026-11-18, why two lookups spent 10 credits and kept nobody: Apollo writes a profile as http://www.linkedin.com/…
// and the old rule took https only; and a person Apollo will not unlock comes back as email_not_unlocked@…. Now a
// profile is upgraded to https, and every person paid for and not kept is said, with why (Design note, 2026-11-17: […]).
// The parsing is PURE; every call is impure and never throws.

import process from 'node:process';
import { sourceText } from './source-text.js';
import { topFirst, domainOfAddress as domainOf } from './top-first.js';
import { testEndpoint } from '../test-endpoint-door.js';
import { askJson, answer, num, profileUrl, refusalWords } from './provider-call.js';

export const APOLLO_URL = 'https://api.apollo.io/api/v1';
// Apollo charges per person revealed: at most this many are revealed in one lookup.
export const APOLLO_REVEAL_MAX = 5;
const urlOf = () => testEndpoint(process.env, 'NEUMA_LEAD_SOURCE_APOLLO', APOLLO_URL);
const NAME = 'Apollo';
const enc = encodeURIComponent;
// THE TOP FIRST: the people who decide, in Apollo's own seniority words.
export const APOLLO_TOP = Object.freeze(['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director']);
const LOCKED = /^email_not_unlocked@|@domain\.com$/i;
const low = (v) => String(v ?? '').trim().toLowerCase();

/** pure — from Apollo's search: the people worth revealing (a title, and a verified address on file), first listed first. */
export const apolloToReveal = (answer) => (answer?.people ?? []).filter((p) => p?.id && p.has_email === true && String(p.title ?? '').trim()).slice(0, APOLLO_REVEAL_MAX).map((p) => sourceText(p.id, 128));

/**
 * pure — one Apollo match, judged: a person when the address is real, Apollo verified it, it is at this company (not
 * a past employer's), and a public profile stands behind it; otherwise why not, in words.
 * @returns {{person: ?object, why: ?string}}
 */
export const judgeApollo = (answer, domain = null) => {
  const p = answer?.person;
  if (!p) return { person: null, why: 'Apollo matched nobody' };
  const name = sourceText(p.name || [p.first_name, p.last_name].filter(Boolean).join(' '), 120);
  const who = name || 'one person';
  const email = sourceText(p.email, 254).toLowerCase();
  if (!email || LOCKED.test(email)) return { person: null, why: `${who}: Apollo did not unlock an address` };
  if (p.email_status !== 'verified') return { person: null, why: `${who}: Apollo has not verified ${email} (${p.email_status || 'no status'})` };
  const at = domainOf(email);
  if (domain && at !== low(domain) && low(p.organization?.primary_domain) !== low(domain)) return { person: null, why: `${who}: ${email} is at ${at}, not ${domain} — they may have left` };
  const sourceUrl = profileUrl(p.linkedin_url);
  if (!sourceUrl) return { person: null, why: `${who}: no public profile stands behind ${email}` };
  const role = sourceText(p.title, 120);
  if (!name || !role) return { person: null, why: `${who}: Apollo gave no ${name ? 'title' : 'name'}` };
  return { person: { name, role, email, confidence: 100, sourceUrl, basis: 'verified', checked: 'valid', seniority: sourceText(p.seniority, 40) || null }, why: null };
};

/** pure — one Apollo match as a person to offer, or null (judgeApollo says why). */
export const personOfApollo = (answer, domain = null) => judgeApollo(answer, domain).person;

// pure — whether Apollo charged for a match: a person came back, and it did not say it matched nobody.
const charged = (match) => Boolean(match?.person) && match.person.match_confidence !== 'none';

/**
 * impure — the people at a company. The search is free: its decision makers are searched for first, everyone with a
 * verified address only when there are none; then at most APOLLO_REVEAL_MAX are revealed, a credit each.
 * @returns {Promise<{ok: true, people: object[], spent: number, dropped: string[], deciders: boolean} | {ok: false, detail: string, spent: number, dropped: string[]}>}
 */
export const apolloContacts = async ({ domain, apiKey, baseUrl = urlOf(), signal }) => {
  const headers = { 'x-api-key': apiKey };
  let spent = 0;
  const dropped = [];
  try {
    const search = (extra) => askJson(`${baseUrl}/mixed_people/api_search?q_organization_domains_list[]=${enc(domain)}&contact_email_status[]=verified${extra}&per_page=25`, { method: 'POST', headers, signal, name: NAME });
    const top = apolloToReveal(await search(APOLLO_TOP.map((s) => `&person_seniorities[]=${s}`).join('')));
    const ids = top.length ? top : apolloToReveal(await search(''));
    const people = [];
    for (const id of ids) {
      const match = await askJson(`${baseUrl}/people/match?id=${enc(id)}`, { method: 'POST', headers, signal, name: NAME });
      if (charged(match)) spent += 1;
      const { person, why } = judgeApollo(match, domain);
      if (person) people.push(person);
      else dropped.push(why);
    }
    return { ok: true, people: topFirst(people), spent, dropped, deciders: top.length > 0 };
  } catch (err) {
    return { ok: false, detail: err.message, spent, dropped };
  }
};

/** pure — Apollo's match of one named person, in the shape Hunter's finder has (address-check.js foundOf). */
export const foundOfApollo = (answer, domain) => {
  const p = answer?.person;
  const email = sourceText(p?.email, 254).toLowerCase();
  if (!p || !email || LOCKED.test(email)) return null;
  const at = domainOf(email);
  if (domain && at !== low(domain) && low(p.organization?.primary_domain) !== low(domain)) return null;
  return { email, score: p.email_status === 'verified' ? 100 : 0, role: sourceText(p.title, 120), linkedin: profileUrl(p.linkedin_url), status: p.email_status === 'verified' ? 'valid' : (p.email_status || 'unknown'), sourceUrl: null };
};

/** impure — the address of one named person at a domain. @returns {Promise<{ok: true, found: ?object, spent: number} | {ok: false, why: string}>} */
export const apolloFind = async ({ domain, name, apiKey, baseUrl = urlOf(), signal }) => {
  try {
    const match = await askJson(`${baseUrl}/people/match?name=${enc(name)}&domain=${enc(domain)}`, { method: 'POST', headers: { 'x-api-key': apiKey }, signal, name: NAME });
    return { ok: true, found: foundOfApollo(match, domain), spent: charged(match) ? 1 : 0 };
  } catch (err) {
    return { ok: false, why: err.message };
  }
};

/** pure — the credits left in the cycle, in the shape Hunter's account has. */
export const accountOfApollo = (answer) => {
  const c = answer?.credit_usage_stats?.lead_credit;
  return c ? { plan: 'current', used: num(c.consumed), available: num(c.limit) } : null;
};

/** impure — the operator's Apollo credits (free to ask), or null when the key may not read them. Never throws. */
export const apolloAccount = async ({ apiKey, baseUrl = urlOf() } = {}) => {
  if (!apiKey) return null;
  return answer(async () => accountOfApollo(await askJson(`${baseUrl}/usage_stats/credit_usage_stats`, { method: 'POST', headers: { 'x-api-key': apiKey }, name: NAME })))
    .then((a) => (a && a.ok === false ? null : a));
};

// ── THE ADDRESS CHECK (address-check.js CHECKERS) ──
const VERIFY_TRIES = 8;
const PAUSE_MAX_S = 5;

// pure — every checked row in Apollo's result, wherever the payload nests it.
const rowsOf = (v, depth = 0) => {
  if (!v || typeof v !== 'object' || depth > 5) return [];
  if (!Array.isArray(v) && typeof v.email === 'string' && ('validation_status' in v || 'error' in v)) return [v];
  return Object.values(v).flatMap((x) => rowsOf(x, depth + 1));
};

/**
 * pure — Apollo's answer for one address as the house keeps a check: validated is valid; not confirmed is unknown (it
 * goes); a row it did not check says why. Null when the result holds no row for the address.
 * @returns {null | {status: string, score: number, validator: ?string, ran: boolean} | {error: string}}
 */
export const checkOfApollo = (result, email) => {
  const row = rowsOf(result).find((r) => low(r.email) === low(email));
  if (!row) return null;
  if (row.error) return { error: sourceText(row.error.message || row.error.code, 200) || 'no reason given' };
  const validated = row.validation_status === 'validated';
  return { status: validated ? 'valid' : 'unknown', score: validated ? 100 : 0, validator: sourceText(row.validator, 40) || null, ran: Boolean(row.validation_status) };
};

const pause = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/**
 * impure — does one address take mail, asked of Apollo: the check sent, its result asked for until it is ready.
 * @returns {Promise<{ok: true, check: object, spent: number} | {ok: false, why: string}>}
 */
export const apolloVerify = async (email, { apiKey, baseUrl = urlOf(), signal, tries = VERIFY_TRIES, pauseMs = null } = {}) => {
  const headers = { 'x-api-key': apiKey };
  try {
    const asked = await askJson(`${baseUrl}/enrich`, { method: 'POST', headers, signal, name: NAME,
      body: { action: 'email_verifier', action_type: 'tool', input_attributes: [{ email }], poll_only: true } });
    const refused = (asked.results ?? []).find((r) => r?.status === 'rejected');
    if (!asked.request_id || refused) return { ok: false, why: `Apollo would not check ${email}${refused?.errors?.length ? `: ${sourceText(refused.errors.join('; '), 200)}` : ''}` };
    for (let i = 0; i < tries && !signal?.aborted; i += 1) {
      const res = await fetch(`${baseUrl}/webhook_result/${enc(asked.request_id)}`, { headers: { accept: 'application/json', ...headers }, signal });
      const body = await res.json().catch(() => ({}));
      const pending = (res.status === 404 && body.error_code === 'result_pending') || (res.ok && body.webhook_status === 'in_progress' && !rowsOf(body.webhook_result).length);
      if (pending) { await pause(pauseMs ?? Math.min(Math.max(num(body.retry_after_seconds), 1), PAUSE_MAX_S) * 1000, signal); continue; }
      if (!res.ok) return { ok: false, why: refusalWords(res.status, body, NAME) };
      const check = checkOfApollo(body.webhook_result, email);
      if (!check) return { ok: false, why: 'Apollo gave no answer for this address' };
      if (check.error) return { ok: false, why: `Apollo did not check ${email}: ${check.error}` };
      const { ran, ...kept } = check;
      return { ok: true, check: kept, spent: ran ? 1 : 0 };
    }
    return { ok: false, why: 'Apollo was still checking after several tries — ask again in a minute' };
  } catch (err) {
    return { ok: false, why: err.message };
  }
};
