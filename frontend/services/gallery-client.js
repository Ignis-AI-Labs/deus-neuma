// gallery-client.js — the desk's line to THE GALLERY.
//
// impure. Reach is decided entirely server-side by the root allowlist; nothing
// here sends a filesystem path except when the operator is explicitly ADDING a
// folder, which is the grant itself.

import { apiCall, authHeadersOrNull as authHeaders, jsonHeaders } from '../utils/http.js';
import { deskTicketUrl } from './desk-tickets.js';

const req = async (path, init = {}) => {
  const headers = init.body ? jsonHeaders() : authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall(init.method || 'GET', `/api/v1/gallery${path}`, {
    body: init.body, headers, errorPrefix: 'Gallery request failed', errorSuffix: '.',
  });
};

/**
 * A src an `<img>`/`<video>` can load BY ITSELF. The element issues its own GET
 * and can attach no headers, so a short-lived ticket bound to this item rides
 * the query. The browser owns loading, caching and eviction from here on.
 * @param {{rootId: string, rel: string}} item
 * @returns {Promise<string>}
 */
export const fileSrc = (item) => deskTicketUrl('/api/v1/gallery/file', { rootId: item.rootId, rel: item.rel });

/** Every image and video in reach, plus per-root state (count/truncated/error). */
export const getItems = (rootId = null) =>
  req(`/items${rootId ? `?rootId=${encodeURIComponent(rootId)}` : ''}`);

/** The folders the gallery reads. */
export const getRoots = () => req('/roots');

/** Add a folder to the read list — this IS the access grant. */
export const addRoot = (dir, label) =>
  req('/roots', { method: 'POST', body: { dir, label } });

/** Stop reading a folder. The built-in ComfyUI output root refuses removal. */
export const removeRoot = (id) => req(`/roots/${encodeURIComponent(id)}`, { method: 'DELETE' });
