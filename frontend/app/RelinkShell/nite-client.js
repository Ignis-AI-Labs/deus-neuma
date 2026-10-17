// nite-client — the NITE window's one read. impure.
//
// One request for the WHOLE house, not two per lane: the standing table exists
// to be opened often, and a per-lane fan-out would spend the rate limiter on
// a glance. The endpoint rides the roster because it IS the roster, carrying
// what each owned being still owes.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

/**
 * impure — every owned being's NITE standing.
 *
 * A failure resolves to `null`, never an empty house: "no beings" and […] are different truths, and showing the first when the second is
 * the case would report a clean house that was never checked.
 * @returns {Promise<null|{house: {name: string}, beings: Array}>}
 */
export const loadStanding = async () => {
  try {
    const headers = authHeaders();
    if (!headers) return null;
    const body = await apiCall('GET', '/api/v1/roster/standing', { headers, strictJson: true });
    return Array.isArray(body?.beings) ? body : null;
  } catch {
    return null;
  }
};
