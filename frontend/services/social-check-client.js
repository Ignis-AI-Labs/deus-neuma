// social-check-client.js — the house social check over REST (campaign plan
// §6.1): every account the house uses, checked and rolled up per company,
// tree and house; the rest OPTIONAL. Masked — key names, never a value.
//
// impure — network. `fresh` proves every account live again (no cache).

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

/** The house's social check. impure. */
export const getHouseCheck = ({ fresh = false } = {}) => {
  const headers = authHeaders();
  if (!headers) return Promise.reject(new Error('Not authenticated.'));
  return apiCall('GET', `/api/v1/social-channels/accounts/house-check${fresh ? '?fresh=1' : ''}`, {
    headers, errorPrefix: 'Social check failed', errorSuffix: '.',
  });
};
