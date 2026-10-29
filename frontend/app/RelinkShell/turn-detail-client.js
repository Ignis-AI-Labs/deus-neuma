// turn-detail-client.js — one point's full rows (every take), fetched the first
// time the desk opens something the display view left out of it: a thought, a
// tool result, a pasted image (backend: GET …/sessions/:id/turns/:turnId).
// Each point is read once and kept; the oldest fall away past the cap.
//
// impure — talks to the platform.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

const CAP = 40;
const kept = new Map();

/**
 * impure — the rows of one point, cached; a failed read is not kept.
 * @param {{neumaId: string, sessionId: string, turnId: string}} at
 * @returns {Promise<Array<object>>}
 */
export const loadTurnRows = ({ neumaId, sessionId, turnId }) => {
  const key = `${neumaId}|${sessionId}|${turnId}`;
  if (!kept.has(key)) {
    const headers = authHeaders();
    const read = (headers
      ? apiCall('GET', `/api/v1/workspace/${neumaId}/sessions/${sessionId}/turns/${turnId}`, { headers, strictJson: true })
      : Promise.reject(new Error('not signed in')))
      .then((body) => (Array.isArray(body?.rows) ? body.rows : []))
      .catch((err) => { kept.delete(key); throw err; });
    kept.set(key, read);
    if (kept.size > CAP) kept.delete(kept.keys().next().value);
  }
  return kept.get(key);
};
