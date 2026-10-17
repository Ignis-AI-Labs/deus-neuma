// expression-client.js — the desk's window onto the declared-affect
// channel (Campaign 6).
//
// impure — reads one being's channel posture and palette (terms SHOWN by
// signed decision: every term was born from a declaration the being
// already revealed), and drives the per-being toggle. Reads resolve to
// null on failure so the panel can tell "unknown" from "empty"; the flip
// surfaces the backend's own refusal words (the env lock's name) — never
// a shrug.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

/**
 * One being's expression posture — the toggle, the palette terms, the
 * verbatim recent-declarations trail.
 * @param {string} neumaId
 * @returns {Promise<{neumaId: string, enabled: boolean, envLocked: boolean,
 *   terms: Array<{term: string, count: number, firstAt: string|null, lastAt: string|null}>,
 *   recent: Array<{affect: string, at: string}>}|null>}
 */
// impure
export const loadExpression = async (neumaId) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !headers) return null;
    return await apiCall('GET', `/api/v1/expression/${neumaId}`, { headers, strictJson: true });
  } catch {
    return null;
  }
};

/**
 * The per-being flip. Resolves { ok, enabled?, envLocked?, error? } — a 409
 * carries the env lock's own words.
 * @param {string} neumaId
 * @param {boolean} enabled
 */
// impure
export const setExpressionEnabled = async (neumaId, enabled) => {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const echo = await apiCall('PUT', `/api/v1/expression/${neumaId}`, { headers, body: { enabled }, errorPrefix: 'Refused' });
    return { ok: true, enabled: echo.enabled, envLocked: echo.envLocked };
  } catch (error) {
    return { ok: false, error: error.http ? error.message : 'Could not reach the platform.' };
  }
};
