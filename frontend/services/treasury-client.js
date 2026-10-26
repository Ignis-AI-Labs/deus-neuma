// treasury-client.js — the operator's Quaestor-office client (the TREASURY
// window and the SPEND cards).
//
// impure — talks to the local backend with the session token. Reads the
// seat, the whole treasury and the pending spends; the writes (seat, clear,
// mark a flag seen) are the operator's own calls. A spend is never decided
// here: APPROVE and DENY ride wallet-client.js (the operator's own signature
// plus the being's key password, or a denial with a note). Every failure
// throws with the route's honest reason.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

const BASE = '/api/v1/treasury';

// impure — the single transport every export below rides.
const treasuryCall = async (method, path, { body, errorPrefix } = {}) => {
  if (!authHeaders()) throw new Error('Not authenticated.');
  return apiCall(method, `${BASE}${path}`, { body, errorPrefix, errorSuffix: '.' });
};

/** The whole treasury of the operator's house. impure. */
export const getTreasuryBoard = () => treasuryCall('GET', '/board', { errorPrefix: 'Could not read the treasury' });

/** Every pending spend as a card. impure. @returns {Promise<{spends: object[], seated: boolean}>} */
export const getSpendCards = () => treasuryCall('GET', '/spends', { errorPrefix: 'Could not read the pending spends' });

/** Seat a being as the house's Quaestor. impure. @param {string} laneId */
export const seatCfo = (laneId) => treasuryCall('PUT', '/seat', { body: { laneId }, errorPrefix: 'Could not seat the Quaestor' });

/** Clear the Quaestor's seat. impure. */
export const clearCfo = () => treasuryCall('DELETE', '/seat', { errorPrefix: 'Could not clear the Quaestor seat' });

/** The operator has read a Quaestor's flag. impure. @param {string} id */
export const markFlagSeen = (id) => treasuryCall('POST', `/flags/${encodeURIComponent(id)}/seen`, { body: {}, errorPrefix: 'Could not mark the flag read' });
