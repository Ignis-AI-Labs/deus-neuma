// council-labels.js — the operator's own names for their councils (per wallet).
// A council's default label is its member roster; this overlays a custom name,
// and the conduit can write one from what was deliberated.
// impure — Bearer from the session.

import { apiCall, authHeadersOrNull } from '../utils/http.js';

const BASE = '/api/v1/user/realm/council-labels';

// impure — { "<councilId>": "label" }; any failure reads as empty.
export const getCouncilLabels = async () => {
  try {
    return (await apiCall('GET', BASE, { errorPrefix: 'Could not read council labels' })).labels || {};
  } catch {
    return {};
  }
};

// impure — set or clear (empty label) a council's name → the updated label map.
export const setCouncilLabel = async (councilId, label) =>
  (await apiCall('PUT', BASE, { body: { councilId, label }, errorPrefix: 'Rename failed' })).labels || {};

/**
 * Ask the conduit to name councils from what was deliberated — one council
 * (councilIds) or the whole shelf; `force` retitles even already-named
 * councils. Returns per-council results plus the updated label map (null
 * labels when the call itself failed, so the caller keeps its current names).
 * @param {Object} [opts]
 * @param {string[]} [opts.councilIds]
 * @param {boolean} [opts.force=false]
 * @returns {Promise<{results: Array<{councilId: string, status: string, label?: string}>, labels: Object|null}>}
 */
// impure
export const autotitleCouncils = async ({ councilIds, force = false } = {}) => {
  try {
    const headers = authHeadersOrNull();
    if (!headers) return { results: [], labels: null };
    const body = await apiCall('POST', `${BASE}/autotitle`, {
      headers, strictJson: true,
      body: { ...(councilIds ? { councilIds } : {}), force },
    });
    return {
      results: Array.isArray(body?.results) ? body.results : [],
      labels: body?.labels && typeof body.labels === 'object' ? body.labels : null,
    };
  } catch {
    return { results: [], labels: null };
  }
};
