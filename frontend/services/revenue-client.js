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

/** The lead engine of the operator's house: segments, the prospect pool, the do-not-contact list, what is due. impure. */
export const getLeadEngine = () => revenueCall('GET', '/lead-engine', { errorPrefix: 'Could not read the lead engine' });

/** Approve, pause or retire a segment's pitch. impure. @param {string} id @param {'approved'|'paused'|'retired'} state */
export const setSegmentState = (id, state) => revenueCall('POST', `/lead-engine/segments/${encodeURIComponent(id)}/state`, { body: { state }, errorPrefix: 'Could not move the segment' });

/** Put an email address or a company domain on the do-not-contact list. impure. */
export const suppressContact = (target, reason) => revenueCall('POST', '/lead-engine/suppress', { body: { target, reason }, errorPrefix: 'Could not add to the do-not-contact list' });

/** Approve an approved audience's company list as it stands; its leads' emails then go within the daily limits. impure. @param {string} id */
export const approveSegmentList = (id) => revenueCall('POST', `/lead-engine/segments/${encodeURIComponent(id)}/list`, { errorPrefix: 'Could not approve the list' });

/** Approve or return the Mercator's latest sales facts sheet. impure. @param {string} sheetId @param {'approved'|'returned'} verdict @param {string} [note] */
export const reviewSalesFacts = (sheetId, verdict, note) => revenueCall('POST', `/lead-engine/facts/${encodeURIComponent(sheetId)}`, { body: { verdict, note }, errorPrefix: 'Could not record the review' });
