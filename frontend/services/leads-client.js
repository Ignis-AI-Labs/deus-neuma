// leads-client.js — the operator's window onto the house lead ledger, over REST.
//
// impure — reads and edits the ledger the backend keeps (append-only touch
// history server-side; every mutation is recorded under the caller). Failures
// surface as thrown errors with the route's honest reason.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

// impure — every call is network IO against the ledger routes.
const req = async (path, init = {}) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall(init.method || 'GET', `/api/v1/leads${path}`, {
    headers,
    ...(init.body !== undefined && { body: init.body }),
    errorPrefix: 'Lead ledger request failed', errorSuffix: '.',
  });
};

/**
 * The whole ledger plus its by-status board view.
 * @returns {Promise<{leads: Array<object>, board: object, statuses: string[]}>}
 */
// impure
export const getLeadBoard = () => req('');

/**
 * Capture one lead.
 * @param {{name?: string, contact?: string, channelId?: string,
 *   source?: string, note?: string}} lead
 */
// impure
export const captureLead = (lead) =>
  req('', { method: 'POST', body: lead });

/**
 * Touch one lead — field edits, a status move, and a note land as ONE
 * recorded touch.
 * @param {string} id
 * @param {{status?: string, note?: string, ownerNeumaId?: string}} change
 */
// impure
export const touchLead = (id, change) =>
  req(`/${id}`, { method: 'PUT', body: change });

/**
 * Drop one lead from the ledger entirely.
 * @param {string} id
 */
// impure
export const removeLead = (id) =>
  req(`/${id}`, { method: 'DELETE' });
