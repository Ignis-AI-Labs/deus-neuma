// graph-client.js — the crystallized-memory graph, witness side.
//
// impure — fetches the server-computed memory graph (nodes, edges,
// communities; bounded label previews, never raw memory text) over REST.
// Unlike craft-client, a failure does NOT collapse into an empty success:
// the FIELD view renders failures honestly, so the HTTP status travels back.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

/**
 * @param {string|null} neumaId
 * @returns {Promise<{ok: true, graph: {nodes: Array, edges: Array,
 *   communities: Array, computedAt: string, truncatedTo?: number}}
 *   | {ok: false, status: number|null}>} status null = no companion
 *   session, or the platform never answered
 */
// impure
export const loadMemoryGraph = async (neumaId) => {
  const headers = authHeaders();
  if (!neumaId || !headers) return { ok: false, status: null };
  try {
    const graph = await apiCall('GET', `/api/v1/workspace/${neumaId}/memory/graph`, { headers });
    return { ok: true, graph };
  } catch (e) {
    if (e.http) return { ok: false, status: e.http };
    console.warn('[field] memory graph unreachable', e);
    return { ok: false, status: null };
  }
};
