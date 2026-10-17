// doc-press-client.js — THE PRESS board, over REST.
//
// impure — lists the brand kits the backend holds and presses markdown into
// a branded PDF (rendered server-side by a real Chromium, no egress). A
// press returns raw PDF bytes; failures surface as thrown errors with the
// route's honest reason.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

/**
 * The press board: available brand kits + whether this machine can press.
 * @returns {Promise<{kits: Array<{id: string, name: string, companyName: string}>, chromium: {available: boolean, detail?: string}}>}
 */
// impure
export const getPressBoard = async () => {
  if (!authHeaders()) throw new Error('Not authenticated.');
  return apiCall('GET', '/api/v1/doc-press', { errorPrefix: 'Press request failed', errorSuffix: '.' });
};

/**
 * Press markdown into a branded PDF. Resolves to the PDF blob and the
 * filename the server chose.
 * @param {{markdown: string, title?: string, kitId?: string}} params
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
// impure
export const pressMarkdown = async ({ markdown, title, kitId }) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  const res = await fetch('/api/v1/doc-press/press', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown, title, kitId }),
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => ({}));
    const kitHint = Array.isArray(parsed?.kits) && parsed.kits.length > 0
      ? ` Available kits: ${parsed.kits.join(', ')}.` : '';
    throw new Error((parsed?.error || `Press failed (${res.status}).`) + kitHint);
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || 'document.pdf';
  return { blob: await res.blob(), filename };
};
