// inference.js — the composer's model bar, read and written for ONE being.
//
// The backend owns every judgement here: which models this being may ride, which
// one is loaded, whether the route has an effort ladder at all, and which rung it
// sits on. The desk renders that answer and sends back only a rung — it never
// derives a capability from a model name (docs: backend/services/model-effort.js).
//
// impure — Bearer from the session. Read failures reach the bar's retry state.

import { apiCall } from '../utils/http.js';

const BASE = '/api/v1/inference';

const read = (path) => apiCall('GET', `${BASE}${path}`, {
  errorPrefix: 'Could not read inference settings',
});

/**
 * The models this being may ride, which one is loaded, and HOW a move happens
 * ('ignite' — the rig loads other weights; 'route' — the override moves).
 * @param {string} beingId neumaId or witness lane id
 * @returns {Promise<{route: object, switchBy: string, models: Array<{id: string, name?: string}>, loadedId: string|null}>}
 * @throws {Error} When the model read fails.
 */
// impure
export const getBeingModels = (beingId) =>
  read(`/${encodeURIComponent(beingId)}/models`);

/**
 * The effort ladder this being's route has and the rung it sits on. The ladder
 * carries the vendor's own label per rung (backend/services/model-effort.js).
 * @param {string} beingId
 * @returns {Promise<{route: object, capability: {channel: string, tiers: string[], labels: object, thinking: boolean, thinkingLabel: string}, choice: {effort: string|null, thinking: boolean}, chosen: boolean, thinks: boolean}>}
 * @throws {Error} When the effort read fails.
 */
// impure
export const getBeingEffort = (beingId) =>
  read(`/${encodeURIComponent(beingId)}/effort`);

/**
 * Set the being's effort choice — the rung and the thinking switch, both named
 * explicitly. The bar's two controls are ONE stored choice, so each sends the
 * whole thing; a field dropped here is a control that silently never saves,
 * which is exactly what happened to THINKING before 2026-07-29.
 * Throws on refusal so the bar can say what happened.
 * @param {string} beingId
 * @param {{effort: string, thinking?: boolean}} choice
 * @returns {Promise<object>} the fresh effort view
 */
// impure
export const setBeingEffort = (beingId, { effort = undefined, thinking = true }) =>
  apiCall('PUT', `${BASE}/${encodeURIComponent(beingId)}/effort`, {
    body: { effort, thinking },
    errorPrefix: 'Could not set the effort',
  });

/**
 * The authorized MODEL FOLDERS (the folder law: a chosen folder lists AND
 * authorizes its models, and names which engines may load from it) plus the
 * full engine vocabulary. Null when unreadable — the panel stands down.
 * @returns {Promise<{folders: Array<{path: string, servers: string[]}>, servers: string[]}|null>}
 */
// impure
export const getModelFolders = async () => {
  try {
    return await apiCall('GET', '/api/v1/llm/model-folders', { strictJson: true });
  } catch {
    return null;
  }
};

/**
 * Replace the authorized model folders. Throws on refusal (a 400 carries the
 * store's own correction) so the panel can say what happened.
 * @param {Array<{path: string, servers?: string[]}>} folders
 * @returns {Promise<{folders: Array, servers: string[]}>}
 */
// impure
export const setModelFoldersClient = (folders) =>
  apiCall('PUT', '/api/v1/llm/model-folders', {
    body: { folders },
    errorPrefix: 'Could not set the model folders',
  });
