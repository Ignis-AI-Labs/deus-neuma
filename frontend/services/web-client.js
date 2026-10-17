// web-client.js — the operator's web-egress switch, over REST.
//
// impure — reads and flips the machine-wide master switch the backend
// enforces (the portal's web tools stand or fall by it, not by anything the
// frontend does). Failures surface as thrown errors with the route's honest
// reason — a switch that could not be flipped must never LOOK flipped.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

/**
 * @returns {Promise<{enabled: boolean, envLocked: boolean, searchBackend: string, pageReader: string}>}
 */
// impure
export const getWebAccess = async () => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall('GET', '/api/v1/web/web-access', {
    headers, errorPrefix: 'Could not read web access', errorSuffix: '.',
  });
};

/**
 * @param {boolean} enabled
 * @returns {Promise<{enabled: boolean, envLocked: boolean, searchBackend: string, pageReader: string}>}
 */
// impure
export const setWebAccess = async (enabled) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall('PUT', '/api/v1/web/web-access', {
    headers, body: { enabled: enabled === true },
    errorPrefix: 'Could not switch web access', errorSuffix: '.',
  });
};
