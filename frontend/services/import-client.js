// import-client.js — BRING YOUR OLD ASSISTANT, over REST (backend/routes/import-routes.js).
//
// impure — finds the assistants left on this computer, brings one over, or saves what ChatGPT or
// Claude answered. Failures throw with the route's own words.

import { apiCall } from '../utils/http.js';

const errorPrefix = 'Import failed';

/** @returns {Promise<{found: Array<{kind: string, root: string, profile: string|null, label: string,
 *   counts: {aboutYou: number, notes: number, persona: number, skills: number}}>, ground: string|null}>} */
// impure
export const findAssistants = () => apiCall('GET', '/api/v1/imports/found', { errorPrefix });

/** @param {{kind: string, root: string, profile: string|null}} place */
// impure
export const bringAssistant = ({ kind, root, profile }) =>
  apiCall('POST', '/api/v1/imports/assistant', { body: { kind, root, profile }, errorPrefix }).then((d) => d.report);

/** @param {{from: 'chatgpt'|'claude'|'other', text: string}} pasted */
// impure
export const savePasted = ({ from, text }) =>
  apiCall('POST', '/api/v1/imports/pasted', { body: { from, text }, errorPrefix }).then((d) => d.report);
