// write-limit-client.js — the operator's WRITE LIMIT (backend/services/write-limit.js), over REST.
import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

/** @returns {Promise<{on: boolean, cap: number, default: number, max: number}>} */
export const getWriteLimit = async () => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall('GET', '/api/v1/security/write-limit', { headers, errorPrefix: 'Could not read the write limit' });
};

/** @param {{on?: boolean, cap?: number}} change */
export const setWriteLimit = async (change) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall('PUT', '/api/v1/security/write-limit', { headers, body: change, errorPrefix: 'Could not change the write limit' });
};
