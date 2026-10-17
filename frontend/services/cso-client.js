// cso-client.js — the operator's CSO-office client (Settings > Security > GUARDIAN).
//
// impure — talks to the local backend with the session token. Reads the seat,
// the threat ledger, the watch list, and the last scan; the writes (designate,
// clear, watch/unwatch, expected ports, run-scan) are the operator's own calls.
// Every failure throws with the route's honest reason — a panel that could not
// act must never LOOK like it did.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

const BASE = '/api/v1/cso';

/**
 * One JSON round-trip against the CSO routes: bearer headers, an optional JSON
 * body, and a thrown Error that carries the server's own refusal reason. The
 * house has no fetch-timeout idiom, so a long call (a scan run can take 30s+)
 * is simply awaited.
 * @param {string} method HTTP method
 * @param {string} path route path under /api/v1/cso
 * @param {{body?: *, errorPrefix?: string}} [options]
 * @returns {Promise<*>} the parsed response body ({} when it is not JSON)
 */
// impure — the single transport every export below rides.
const csoCall = async (method, path, { body, errorPrefix } = {}) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall(method, `${BASE}${path}`, { body, errorPrefix, errorSuffix: '.' });
};

/**
 * Seat a being as the house's Chief Security Officer. One seat, one holder.
 * @param {string} laneId the being's lane id (neumaId)
 * @returns {Promise<{cso: {laneId:string, designatedAt:string}}>}
 */
// impure
export const seatCso = async (laneId) =>
  csoCall('PUT', '/seat', { body: { laneId }, errorPrefix: 'Could not seat the CSO' });

/**
 * Clear the CSO seat. The watch keeps running; the office stands empty.
 * @returns {Promise<{cleared: boolean}>}
 */
// impure
export const clearCso = async () =>
  csoCall('DELETE', '/seat', { errorPrefix: 'Could not clear the CSO seat' });

/**
 * The threat ledger, optionally narrowed by status, layer, or repo.
 * @param {{status?: string, layer?: string, repo?: string}} [filters]
 * @returns {Promise<{threats: Array, counts: {total:number, byStatus:object, byLayer:object}}>}
 */
// impure
export const getThreats = async ({ status, layer, repo } = {}) => {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (layer) params.set('layer', layer);
  if (repo) params.set('repo', repo);
  const query = params.toString();
  return csoCall('GET', `/threats${query ? `?${query}` : ''}`, { errorPrefix: 'Could not read the threat ledger' });
};

/**
 * One threat whole — the full ledger entry, history and all: the CSO's
 * verdicts in order, each with its reasoning. The id (full or prefix).
 * @param {string} id
 * @returns {Promise<{threat: object}>}
 */
// impure
export const getThreat = async (id) =>
  csoCall('GET', `/threats/${encodeURIComponent(id)}`, { errorPrefix: 'Could not read that threat' });

/**
 * What the standing watch covers: the watched repos and the host's expected ports.
 * @returns {Promise<{watch: {repos: Array<{id:string, path:string, addedAt:string, hasLockfile:boolean}>,
 *   host: {expectedPorts: number[]}}}>}
 */
// impure
export const getWatch = async () =>
  csoCall('GET', '/watch', { errorPrefix: 'Could not read the watch list' });

/**
 * Put a repo under the watch, by absolute path. The server refuses paths that
 * are not repos or carry no lockfile surface it can sweep.
 * @param {string} path absolute repo path
 * @returns {Promise<{repo: object, watch: object}>}
 */
// impure
export const addWatchedRepo = async (path) =>
  csoCall('POST', '/watch/repos', { body: { path }, errorPrefix: 'Could not watch that repo' });

/**
 * Take one repo off the watch by id. Its ledger entries stay.
 * @param {string} id the watched repo's id
 * @returns {Promise<{watch: object}>}
 */
// impure
export const removeWatchedRepo = async (id) =>
  csoCall('DELETE', `/watch/repos/${encodeURIComponent(id)}`, { errorPrefix: 'Could not unwatch that repo' });

/**
 * Declare the host's expected listening ports — anything else the sweep hears
 * is a finding.
 * @param {number[]} ports
 * @returns {Promise<{host: {expectedPorts: number[]}}>}
 */
// impure
export const setExpectedPorts = async (ports) =>
  csoCall('PUT', '/watch/host', { body: { expectedPorts: ports }, errorPrefix: 'Could not set the expected ports' });

/**
 * The last scan's record: when it ran, what the host reported (kernel, NVIDIA
 * driver, listeners), and the per-run summaries.
 * @returns {Promise<{scan: {lastRunAt:(string|null), host:object, runs:Array}}>}
 */
// impure
export const getScan = async () =>
  csoCall('GET', '/scan', { errorPrefix: 'Could not read the scan record' });

/**
 * Run a scan now, out of cycle. Takes 30s or more — awaited, per house idiom.
 * @returns {Promise<{summary: object}>}
 */
// impure
export const runScan = async () =>
  csoCall('POST', '/scan/run', { errorPrefix: 'Could not run the scan' });

/**
 * The whole posture in one read: the seat, the ledger counts, and the watch.
 * @returns {Promise<{cso: (object|null), counts: object,
 *   watch: {repos: Array<{id:string, path:string, hasLockfile:boolean}>, host: object}}>}
 */
// impure
export const getPosture = async () =>
  csoCall('GET', '/posture', { errorPrefix: 'Could not read the posture' });
