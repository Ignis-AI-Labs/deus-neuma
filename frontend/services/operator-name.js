// operator-name.js — the operator's SYNCED name (server truth, per wallet).
//
// impure — talks to the local backend with the session token. The desk's
// localStorage copy (app/RelinkShell/witness-name.js) stays the instant
// same-device read for the HOUSE header and the founding rite; THIS is the
// store the beings read on every portal turn, so a name set here follows
// the operator across desks and browser resets.

import { apiCall } from '../utils/http.js';

/** @returns {Promise<string>} the stored name, '' when never set */
// impure
export const getOperatorName = async () => {
  const data = await apiCall('GET', '/api/v1/user/realm/operator-name', {
    strictJson: true, useServerError: false, errorPrefix: 'Could not read the operator name',
  });
  return data.name || '';
};

/**
 * Store the operator's name (an empty name clears it).
 * @param {string} name
 * @returns {Promise<string>} the cleaned stored name
 */
// impure
export const setOperatorNameSynced = async (name) => {
  const data = await apiCall('PUT', '/api/v1/user/realm/operator-name', {
    body: { name }, errorPrefix: 'Could not save the name',
  });
  return data.name || '';
};
