// connections-client.js — the CONNECTIONS list and its switches, over REST.
//
// impure — reads the list and flips a switch the backend enforces at each network door (the
// frontend decides nothing). A switch that could not be flipped throws the route's reason: it must
// never LOOK flipped.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

/** @returns {Promise<{connections: Array<object>}>} impure */
export const getConnections = async () => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall('GET', '/api/v1/connections', { headers, errorPrefix: 'Could not read the connections', errorSuffix: '.' });
};

/**
 * @param {string} id
 * @param {boolean} on
 * @returns {Promise<{connections: Array<object>}>} impure
 */
export const setConnection = async (id, on) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall('PUT', `/api/v1/connections/${encodeURIComponent(id)}`, {
    headers, body: { on: on === true }, errorPrefix: 'Could not switch it', errorSuffix: '.',
  });
};
