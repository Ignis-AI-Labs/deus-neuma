// revenue-client.js — the operator's Mercator-office client: the sales board
// (seat, pipeline, deals), seating and unseating the house's Mercator.
// impure — talks to the local backend with the session token; every failure
// throws with the route's honest reason.

import { authedCall } from './authed-call.js';

const revenueCall = authedCall('/api/v1/revenue');

/** The sales board of the operator's house. impure. */
export const getRevenueBoard = () => revenueCall('GET', '/board', { errorPrefix: 'Could not read the sales board' });

/** Seat a being as the house's Mercator. impure. @param {string} laneId */
export const seatMercator = (laneId) => revenueCall('PUT', '/seat', { body: { laneId }, errorPrefix: 'Could not seat the Mercator' });

/** Clear the Mercator's seat. impure. */
export const clearMercator = () => revenueCall('DELETE', '/seat', { errorPrefix: 'Could not clear the Mercator seat' });

/** Choose where deliveries go: a folder on this machine you serve, and its https address. impure. */
export const setDeliveryDestination = (folder, linkBase) => revenueCall('PUT', '/delivery-destination', { body: { folder, linkBase }, errorPrefix: 'Could not set where deliveries go' });
