// social-accounts-client.js — the house's social APPS and ACCOUNTS, and its
// COMPANIES, over REST (campaign plan §2.4–2.6). A platform's app is stored
// once; its accounts are many, each under one company.
//
// impure — the backend seals every key; answers are masked (which fields are
// set and where), never a value. Raw values travel one way only: up.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

const req = async (path, { method = 'GET', body } = {}) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall(method, path, { headers, body, errorPrefix: 'Accounts request failed', errorSuffix: '.' });
};
const at = (accountId) => `/api/v1/social-channels/accounts/${encodeURIComponent(accountId)}`;

/** The house's apps, accounts (each with its holder) and companies. impure. */
export const getHouseAccounts = () => req('/api/v1/social-channels/accounts');

/** Open an account on a platform under a company. impure. */
export const addAccount = ({ channelId, companyId, label, expectedHandle }) =>
  req('/api/v1/social-channels/accounts', { method: 'POST', body: { channelId, companyId, label, expectedHandle } });

/** Change an account's facts — company, label, expected handle. impure. */
export const updateAccount = (accountId, patch) => req(at(accountId), { method: 'PATCH', body: patch });

/** Paste an account's keys (empty string clears a field). impure. */
export const setAccountKeys = (accountId, fields) => req(`${at(accountId)}/credentials`, { method: 'PUT', body: { fields } });

/** Remove an account (its holder is released). impure. */
export const removeAccount = (accountId) => req(at(accountId), { method: 'DELETE' });

/** Store a platform's developer app keys, once for every account. impure. */
export const setAppKeys = (channelId, fields) =>
  req(`/api/v1/social-channels/apps/${encodeURIComponent(channelId)}`, { method: 'PUT', body: { fields } });

/** Tie an account to its one holder, or release it. impure. */
export const bindAccount = (accountId, neumaId) => req(`${at(accountId)}/binding`, { method: 'PUT', body: { neumaId } });
export const releaseAccount = (accountId) => req(`${at(accountId)}/binding`, { method: 'DELETE' });

/** Every account proven live with its own keys (fresh forces real probes). impure. */
export const getAccountFlights = ({ fresh = false } = {}) =>
  req(`/api/v1/social-channels/accounts/flight-test${fresh ? '?fresh=1' : ''}`);

/** CONNECT one account of a sign-in platform (youtube, tiktok). impure. */
const connectPath = (channelId, accountId) =>
  `/api/v1/social-channels/${channelId}/connect?account=${encodeURIComponent(accountId)}`;
export const startAccountConnect = (channelId, accountId) => req(connectPath(channelId, accountId), { method: 'POST' });
export const pollAccountConnect = (channelId, accountId) => req(connectPath(channelId, accountId));
export const cancelAccountConnect = (channelId, accountId) => req(connectPath(channelId, accountId), { method: 'DELETE' });
