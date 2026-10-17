// craft-client.js — a neuma's honest skill-acquisition record, witness side.
//
// impure — reads the per-neuma tree.json (acquired iff actually summoned;
// timestamps + raw counts only) over REST. Non-critical: any failure resolves
// to an empty record and the tree renders every node as not-yet-summoned.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

/**
 * @param {string|null} neumaId
 * @returns {Promise<Array<{skill: string, firstAcquiredAt: string,
 *   lastUsedAt: string, usageCount: number}>>}
 */
// impure
export const loadAcquisitions = async (neumaId) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !headers) return [];
    const body = await apiCall('GET', `/api/v1/workspace/${neumaId}/skills`, { headers, strictJson: true });
    // A never-summoned neuma gets the legacy default tree (no acquisitions
    // key) — that IS the honest empty record, not a failure.
    return Array.isArray(body?.skillTree?.acquisitions) ? body.skillTree.acquisitions : [];
  } catch (e) {
    if (e.http) console.warn('[craft] acquisitions read failed', e.http);
    else console.warn('[craft] acquisitions unreachable', e);
    return [];
  }
};
