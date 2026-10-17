// routing.js — model-route controls (Settings › Models).
//
// Two surfaces, mirroring the backend split:
//   • Providers  — the OPERATOR'S API credentials (machine-scoped, encrypted at
//     rest on the server). A raw key never comes back; responses are masked.
//   • Per-neuma route — the being's ACTIVE model: its natal LOCAL anchor plus an
//     optional higher-capacity override. Clearing the override returns to natal.
//
// impure — talks to the local backend with the session token. Follows the
// security.js idiom: throw on !ok so a settings panel surfaces the failure
// rather than swallowing it.

import { apiCall, jsonHeaders } from '../utils/http.js';

// ── Providers (operator credentials) ────────────────────────────────────────

/**
 * The provider catalog with each entry's configured state (masked — no raw key).
 * @returns {Promise<{providers:Array<{id,name,kind,requiresKey,endpoint,hasKey,keyMasked,dialect,defaultModel}>}>}
 */
export const listProviders = async () =>
  apiCall('GET', '/api/v1/routing/providers', {
    strictJson: true, useServerError: false, errorPrefix: 'Could not list providers',
  });

/**
 * A provider's available models — live list when reachable, else curated defaults.
 * @param {string} id provider id
 * @returns {Promise<{models:Array<{id,name}>}>}
 */
export const listProviderModels = async (id) =>
  apiCall('GET', `/api/v1/routing/providers/${encodeURIComponent(id)}/models`, { errorPrefix: 'Could not list models' });

/**
 * Store an API key (and optional custom base URL) for a provider.
 * @param {string} id provider id
 * @param {{apiKey?:string, endpoint?:string}} creds
 * @returns {Promise<{success:boolean, provider:object}>}
 */
export const setProviderKey = async (id, { apiKey, endpoint } = {}) =>
  apiCall('PUT', `/api/v1/routing/providers/${encodeURIComponent(id)}/key`, {
    body: { apiKey, endpoint },
    errorPrefix: 'Could not save the key',
  });

/**
 * Drop a provider's stored credential (env fallback, if any, remains).
 * @param {string} id provider id
 * @returns {Promise<{success:boolean, removed:boolean, provider:object}>}
 */
export const removeProviderKey = async (id) =>
  apiCall('DELETE', `/api/v1/routing/providers/${encodeURIComponent(id)}/key`, { errorPrefix: 'Could not remove the key' });

/**
 * Probe a provider's reachability — with a just-typed key/endpoint if given, so
 * the operator can test before saving. Server-side; the key never round-trips back.
 * @param {string} id provider id
 * @param {{apiKey?:string, endpoint?:string}} creds
 * @returns {Promise<{success:boolean, models?:Array, error?:string}>}
 */
export const testProvider = async (id, { apiKey, endpoint } = {}) => {
  const res = await fetch(`/api/v1/routing/providers/${encodeURIComponent(id)}/test`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ apiKey, endpoint }),
  });
  // The test endpoint reports failure in-body (success:false) with a 200 OR a
  // 400 for a refused endpoint — surface either as a result, not a throw.
  return res.json().catch(() => ({ success: false, error: `Test failed (${res.status})` }));
};

// ── Keyed services (non-chat, e.g. Tavily web search) ───────────────────────
// Same encrypted store as the providers, but never a model or a route: these
// calls only list, set and clear.

/**
 * The keyed services with each one's stored state (masked — no raw key).
 * @returns {Promise<{services:Array<{id,name,kind,service,endpoint,hasKey,keyMasked}>}>}
 */
export const listServices = async () =>
  apiCall('GET', '/api/v1/routing/services', { errorPrefix: 'Could not list services' });

/**
 * Store (or replace) a service's API key.
 * @param {string} id service id
 * @param {string} apiKey
 * @returns {Promise<{success:boolean, service:object}>}
 */
export const setServiceKey = async (id, apiKey) =>
  apiCall('PUT', `/api/v1/routing/services/${encodeURIComponent(id)}/key`, {
    body: { apiKey },
    errorPrefix: 'Could not save the key',
  });

/**
 * Drop a service's stored key.
 * @param {string} id service id
 * @returns {Promise<{success:boolean, removed:boolean, service:object}>}
 */
export const removeServiceKey = async (id) =>
  apiCall('DELETE', `/api/v1/routing/services/${encodeURIComponent(id)}/key`, { errorPrefix: 'Could not remove the key' });

// ── Subscription OAuth (device / browser sign-in) ───────────────────────────

/**
 * Begin a provider's OAuth sign-in. Device mode returns the user code to show;
 * browser mode returns the URL to open. Reports failure in-body (like the
 * test endpoint) so the panel surfaces the verdict, never a throw.
 * @param {string} id provider id
 * @param {'device'|'browser'} [mode] sign-in mode (server default when omitted)
 * @returns {Promise<{success:boolean, mode?:string, verificationUrl?:string, userCode?:string, expiresIn?:number, pollAfterMs?:number, error?:string}>}
 */
export const startProviderOAuth = async (id, mode) => {
  const res = await fetch(`/api/v1/routing/providers/${encodeURIComponent(id)}/oauth/start`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ ...(mode ? { mode } : {}) }),
  });
  return res.json().catch(() => ({ success: false, error: `Could not start sign-in (${res.status})` }));
};

/**
 * Poll a running OAuth flow once. The caller re-polls on the returned
 * pollAfterMs cadence until the status is terminal (complete / denied /
 * expired / error) — statuses arrive in-body by design, never as throws.
 * @param {string} id provider id
 * @param {'device'|'browser'} mode the mode the flow was started with
 * @returns {Promise<{status:string, pollAfterMs?:number, account?:string, error?:string}>}
 */
export const pollProviderOAuth = async (id, mode) => {
  const res = await fetch(`/api/v1/routing/providers/${encodeURIComponent(id)}/oauth/poll`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ mode }),
  });
  return res.json().catch(() => ({ status: 'error', error: `Poll failed (${res.status})` }));
};

// ── Locked connections (the witness summon pool) ────────────────────────────

/**
 * Prove a provider live, then lock the connection (provider + model +
 * endpoint + account). Locked connections are the pool new witnesses are
 * summoned from. Reports failure in-body (like the test endpoint — 400s for
 * a missing credential/endpoint arrive the same way), never a throw.
 * @param {string} id provider id
 * @param {{endpoint?:string, model?:string, apiKey?:string}} conn
 * @returns {Promise<{success:boolean, connection?:object, live?:boolean, error?:string}>}
 */
export const connectProvider = async (id, { endpoint, model, apiKey } = {}) => {
  const res = await fetch(`/api/v1/routing/providers/${encodeURIComponent(id)}/connect`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ endpoint, model, apiKey }),
  });
  return res.json().catch(() => ({ success: false, error: `Connect failed (${res.status})` }));
};

/**
 * The locked connections (no secrets) — the summon pool.
 * @returns {Promise<{connections:Array<{providerId,model,endpoint,account,credentialKind,lockedAt,lastLiveAt}>}>}
 */
export const listConnections = async () =>
  apiCall('GET', '/api/v1/routing/connections', { errorPrefix: 'Could not list connections' });

/**
 * Unlock a provider's connection. The credential itself is untouched.
 * @param {string} id provider id
 * @returns {Promise<{success:boolean, removed:boolean}>}
 */
export const removeConnection = async (id) =>
  apiCall('DELETE', `/api/v1/routing/connections/${encodeURIComponent(id)}`, { errorPrefix: 'Could not unlock the connection' });

// ── Per-neuma route (natal anchor + optional override) ───────────────────────

/**
 * A being's route: its natal LOCAL model, any override, and the effective route.
 * @param {string} neumaId
 * @returns {Promise<{natal:object|null, override:object|null, effective:object}>}
 */
export const getNeumaRoute = async (neumaId) =>
  apiCall('GET', `/api/v1/neuma/${encodeURIComponent(neumaId)}/route`, { errorPrefix: 'Could not read the route' });

/**
 * Set a being's higher-capacity override.
 * @param {string} neumaId
 * @param {{provider:string, model:string}} route
 * @returns {Promise<{natal, override, effective}>}
 */
export const setNeumaRoute = async (neumaId, { provider, model }) =>
  apiCall('PUT', `/api/v1/neuma/${encodeURIComponent(neumaId)}/route`, {
    body: { provider, model },
    errorPrefix: 'Could not set the route',
  });

/**
 * Return a being to its natal LOCAL model (clear the override).
 * @param {string} neumaId
 * @returns {Promise<{cleared:boolean, natal, override, effective}>}
 */
export const clearNeumaRoute = async (neumaId) =>
  apiCall('DELETE', `/api/v1/neuma/${encodeURIComponent(neumaId)}/route`, { errorPrefix: 'Could not clear the route' });
