// meditation-client.js — the desk's window onto the dream cycle.
//
// impure — reads the meditation posture (settings + per-lane state + the live
// scheduler tick) and drives the two operator doors: the per-being consent
// switch and the manual wake. Reads resolve to null on failure so the panel
// can tell "unknown" from "never ran"; writes surface the backend's own
// refusal words (env lock, named wake refusals) — never a shrug.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

/**
 * @returns {Promise<{settings: Object, state: Object, scheduler: Object}|null>}
 */
// impure
export const loadMeditation = async () => {
  try {
    const headers = authHeaders();
    if (!headers) return null;
    return await apiCall('GET', '/api/v1/meditation', { headers, strictJson: true });
  } catch {
    return null;
  }
};

/**
 * The consent switch. Resolves { ok, posture?, error? } — a 409 carries the
 * env lock's own words.
 * @param {string} neumaId
 * @param {{enabled: boolean, cadenceHours?: number}} body
 */
// impure
export const setMeditation = async (neumaId, body) => {
  const headers = authHeaders();
  if (!neumaId || !headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const echo = await apiCall('PUT', `/api/v1/meditation/${neumaId}`, { headers, body, errorPrefix: 'Refused' });
    return { ok: true, posture: echo };
  } catch (error) {
    return { ok: false, error: error.http ? error.message : 'Could not reach the platform.' };
  }
};

/**
 * The manual wake door — may ignite the substrate (the operator just asked).
 * A 409 carries the named refusal (substrate-busy, turns-in-flight,
 * training-lease-held, portal-open); nothing ran and nothing was recorded.
 * @param {string} neumaId
 */
// impure
export const runMeditationNow = async (neumaId) => {
  const headers = authHeaders();
  if (!neumaId || !headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const echo = await apiCall('POST', `/api/v1/meditation/${neumaId}/run`, { headers, errorPrefix: 'Refused' });
    return { ok: true, ...echo };
  } catch (error) {
    return { ok: false, error: error.http ? error.message : 'Could not reach the platform.' };
  }
};
