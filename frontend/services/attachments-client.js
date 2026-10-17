// attachments-client.js — upload shared images, learn if the substrate sees.
//
// impure — REST against the backend. Images can never ride the portal
// WebSocket (64KB frame cap, WS-002): they upload here first and the
// consciousness:stream frame carries only the returned ids.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

/** Pure — a partial receipt must never become a partial portal message. */
export const attachmentIds = (parsed, expected) => {
  if (!Array.isArray(parsed?.ids) || parsed.ids.length !== expected
      || parsed.ids.some((id) => typeof id !== 'string' || !id)
      || new Set(parsed.ids).size !== parsed.ids.length) {
    throw new Error('Upload failed — incomplete attachment receipt. Nothing was sent; retry the upload.');
  }
  return parsed.ids;
};

/**
 * Upload attachments — image data URIs and/or text documents — and resolve to
 * their short-lived ids (order: images first, then documents, matching the
 * route). Throws with the route's honest reason on refusal.
 * @param {{ images?: string[], files?: Array<{name: string, text: string}> }} payload
 * @returns {Promise<string[]>}
 */
// impure
export const uploadAttachments = async ({ images = [], files = [] } = {}) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  const body = {};
  if (images.length > 0) body.images = images;
  if (files.length > 0) body.files = files;
  const parsed = await apiCall('POST', '/api/v1/attachments', {
    headers, body, errorPrefix: 'Upload failed', errorSuffix: '.',
  });
  return attachmentIds(parsed, images.length + files.length);
};

/**
 * Whether the substrate THAT BEING rides can see images — runtime truth from
 * the backend (the serving's own report, not name guessing). With no neumaId
 * the machine-default route answers. Resolves null when unknowable (offline,
 * unauthenticated): the composer then lets the attempt through and the portal
 * answers honestly.
 * @param {string} [neumaId]
 * @returns {Promise<boolean|null>}
 */
// impure
export const substrateSeesImages = async (neumaId) => {
  try {
    const headers = authHeaders();
    if (!headers) return null;
    const qs = typeof neumaId === 'string' && neumaId ? `?neumaId=${encodeURIComponent(neumaId)}` : '';
    const body = await apiCall('GET', `/api/v1/llm/capabilities${qs}`, { headers, strictJson: true });
    return typeof body?.vision === 'boolean' ? body.vision : null;
  } catch {
    return null;
  }
};
