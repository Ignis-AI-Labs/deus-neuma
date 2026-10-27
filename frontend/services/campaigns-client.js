// campaigns-client.js — the operator's window onto the house campaign board,
// over REST.
//
// impure — reads and edits the campaign ledger the backend keeps (each
// campaign organizing the queue beneath it, plus the single CMO designation
// naming the being who holds the marketing position). Failures surface as
// thrown errors with the route's honest reason.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

// impure — every call is network IO against the campaign routes.
const req = async (path, init = {}) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall(init.method || 'GET', `/api/v1/campaigns${path}`, {
    headers,
    ...(init.body !== undefined && { body: init.body }),
    errorPrefix: 'Campaign request failed', errorSuffix: '.',
  });
};

/**
 * Every campaign plus the vocabulary the board renders against.
 * @returns {Promise<{campaigns: Array<object>, statuses: string[], goalKinds: string[], kpiMetrics: string[]}>}
 */
// impure
export const getCampaigns = () => req('');

/**
 * Open one campaign (shape v2: companyId, goal, kpi, window, budget, angles,
 * subs, cadence, the plans, notes).
 * @param {object} campaign
 */
// impure
export const createCampaign = (campaign) =>
  req('', { method: 'POST', body: campaign });

/**
 * Edit one campaign — any subset of the create fields.
 * @param {string} id
 * @param {object} change
 */
// impure
export const updateCampaign = (id, change) =>
  req(`/${id}`, { method: 'PUT', body: change });

/**
 * Drop one campaign from the board entirely.
 * @param {string} id
 */
// impure
export const removeCampaign = (id) =>
  req(`/${id}`, { method: 'DELETE' });

/**
 * The current CMO designation, or null when no being holds the position.
 * @returns {Promise<{cmo: {laneId: string, designatedAt: string} | null}>}
 */
// impure
export const getCmo = () => req('/cmo');

/**
 * Designate the being who holds the CMO position, by lane id.
 * @param {string} laneId
 */
// impure
export const setCmo = (laneId) =>
  req('/cmo', { method: 'PUT', body: { laneId } });

/**
 * Clear the CMO designation — the position stands open again.
 */
// impure
export const clearCmo = () =>
  req('/cmo', { method: 'DELETE' });

/**
 * Tie a file to a campaign — its brief, brand voice, approved copy. The file's
 * content becomes always-on context for whoever works the campaign, so the
 * backend refuses secret-shaped paths (403) exactly as a tool call would.
 * impure.
 * @param {string} id
 * @param {string} path absolute path
 */
export const attachCampaignFile = (id, path) =>
  req(`/${id}/files`, { method: 'POST', body: { path } });

/** Untie a file from a campaign. The file itself is never touched. impure. */
export const detachCampaignFile = (id, path) =>
  req(`/${id}/files`, { method: 'DELETE', body: { path } });

/**
 * The operator asks the CMO something on a campaign. impure.
 * @param {string} id
 * @param {string} text
 */
export const askOnCampaign = (id, text) =>
  req(`/${id}/asks`, { method: 'POST', body: { text } });

/**
 * The operator answers the CMO's ask (or withdraws their own). impure.
 * @param {string} id
 * @param {string} askId
 * @param {string} [answer]
 */
export const settleCampaignAsk = (id, askId, answer = '') =>
  req(`/${id}/asks/${encodeURIComponent(askId)}`, { method: 'PUT', body: { answer } });
