// authed-call.js — one transport for an office's REST client: the session
// token must be present, and every failure throws with the route's honest
// reason (utils/http.js apiCall). The clients that predate it (clockCall,
// legalCall, moneyCall, treasuryCall) carry the same body and should fold
// into this on their next touch.
//
// impure.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

/**
 * @param {string} base - the route prefix, e.g. '/api/v1/company-line'
 * @returns {(method: string, path: string, opts?: {body?: object, errorPrefix?: string}) => Promise<object>}
 */
export const authedCall = (base) => async (method, path, { body, errorPrefix } = {}) => {
  if (!authHeaders()) throw new Error('Not authenticated.');
  return apiCall(method, `${base}${path}`, { body, errorPrefix, errorSuffix: '.' });
};
