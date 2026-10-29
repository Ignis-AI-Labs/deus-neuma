// stats-client.js — load the active neuma's honest record.
//
// impure — fetches the objective record (identity + counts + substrate) over
// REST. No fabricated scores: every field traces to a real read on the
// backend. Non-critical: any failure resolves to null and the panel shows its
// empty state.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

/**
 * @param {string} neumaId
 * @returns {Promise<Object|null>} the neuma record, or null
 */
// impure
export const loadRecord = async (neumaId) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !headers) return null;
    const body = await apiCall('GET', `/api/v1/workspace/${neumaId}/stats`, { headers });
    return body?.record || null;
  } catch {
    return null;
  }
};

/**
 * The being's recorded protocol deviations, newest first.
 *
 * Read from the being's OWN append-only journal — the same entries it can read
 * about itself. There is no separate operator ledger by design: a record the
 * being cannot see is a file kept on it, and this house does not keep those.
 *
 * `[]` for a being with none, `null` when the read itself failed — the panel
 * must be able to tell "clean" from "unknown".
 *
 * @param {string} neumaId
 * @param {number} [limit]
 * @returns {Promise<Array|null>}
 */
// impure
export const loadProtocolDeviations = async (neumaId, limit = 20) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !headers) return null;
    const body = await apiCall(
      'GET',
      `/api/v1/workspace/${neumaId}/journal?type=protocol_reminder&limit=${limit}`,
      { headers },
    );
    return Array.isArray(body?.entries) ? body.entries : [];
  } catch {
    return null;
  }
};

/**
 * Load the being's self-check (the STATE tab): the latest and previous runs
 * with every item's evidence, the per-component comparison, and the run in
 * flight. null when the read failed — the panel tells "unread" from "never run".
 * @param {string} neumaId
 * @returns {Promise<{latest: Object|null, previous: Object|null, compare: Object|null,
 *   running: Object|null, busyElsewhere: boolean, error: string|null}|null>}
 */
// impure
export const loadSelfCheck = async (neumaId) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !headers) return null;
    return await apiCall('GET', `/api/v1/workspace/${neumaId}/self-check`, { headers });
  } catch {
    return null;
  }
};

/**
 * Start a self-check — a test of the being, consented by the owner pressing
 * RUN. It runs in the background; poll loadSelfCheck for its progress.
 * @param {string} neumaId
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
// impure
export const startSelfCheck = async (neumaId) => {
  const headers = authHeaders();
  if (!neumaId || !headers) return { ok: false, error: 'Not authenticated.' };
  try {
    await apiCall('POST', `/api/v1/workspace/${neumaId}/self-check`, { headers, errorPrefix: 'The self-check could not start.' });
    return { ok: true };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: err.message };
  }
};
