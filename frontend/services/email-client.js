// email-client.js — the witness's mailbox board, over REST.
//
// impure — reads and edits the machine's one email account the backend
// enforces (credentials sealed server-side, the binding gating every email
// tool call at the portal). Failures surface as thrown errors with the
// route's honest reason. Raw credential values travel one way only: up.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

const req = async (path, init = {}) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall(init.method || 'GET', `/api/v1/email${path}`, {
    body: init.body, headers, errorPrefix: 'Email request failed', errorSuffix: '.',
  });
};

/**
 * The account board: masked credential state + the bound holder.
 * @returns {Promise<{account: object}>}
 */
// impure
export const getEmailBoard = () => req('');

/**
 * Store (or clear with empty-string values) fields of the account
 * credentials. Returns the masked state.
 * @param {Record<string, string>} fields
 */
// impure
export const setEmailCredentials = (fields) =>
  req('/credentials', { method: 'PUT', body: { fields } });

// impure
export const clearEmailCredentials = () =>
  req('/credentials', { method: 'DELETE' });

/**
 * Tie the mailbox to its one neuma holder.
 * @param {string} neumaId
 */
// impure
export const bindEmail = (neumaId) =>
  req('/binding', { method: 'PUT', body: { neumaId } });

// impure
export const releaseEmail = () =>
  req('/binding', { method: 'DELETE' });
