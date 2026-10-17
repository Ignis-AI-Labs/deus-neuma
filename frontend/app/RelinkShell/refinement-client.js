// refinement-client.js — the REFINEMENT window's REST access.
//
// impure — every call reads/advances real backend state (the encrypted
// ceremony records, the live milestone, the rig's training slot). Reads
// resolve to null on failure; actions resolve to { ok, body|error } so the
// window can state refusals (milestone gate, single training slot) honestly.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

// impure
const act = async (url, method, payload) => {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const body = await apiCall(method, url, { headers, body: payload || {}, errorPrefix: 'The platform refused.' });
    return { ok: true, body };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: err.message, code: err.code };
  }
};

/**
 * @param {string} neumaId
 * @returns {Promise<Object|null>} milestone + adapters + ceremonies + binding + training
 */
// impure
export const loadRefinement = async (neumaId) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !headers) return null;
    return await apiCall('GET', `/api/v1/refinement/${neumaId}/status`, { headers, strictJson: true });
  } catch {
    return null;
  }
};

// pollTraining left with the forge (2026-08-24) — nothing trains, so there is
// no slot to follow. The ceremony window watches the RITE stream instead.

/** Issue one short-lived, server-bound capability for the adapter's current selection. */
export const issueAdapterScaleAuthority = (neumaId, adapterId) =>
  act(`/api/v1/refinement/${neumaId}/adapters/${adapterId}/scale-authority`, 'POST');

/** Consume one scale capability; no registry authority is accepted from the client. */
export const commitAdapterScale = (neumaId, adapterId, scale, authorityToken) =>
  act(`/api/v1/refinement/${neumaId}/adapters/${adapterId}/scale`, 'PUT', {
    scale,
    authorityToken,
  });
