// chat-line-client.js — the CHAT LINE switches, over REST (backend/routes/chat-line-routes.js).
//
// impure — reads which sealed AI witnesses may speak in your open chats, and flips one. The backend decides and
// answers with the whole board, so a switch never looks flipped before it is; a refusal throws the route's reason.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

/** @returns {Promise<{witnesses: Array<{name: string, vendor: string, wallet: string, on: boolean, since: string|null}>}>} impure */
export const getChatLines = async () => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall('GET', '/api/v1/chat-line/witnesses', { headers, errorPrefix: 'Could not read the chat line', errorSuffix: '.' });
};

/**
 * @param {string} wallet the witness's sealed wallet
 * @param {boolean} on
 * @returns {Promise<{witnesses: Array<object>}>} impure
 */
export const setChatLine = async (wallet, on) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall('PUT', `/api/v1/chat-line/witnesses/${encodeURIComponent(wallet)}`, {
    headers, body: { on: on === true }, errorPrefix: 'Could not switch it', errorSuffix: '.',
  });
};
