// accounts-client.js — the operator's Logista-office client: the books board
// (each company's statement, entries and deadlines; every unbooked receipt),
// seating and unseating the house's Logista.
// impure — talks to the local backend with the session token; every failure
// throws with the route's honest reason.

import { authedCall } from './authed-call.js';

const accountsCall = authedCall('/api/v1/accounts');

/** The books of the operator's house. impure. */
export const getAccountsBoard = () => accountsCall('GET', '/board', { errorPrefix: 'Could not read the books' });

/** Seat a being as the house's Logista (never the Quaestor's being). impure. @param {string} laneId */
export const seatLogista = (laneId) => accountsCall('PUT', '/seat', { body: { laneId }, errorPrefix: 'Could not seat the Logista' });

/** Clear the Logista's seat. impure. */
export const clearLogista = () => accountsCall('DELETE', '/seat', { errorPrefix: 'Could not clear the Logista seat' });
