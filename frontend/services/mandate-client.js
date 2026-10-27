// mandate-client.js — the house operator's MANDATE for the CMO seat, over
// REST (backend/routes/mandate-routes.js): read it, run the grant's checks,
// grant it, withdraw it, resume it, renew it, clear a hold. Every act's
// answer carries the fresh view.
//
// impure — authenticated REST.

import { apiCall, authHeadersOrNull } from '../utils/http.js';

const call = (method, url, body, errorPrefix) => {
  const headers = authHeadersOrNull();
  if (!headers) return Promise.reject(new Error('Not authenticated.'));
  return apiCall(method, url, { headers, body, errorPrefix });
};

/** Where the mandate stands, its words, what a grant may name, DONE FOR YOU. */
// impure
export const getMandate = () => call('GET', '/api/v1/mandate', undefined, 'Reading the mandate failed');

/** Grant one. @param {object} grant - the grant screen's choices */
// impure
export const grantMandate = (grant) => call('POST', '/api/v1/mandate/grant', grant, 'The mandate was not granted');

/** End it now. */
// impure
export const withdrawMandate = (reason = '') => call('POST', '/api/v1/mandate/withdraw', { reason }, 'The mandate was not withdrawn');

/** Resume a paused one. */
// impure
export const resumeMandate = () => call('POST', '/api/v1/mandate/resume', {}, 'The mandate was not resumed');

/** Restart its term from today. */
// impure
export const renewMandate = () => call('POST', '/api/v1/mandate/renew', {}, 'The mandate was not renewed');

/** The grant protocol's rows for the grant about to be made, and whether this is the desk. */
// impure
export const preflightMandate = (grant) => call('POST', '/api/v1/mandate/preflight', grant, 'The checks could not be read');

/** Clear one hostile-text hold, once the operator has looked. */
// impure
export const clearMandateHold = (id) => call('POST', `/api/v1/mandate/holds/${encodeURIComponent(id)}/clear`, {}, 'The hold was not cleared');
