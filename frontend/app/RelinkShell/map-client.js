// map-client.js — the architecture map, witness side.
//
// impure — fetches a repository's architecture graph (routes, channels,
// functions/call-graph, anomalies) over REST. Like graph-client, a failure does
// NOT collapse into an empty success: the Map window renders states honestly, so
// the HTTP status travels back (404 = nothing to map, a real distinct state).

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

/**
 * Load the architecture map of a folder (this window's focus) or, with no
 * folder, the NEUMA repo by default. The folder is only a HINT — the server
 * re-validates it against the opened roots (403 on escape).
 * @param {string|null} folder - focus folder hint
 * @returns {Promise<{ok: true, project: object, graph: object}
 *   | {ok: false, status: number|null}>} status 404 = nothing to map;
 *   403 = folder outside the opened roots; null = unauthenticated or the
 *   platform never answered.
 */
// impure
export const loadArchitectureMap = async (folder = null) => {
  const headers = authHeaders();
  if (!headers) return { ok: false, status: null };
  try {
    const q = folder ? `?folder=${encodeURIComponent(folder)}` : '';
    const body = await apiCall('GET', `/api/v1/map${q}`, { headers });
    return { ok: true, project: body.project, graph: body.graph };
  } catch (e) {
    if (e.http) return { ok: false, status: e.http };
    console.warn('[map] architecture map unreachable', e);
    return { ok: false, status: null };
  }
};
