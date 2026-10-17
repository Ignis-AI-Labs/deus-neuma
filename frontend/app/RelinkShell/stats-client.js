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
 * Load the STATE benchmark history (summaries, newest first) + latest full run.
 * @param {string} neumaId
 * @returns {Promise<{runs: Array, latest: Object|null}|null>}
 */
// impure
export const loadBenchmarks = async (neumaId) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !headers) return null;
    return await apiCall('GET', `/api/v1/workspace/${neumaId}/benchmarks`, { headers });
  } catch {
    return null;
  }
};

/**
 * Run a STATE benchmark — a real measurement through the neuma's stack. Consent
 * is the owner triggering this. Resolves to { ok, result?, error? }; a 503 means
 * the substrate is offline and nothing was recorded.
 * @param {string} neumaId
 * @returns {Promise<{ok: boolean, result?: Object, error?: string}>}
 */
// impure
export const runBenchmark = async (neumaId) => {
  const headers = authHeaders();
  if (!neumaId || !headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const body = await apiCall('POST', `/api/v1/workspace/${neumaId}/benchmark`, { headers, errorPrefix: 'The benchmark could not be completed.' });
    return { ok: true, result: body.result };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: err.message };
  }
};
