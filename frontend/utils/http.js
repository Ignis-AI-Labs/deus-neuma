// HTTP primitives — the auth/json headers every client & service module
// attaches to a fetch, plus the one shared JSON call helper. The header
// functions are pure; the only impurity is reading the session token from
// sessionStorage, guarded for non-browser contexts (tests, workers). apiCall
// is the impure transport.

import { currentEntryMode } from './entry-mode-scope.js';

const readToken = () =>
  (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('authToken') : null);

// Which operator state this desk is — every authenticated request says so, and
// the server's being lists answer a harness desk with no house
// (core/runtime/operator-state.js requestState).
const stateHeader = () => ({ 'X-Neuma-State': currentEntryMode() });

/**
 * The bare session token, for the one case a header cannot reach: an element
 * that fetches its OWN bytes (`<img src>`, `<video src>`, a native download).
 * Prefer `authHeaders`/`authHeadersOrNull` everywhere else — a token in a URL
 * is visible to anything that logs URLs, so only routes that explicitly accept
 * `?token=` should ever be built this way.
 * @returns {string | null}
 */
export const authTokenOrNull = () => readToken();

/**
 * Bearer auth header, merge-style. Returns `{}` when unauthenticated so it is
 * always safe to spread into a headers object: `{ ...authHeaders() }`.
 * @returns {{ Authorization: string } | {}}
 */
export const authHeaders = () => {
  const token = readToken();
  return token ? { Authorization: `Bearer ${token}`, ...stateHeader() } : {};
};

/**
 * Bearer auth header, bail-style. Returns `null` when unauthenticated so a
 * caller can short-circuit an unauthenticated request:
 * `const h = authHeadersOrNull(); if (!h) return null;`
 * @returns {{ Authorization: string } | null}
 */
export const authHeadersOrNull = () => {
  const token = readToken();
  return token ? { Authorization: `Bearer ${token}`, ...stateHeader() } : null;
};

/**
 * JSON headers with auth, merge-style. `{ 'Content-Type': 'application/json' }`
 * plus the bearer token when present.
 * @returns {{ 'Content-Type': string, Authorization?: string }}
 */
export const jsonHeaders = () => ({ 'Content-Type': 'application/json', ...authHeaders() });

/**
 * Pure — preserve HTTP refusal metadata even when a JSON error body is null.
 * Two server error shapes ride here: the legacy flat `{error: 'reason'}` and
 * the structured `{error: {code, message}}` (the bench plane's contract) —
 * both unwrap to the server's own reason text, never "[object Object]".
 * @param {*} data parsed response body
 * @param {number} status HTTP status
 * @param {{errorPrefix?: string, errorSuffix?: string, useServerError?: boolean}} [options]
 * @returns {Error & {code: *, http: number, retryAfterMs: *}}
 */
export const httpErrorFromResponse = (data, status, { errorPrefix, errorSuffix = '', useServerError = true } = {}) => {
  const serverText = typeof data?.error === 'string'
    ? data.error
    : (data?.error && typeof data.error === 'object' ? data.error.message : null);
  const serverCode = data?.code
    ?? (data?.error && typeof data.error === 'object' ? data.error.code : undefined);
  const error = new Error((useServerError && serverText) || `${errorPrefix || 'Request failed'} (${status})${errorSuffix}`);
  error.code = serverCode;
  error.http = status;
  error.retryAfterMs = data?.retryAfterMs;
  return error;
};

/**
 * One JSON round-trip: shared headers, an optional JSON body, and a thrown
 * Error on a non-ok response. The error carries the server's refusal `code`
 * (`err.code`) and the HTTP status (`err.http`) so a caller can tell a real
 * refusal from a dropped connection — a network failure rejects before any
 * response, so it never gains `err.http`.
 * @param {string} method HTTP method
 * @param {string} url request URL
 * @param {{body?: *, headers?: Object, errorPrefix?: string, errorSuffix?: string, signal?: AbortSignal, strictJson?: boolean, useServerError?: boolean}} [options]
 *   body — JSON-stringified when provided; headers — merged over jsonHeaders();
 *   errorPrefix — fallback message prefix (default 'Request failed');
 *   errorSuffix — fallback-only trailing text (default empty);
 *   signal — passed through to fetch for abortable calls.
 *   strictJson — reject malformed successful JSON instead of returning {}.
 *   useServerError — prefer server error text (default true); false preserves a fixed client message.
 * @returns {Promise<*>} the parsed response body ({} when it is not JSON)
 */
// impure — network transport; single home of the JSON call idiom.
export const apiCall = async (method, url, { body, headers, errorPrefix, errorSuffix = '', signal, strictJson = false, useServerError = true } = {}) => {
  const res = await fetch(url, {
    method,
    headers: { ...jsonHeaders(), ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    ...(signal && { signal }),
  });
  const data = await res.json().catch((error) => {
    if (strictJson && res.ok) throw error;
    return {};
  });
  if (!res.ok) {
    // THE AUTH ROT ALARM (friction-map D2a): the desk is ALWAYS-ON but the
    // session token dies at hour 24 — the portal socket never re-verifies
    // (stays green) while every REST call quietly 401s, so probes read
    // CHECKING forever and the desk half-dies in silence. A 401 against a
    // token we BELIEVE we have is the rot itself: say it out loud on the
    // same channel AppShell already hears, and the desk fails LOUD into a
    // re-auth instead of rotting. Guarded on token-present so a failed
    // LOGIN attempt (no/bad credentials by design) can never loop the desk.
    if (res.status === 401 && sessionStorage.getItem('authToken')) {
      window.dispatchEvent(new CustomEvent('neuma:auth_expired'));
    }
    throw httpErrorFromResponse(data, res.status, { errorPrefix, errorSuffix, useServerError });
  }
  return data;
};
