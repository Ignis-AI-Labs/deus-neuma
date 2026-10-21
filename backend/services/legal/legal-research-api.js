// LEGAL RESEARCH APIS — the official legal databases that want a key, reached
// by the CLO office WITHOUT the office ever holding the key.
//
// The operator saves each key in Settings → API (Legal research). This module
// talks only to the fixed official hosts below, adds the saved key itself (as a
// query parameter or a header, the way each API asks for it), and hands back
// the answer with the key scrubbed out of it: some APIs echo it inside their
// own "next page" links. A being names the API and a path; it never names a
// host, so no request can carry a key anywhere else.
//
// impure (network, the stored keys).

import { serviceValue } from '../stored-secrets.js';
import { CREDENTIAL_LINKS } from '../credential-links.js';

const MAX_CHARS = 120_000;
const TIMEOUT_MS = 20_000;

/** The APIs, each at its one official host. Pure data. */
export const LEGAL_APIS = Object.freeze({
  congress: Object.freeze({ base: 'https://api.congress.gov', key: 'api-data-gov', keyIn: 'query:api_key', demo: 'DEMO_KEY', what: 'US bills, actions, laws (Congress.gov API v3), e.g. /v3/bill/119/hr?limit=5' }),
  govinfo: Object.freeze({ base: 'https://api.govinfo.gov', key: 'api-data-gov', keyIn: 'query:api_key', demo: 'DEMO_KEY', what: 'US Code, CFR, Federal Register, public laws (GovInfo API), e.g. /packages/USCODE-2023-title47/summary' }),
  regulations: Object.freeze({ base: 'https://api.regulations.gov', key: 'api-data-gov', keyIn: 'query:api_key', demo: 'DEMO_KEY', what: 'federal dockets and comments (Regulations.gov API v4), e.g. /v4/documents?filter[searchTerm]=...' }),
  courtlistener: Object.freeze({ base: 'https://www.courtlistener.com/api/rest/v4', key: 'courtlistener', keyIn: 'header:Authorization:Token', optional: true, what: 'US case law: /search/?q=...&type=o (no key needed), opinions and clusters (key needed)' }),
  citations: Object.freeze({ base: 'https://www.courtlistener.com/api/rest/v4', key: 'courtlistener', keyIn: 'header:Authorization:Token', post: '/citation-lookup/', what: 'check case citations exist: pass {text} holding the citations; each comes back found (200), not found (404) or ambiguous (300)' }),
  openstates: Object.freeze({ base: 'https://v3.openstates.org', key: 'openstates', keyIn: 'header:X-API-KEY', what: 'state bills in all 50 states (Open States / Plural API v3), e.g. /bills?jurisdiction=wy&q=artificial intelligence' }),
});

/**
 * Is a path one the API's own host serves, and nothing else? Pure.
 * @param {unknown} path
 */
export const safeApiPath = (path) => typeof path === 'string'
  && path.startsWith('/') && !path.startsWith('//') && path.length <= 500
  && !path.includes('..') && !/[\s\\#@]/.test(path)
  && /^[A-Za-z0-9/_\-.~%:+,=&?[\]]*$/.test(path);

/**
 * The request for one call, the saved key placed where the API wants it. Pure.
 * @returns {{ok: true, url: string, init: RequestInit, key: string}|{ok: false, error: string}}
 */
export const buildRequest = ({ api, path = '/', query = {}, text = null }, keyFor) => {
  const spec = Object.prototype.hasOwnProperty.call(LEGAL_APIS, api) ? LEGAL_APIS[api] : null;
  if (!spec) return { ok: false, error: `unknown api — one of: ${Object.keys(LEGAL_APIS).join(', ')}` };
  const route = spec.post ?? path;
  if (!safeApiPath(route)) return { ok: false, error: 'path must be a path on the API itself (starting with /), nothing else' };
  const key = keyFor(spec.key) || spec.demo || '';
  if (!key && !spec.optional) {
    const where = CREDENTIAL_LINKS.service?.[spec.key]?.url ?? CREDENTIAL_LINKS.research?.[spec.key]?.url ?? '';
    return { ok: false, error: `the ${spec.key} key is not saved — the operator saves it in Settings → API (Legal research)${where ? `; it is made at ${where}` : ''}` };
  }
  const url = new URL(`${spec.base}${route}`);
  for (const [k, v] of Object.entries(query && typeof query === 'object' ? query : {})) {
    if (typeof v === 'string' || typeof v === 'number') url.searchParams.set(k, String(v));
  }
  const headers = { Accept: 'application/json', 'User-Agent': 'NeumaLegalResearch/1.0' };
  const [where, name, scheme] = spec.keyIn.split(':');
  if (key && where === 'query') url.searchParams.set(name, key);
  if (key && where === 'header') headers[name] = scheme ? `${scheme} ${key}` : key;
  if (spec.post) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'the citation check needs {text}: the citations to check' };
    if (!key) return { ok: false, error: 'the citation check needs the courtlistener key — the operator saves it in Settings → API (Legal research)' };
    return { ok: true, key, url: url.toString(), init: { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ text: text.slice(0, 64_000) }).toString() } };
  }
  return { ok: true, key, url: url.toString(), init: { method: 'GET', headers } };
};

/** Every trace of the key out of a text (raw, URL-encoded). Pure. */
export const scrubKey = (text, key) => {
  if (!key || key.length < 6) return String(text);
  return String(text).split(key).join('<key>').split(encodeURIComponent(key)).join('<key>');
};

/**
 * One call to an official legal API. impure (network).
 * @returns {Promise<{ok: boolean, status?: number, text?: string, error?: string}>}
 */
export const callLegalApi = async (args, { keyFor = (id) => serviceValue(id) } = {}) => {
  const req = buildRequest(args ?? {}, keyFor);
  if (!req.ok) return req;
  try {
    const res = await fetch(req.url, { ...req.init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = scrubKey(await res.text(), req.key);
    const text = body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS)}\n[… truncated — narrow the query]` : body;
    const where = scrubKey(req.url, req.key);
    if (!res.ok && res.status !== 300) return { ok: false, status: res.status, error: `${where} answered ${res.status}: ${text.slice(0, 400)}` };
    return { ok: true, status: res.status, text: `${where} (HTTP ${res.status})\n${text}` };
  } catch (err) {
    return { ok: false, error: scrubKey(err.message, req.key) };
  }
};
