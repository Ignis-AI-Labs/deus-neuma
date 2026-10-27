// marketing-board-client.js — a MARKETING level's board over REST: read the
// saved board (null = the level shows its default), record the operator's
// board whole, or return the level to its default. A refused board throws
// with every reason the route named.
//
// impure — network.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

// impure
const req = (method, level, body) => {
  const headers = authHeaders();
  if (!headers) return Promise.reject(new Error('Not authenticated.'));
  return apiCall(method, `/api/v1/marketing/board?level=${encodeURIComponent(level)}`, {
    headers, ...(body !== undefined ? { body } : {}), errorPrefix: 'Board request failed', errorSuffix: '.',
  });
};

/** One level's saved board, what was dropped from it, and the kinds and widths a board may hold. impure. */
export const getBoard = (level) => req('GET', level);

/** Record one level's board, panel by panel, in order. impure. */
export const saveBoard = (level, panels) => req('PUT', level, { panels });

/** Back to the default board at one level. impure. */
export const resetBoard = (level) => req('DELETE', level);
