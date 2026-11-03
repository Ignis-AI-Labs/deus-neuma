// legal-client.js — the operator's CLO-office client (the LEGAL window).
//
// impure — talks to the local backend with the session token. Reads the seat,
// the matters ledger, the watch and the posture; the writes (seat, clear, run
// the watch) are the operator's own calls. Settling a matter is the Praetor's
// reading, never the desk's. Every failure throws with the route's honest
// reason — a window that could not act must never LOOK like it did.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

const BASE = '/api/v1/legal';

// impure — the single transport every export below rides.
const legalCall = async (method, path, { body, errorPrefix } = {}) => {
  if (!authHeaders()) throw new Error('Not authenticated.');
  return apiCall(method, `${BASE}${path}`, { body, errorPrefix, errorSuffix: '.' });
};

/** @returns {Promise<{clo: {laneId: string, designatedAt: string}|null, counts: object, dueForReview: number, lastRunAt: string|null, lastRun: object|null}>} */
// impure
export const getLegalPosture = async () =>
  legalCall('GET', '/posture', { errorPrefix: 'Could not read the legal posture' });

/** @returns {Promise<{matters: Array<object>, counts: object}>} */
// impure
export const getMatters = async () =>
  legalCall('GET', '/matters', { errorPrefix: 'Could not read the matters ledger' });

/** @param {string} id @returns {Promise<{matter: object}>} */
// impure
export const getMatter = async (id) =>
  legalCall('GET', `/matters/${encodeURIComponent(id)}`, { errorPrefix: 'Could not read that matter' });

/** @returns {Promise<{watch: {lastRunAt: string|null, runs: Array<object>}}>} */
// impure
export const getLegalWatch = async () =>
  legalCall('GET', '/watch', { errorPrefix: 'Could not read the legal watch' });

/** Run the legal watch now — licences, papers, new work. @returns {Promise<{summary: object}>} */
// impure
export const runLegalWatch = async () =>
  legalCall('POST', '/watch/run', { errorPrefix: 'Could not run the legal watch' });

/** Seat a being as the house's Chief Legal Officer. @param {string} laneId */
// impure
export const seatClo = async (laneId) =>
  legalCall('PUT', '/seat', { body: { laneId }, errorPrefix: 'Could not seat the CLO' });

/** Clear the CLO seat — the watch keeps running; the office stands empty. */
// impure
export const clearClo = async () =>
  legalCall('DELETE', '/seat', { errorPrefix: 'Could not clear the CLO seat' });

/** The house's second reader and the choices it may take. @returns {Promise<{reader: {provider: string}, choices: Array<{provider: string, label: string}>}>} */
// impure
export const getReader = async () =>
  legalCall('GET', '/reader', { errorPrefix: 'Could not read the second reader' });

/** Choose the house's second reader: 'house' or a connected provider id. @param {string} provider */
// impure
export const setReader = async (provider) =>
  legalCall('PUT', '/reader', { body: { provider }, errorPrefix: 'Could not set the second reader' });
