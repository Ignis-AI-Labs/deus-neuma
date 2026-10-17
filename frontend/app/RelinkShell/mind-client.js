// mind-client.js — the desk's window onto the mind layer (#317).
//
// impure — reads the influence gates (with their env locks named) and the
// shadow rings' fill, reads one being's mind posture in counts only, and
// drives the gate switch. Reads resolve to null on failure so the panel can
// tell "unknown" from "empty"; the switch surfaces the backend's own refusal
// words (env lock, depth-live law) — never a shrug.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

/**
 * @returns {Promise<{gates: Object, shadow: Object}|null>}
 */
// impure
export const loadMind = async () => {
  try {
    const headers = authHeaders();
    if (!headers) return null;
    return await apiCall('GET', '/api/v1/mind', { headers, strictJson: true });
  } catch {
    return null;
  }
};

/**
 * One being's mind posture — counts by kind, freshness. Contents never ride.
 * @param {string} neumaId
 * @returns {Promise<{neumaId: string, total: number, kinds: Object, latestAt: string|null}|null>}
 */
// impure
export const loadMindPosture = async (neumaId) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !headers) return null;
    return await apiCall('GET', `/api/v1/mind/${neumaId}`, { headers, strictJson: true });
  } catch {
    return null;
  }
};

/**
 * The gate switch. Resolves { ok, gates?, error? } — a 409 carries the env
 * lock's (or the depth-live law's) own words.
 * @param {string} gate - 'undercurrent' | 'depthFilter' | 'memoryLinks'
 * @param {string} mode
 */
// impure
export const setMindGate = async (gate, mode) => {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const echo = await apiCall('PUT', '/api/v1/mind/gates', { headers, body: { gate, mode }, errorPrefix: 'Refused' });
    return { ok: true, gates: echo.gates };
  } catch (error) {
    return { ok: false, error: error.http ? error.message : 'Could not reach the platform.' };
  }
};
