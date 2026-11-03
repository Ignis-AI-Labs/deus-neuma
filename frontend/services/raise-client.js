// raise-client.js — the operator's hands in the raise room: read every
// standing company's raise, sign a mandate (entering the receiving account),
// pause, resume or close it, record counsel's review of a facts sheet.
// impure — talks to the local backend with the session token; every failure
// throws with the route's honest reason.

import { authedCall } from './authed-call.js';

const raiseCall = authedCall('/api/v1/raise');

/** Every standing company of the house, with its raise. impure. */
export const getRaises = () => raiseCall('GET', '', { errorPrefix: 'Could not read the raise room' });

/** Sign the mandate on screen. impure. @param {string} id @param {{mandateId: string, account: object, counselChoseRoute: boolean}} body */
export const signMandate = (id, body) => raiseCall('POST', `/${encodeURIComponent(id)}/sign`, { body, errorPrefix: 'Could not sign the mandate' });

/** Pause, resume or close the signed mandate. impure. */
export const moveMandate = (id, type, note) => raiseCall('POST', `/${encodeURIComponent(id)}/status`, { body: { type, note }, errorPrefix: 'Could not move the mandate' });

/** Sign an investor's close: papers signed, accreditation (506c), the receipt or reference the money landed under. impure. */
export const closeInvestor = (id, body) => raiseCall('POST', `/${encodeURIComponent(id)}/close-investor`, { body, errorPrefix: 'Could not close the investor' });

/** Record counsel's review of the facts sheet on screen. impure. */
export const reviewFacts = (id, body) => raiseCall('POST', `/${encodeURIComponent(id)}/review`, { body, errorPrefix: 'Could not record counsel\'s review' });
