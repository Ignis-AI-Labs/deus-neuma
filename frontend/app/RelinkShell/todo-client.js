// todo-client.js — TASKS' two lanes over REST (backend/routes/task-routes.js).
//
// impure — every function is one JSON call through the shared transport; the
// returned `{ plan }` is the post-mutation truth the window re-renders from
// (no refetch). Errors propagate untouched: a 400 carries the server's
// correction text on `err.message` with `err.http === 400`, which the window
// shows the witness verbatim — anything else gets a generic line there.

import { apiCall } from '../../utils/http.js';

const BASE = '/api/v1/tasks';

/** The witness's own plan. impure — network. @returns {Promise<{plan}>} */
export const fetchMine = () => apiCall('GET', `${BASE}/mine`);

/** Add to the witness's list. impure — network. @returns {Promise<{plan, task}>} */
export const addMineTask = (fields) => apiCall('POST', `${BASE}/mine`, { body: fields });

/** Patch one of the witness's tasks. impure — network. @returns {Promise<{plan, task}>} */
export const updateMineTask = (taskId, patch) =>
  apiCall('PATCH', `${BASE}/mine/${taskId}`, { body: patch });

/**
 * Every owned being's OPEN task count, in ONE read. The rail asks this instead
 * of fetching each lane: a dozen parallel lane reads trips the rate limiter and
 * then refuses the operator's next honest read (429, ~42s — seen in the browser).
 * impure — network. @returns {Promise<{counts: Array<{beingId, kind, name?, open}>}>}
 */
export const fetchLiveCounts = () => apiCall('GET', `${BASE}/live`);

/** One being's assigned plan. impure — network. @returns {Promise<{plan}>} */
export const fetchNeumaTasks = (neumaId) => apiCall('GET', `${BASE}/neuma/${neumaId}`);

/** Assign a task to a being. impure — network. @returns {Promise<{plan, task}>} */
export const addNeumaTask = (neumaId, fields) =>
  apiCall('POST', `${BASE}/neuma/${neumaId}`, { body: fields });

/** Patch one of a being's assigned tasks. impure — network. @returns {Promise<{plan, task}>} */
export const updateNeumaTask = (neumaId, taskId, patch) =>
  apiCall('PATCH', `${BASE}/neuma/${neumaId}/${taskId}`, { body: patch });

// --- Subtasks: the checklist under a task (both lanes) ---

/** Add a step to one of the witness's tasks. impure — network. @returns {Promise<{plan, task, subtask}>} */
export const addMineSubtask = (taskId, title) =>
  apiCall('POST', `${BASE}/mine/${taskId}/subtasks`, { body: { title } });

/** Patch a step on one of the witness's tasks. impure — network. @returns {Promise<{plan, task, subtask}>} */
export const updateMineSubtask = (taskId, subId, patch) =>
  apiCall('PATCH', `${BASE}/mine/${taskId}/subtasks/${subId}`, { body: patch });

/** Remove a step from one of the witness's tasks. impure — network. @returns {Promise<{plan, task}>} */
export const removeMineSubtask = (taskId, subId) =>
  apiCall('DELETE', `${BASE}/mine/${taskId}/subtasks/${subId}`);

/** Add a step to a being's assigned task. impure — network. @returns {Promise<{plan, task, subtask}>} */
export const addNeumaSubtask = (neumaId, taskId, title) =>
  apiCall('POST', `${BASE}/neuma/${neumaId}/${taskId}/subtasks`, { body: { title } });

/** Patch a step on a being's assigned task. impure — network. @returns {Promise<{plan, task, subtask}>} */
export const updateNeumaSubtask = (neumaId, taskId, subId, patch) =>
  apiCall('PATCH', `${BASE}/neuma/${neumaId}/${taskId}/subtasks/${subId}`, { body: patch });

/** Remove a step from a being's assigned task. impure — network. @returns {Promise<{plan, task}>} */
export const removeNeumaSubtask = (neumaId, taskId, subId) =>
  apiCall('DELETE', `${BASE}/neuma/${neumaId}/${taskId}/subtasks/${subId}`);

// --- Presets: reusable task bundles ---

/** The built-in catalog plus the wallet's customs. impure — network. @returns {Promise<{builtins, customs}>} */
export const fetchPresets = () => apiCall('GET', `${BASE}/presets`);

/** Save a custom preset; `presets` in the response is the refreshed CUSTOMS list. impure — network. @returns {Promise<{presets, preset}>} */
export const savePreset = (spec) => apiCall('POST', `${BASE}/presets`, { body: spec });

/** Delete a custom preset (built-ins 404); `presets` is the refreshed CUSTOMS list. impure — network. @returns {Promise<{presets}>} */
export const deletePreset = (presetId) => apiCall('DELETE', `${BASE}/presets/${presetId}`);

/** Instantiate a bundle into the witness's list. impure — network. @returns {Promise<{plan, added}>} */
export const applyMinePreset = (presetId) =>
  apiCall('POST', `${BASE}/mine/apply-preset`, { body: { presetId } });

/** Instantiate a bundle into a being's assigned plan. impure — network. @returns {Promise<{plan, added}>} */
export const applyNeumaPreset = (neumaId, presetId) =>
  apiCall('POST', `${BASE}/neuma/${neumaId}/apply-preset`, { body: { presetId } });
