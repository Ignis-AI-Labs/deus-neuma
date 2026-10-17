// user-realm.js — the witness's own data realm (chat logs + its location).
//
// impure — talks to the local backend with the session token. The realm is
// the user's own store, separate from any neuma's sovereign workspace.

import { apiCall } from '../utils/http.js';

/** @returns {Promise<{root: string, stats: object}>} */
// impure
export const getRealm = async () => apiCall('GET', '/api/v1/user/realm', {
  strictJson: true, useServerError: false, errorPrefix: 'Could not read the data realm',
});

/**
 * Relocate the realm to an absolute path on this machine.
 * @param {string} root
 * @returns {Promise<{root: string, stats: object}>}
 */
// impure
export const setRealmLocation = async (root) =>
  apiCall('POST', '/api/v1/user/realm/location', { body: { root }, errorPrefix: 'Could not set the location' });
