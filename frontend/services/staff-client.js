// staff-client.js — the operator's client for the chief-of-staff (Optio)
// office, mirroring cso-client.js: reads the seat and the one-call board;
// the writes (designate, clear) are the operator's own calls. Every failure
// throws with the route's honest reason — a panel that could not act must
// never LOOK like it did.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

const BASE = '/api/v1/staff';

/**
 * One JSON round-trip against the staff routes: bearer headers, an optional
 * JSON body, and a thrown Error that carries the server's own refusal reason.
 * @param {string} method HTTP method
 * @param {string} path route path under /api/v1/staff
 * @param {{body?: *, errorPrefix?: string}} [options]
 * @returns {Promise<*>} the parsed response body ({} when it is not JSON)
 */
// impure — the single transport every export below rides.
const staffCall = async (method, path, { body, errorPrefix } = {}) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall(method, `${BASE}${path}`, { body, errorPrefix, errorSuffix: '.' });
};

/**
 * Who holds the chief-of-staff seat, or null when the office stands empty.
 * @returns {Promise<{cos: ({laneId: string, designatedAt: string}|null)}>}
 */
// impure
export const getCosSeat = async () =>
  staffCall('GET', '/seat', { errorPrefix: 'Could not read the CoS seat' });

/**
 * Seat a being as the house's chief of staff. One seat, one holder; the lane
 * must be one of the operator's own neuma (the server enforces it).
 * @param {string} laneId the being's lane id (neumaId)
 * @returns {Promise<{cos: {laneId: string, designatedAt: string}}>}
 */
// impure
export const seatCos = async (laneId) =>
  staffCall('PUT', '/seat', { body: { laneId }, errorPrefix: 'Could not seat the CoS' });

/**
 * Clear the CoS seat. The record stays; the office stands empty.
 * @returns {Promise<{cos: null}>}
 */
// impure
export const clearCosSeat = async () =>
  staffCall('DELETE', '/seat', { errorPrefix: 'Could not clear the CoS seat' });

/**
 * End the office's standing plan of record (Design note, 2026-10-10: the record retires, moved aside and
 * never destroyed, and the live connection drops the plan and its workspace confinement now.
 * Refused while a team run is working on it.
 * @returns {Promise<{ended: true, name: (string|null)}>}
 */
// impure
export const endStandingPlan = async () =>
  staffCall('DELETE', '/plan', { errorPrefix: 'Could not end the standing plan' });

/**
 * The office's board in one read: the seat, the house as it stands, the
 * dispatches waiting in the office inbox, the standing plan of record, and
 * the house's recent team runs. Unseated reads come back with null sections.
 * @returns {Promise<{cos: (object|null), roster: (object|null),
 *   posts: ({count: number, torn: number, recent: Array}|null),
 *   plan: (object|null), runs: Array}>}
 */
// impure
export const getCosBoard = async () =>
  staffCall('GET', '/board', { errorPrefix: 'Could not read the CoS board' });

/**
 * WHO IS WORKING — one lean row per seat with live work (the activity chip's
 * poll): status working/received/dispatched/open, the task's title, and when
 * the seat last moved it. Empty when the office is unseated or nothing moves.
 * @returns {Promise<{working: Array<{neumaId: string, name: string,
 *   seat: (string|null), status: string, task: string, since: (string|null)}>}>}
 */
// impure
export const getHouseActivity = async () =>
  staffCall('GET', '/activity', { errorPrefix: 'Could not read the house activity' });
