// ONE CALL TO A CONTACT-DATA PROVIDER, and the shared shape of what comes back (lead-providers.js, tomba-api.js,
// apollo-api.js). Each provider says why it refused in its own body, and the status alone misleads: Tomba answers a
// bad or expired key with 400 `errors.type: authentication_failed`, Apollo puts its reason in `error_details.code`,
// Hunter in `errors[].details`. So the reason is read from the body and said in words the operator can act on.
// The judging is PURE; askJson is impure and throws only its reason in words.

import { sourceText } from './source-text.js';

export const PEOPLE_MAX = 10;

/** pure — a number, or 0. */
export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** pure — an https address, or null. */
export const https = (u) => (/^https:\/\/\S+$/.test(String(u ?? '')) ? sourceText(u, 2048) : null);
/** pure — a LinkedIn profile, upgraded to https (Apollo writes them as http://), or null. */
export const profileUrl = (u) => (/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/\S+$/i.test(String(u ?? '')) ? sourceText(String(u).replace(/^http:/i, 'https:'), 2048) : null);
/** pure — the people worth offering: a name, a role, an address and where it stands; the surest first, ten at most.
 * Kept in the order given when equal: a caller may have put the people worth writing to first. */
export const whole = (rows) => rows.filter((p) => p.name && p.role && p.email && p.sourceUrl).sort((x, y) => y.confidence - x.confidence).slice(0, PEOPLE_MAX);

const reasonOf = (body) => body?.errors?.message ?? body?.errors?.[0]?.details ?? body?.error_details?.message ?? body?.error ?? body?.message ?? null;
const typeOf = (body) => String(body?.errors?.type ?? body?.error_details?.code ?? body?.errors?.[0]?.id ?? '');

/** pure — what a refusal means, in the operator's words. */
export const refusalWords = (status, body, name = 'the provider') => {
  const type = typeOf(body);
  const said = reasonOf(body);
  if (status === 401 || /authentication_failed|api_key_expired|invalid_api_key|unauthori[sz]ed/i.test(type)) return `${name} refused the key — check it in SETTINGS, API, Lead data`;
  if (status === 402 || /quota_exceeded|insufficient_credits/i.test(type)) return `${name} is out of credits for this period`;
  if (status === 403) return `${name}: this key's plan may not use this part of its API${said ? ` (${sourceText(said, 200)})` : ''}`;
  if (status === 429) return `${name} is busy, or the plan's limit for now is reached — try again later`;
  if (status === 451) return `${name} holds nothing for this person: they asked to be removed`;
  return `${name} answered ${status}${said ? `: ${sourceText(said, 200)}` : ''}`;
};

/** impure — one call: the JSON of a 2xx answer, or a thrown reason in words. */
export const askJson = async (url, { method = 'GET', headers = {}, body, signal, name } = {}) => {
  const res = await fetch(url, {
    method, signal,
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok) return json;
  throw new Error(refusalWords(res.status, json, name));
};

/** impure — run a lookup, turning a thrown reason into { ok: false, detail }. Never throws. */
export const answer = async (fn) => { try { return await fn(); } catch (err) { return { ok: false, detail: err.message }; } };
