// money-in-client.js — the operator's client for the house's receive ledger:
// totals, the latest receipts, the watch set, the extra receive addresses and
// a scan now. RECEIVE-ONLY by construction: the routes behind it can send
// nothing, sign nothing, and hold no key — so neither can this.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

const BASE = '/api/v1/money-in';

// impure — the single transport every export below rides.
const moneyCall = async (method, path, { body, errorPrefix } = {}) => {
  if (!authHeaders()) throw new Error('Not authenticated.');
  return apiCall(method, `${BASE}${path}`, { body, errorPrefix, errorSuffix: '.' });
};

const query = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();

/** @returns {Promise<{summary: Object}>} impure */
export const getMoneyInTotals = ({ from, to } = {}) =>
  moneyCall('GET', `/totals?${query({ from, to })}`, { errorPrefix: 'Could not total money in' });

/** @returns {Promise<{total: number, receipts: Object[]}>} impure */
export const getMoneyInLedger = ({ limit = 10 } = {}) =>
  moneyCall('GET', `/ledger?limit=${limit}`, { errorPrefix: 'Could not read money in' });

/** @returns {Promise<{watched: Object[], unwatched: Object[], extras: Object[], lastScan: ?Object, gaps: Object[]}>} impure */
export const getMoneyInWatch = () => moneyCall('GET', '/watch', { errorPrefix: 'Could not read the watch' });

/** Scan now. The server refuses (409) while chain access is switched off. impure */
export const scanMoneyIn = () => moneyCall('POST', '/scan', { errorPrefix: 'The scan did not run' });

/** Declare an extra receive address. impure */
export const declareReceiveAddress = (address, { label, member } = {}) =>
  moneyCall('PUT', `/addresses/${encodeURIComponent(address)}`, {
    body: { label, ...(member ? { member } : {}) }, errorPrefix: 'Could not declare the address',
  });

/** Stop watching an extra address; its receipts stay. impure */
export const removeReceiveAddress = (address) =>
  moneyCall('DELETE', `/addresses/${encodeURIComponent(address)}`, { errorPrefix: 'Could not remove the address' });
