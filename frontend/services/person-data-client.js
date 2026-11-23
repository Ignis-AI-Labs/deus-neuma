// person-data-client.js — a person's data: read whole to hand them, erased when they ask (backend/routes/
// person-data-routes.js). impure — talks to the local backend with the session token.

import { authedCall } from './authed-call.js';

const peopleCall = authedCall('/api/v1/people');

/** Everything the house holds on one address. impure. */
export const getPersonRecord = (address) => peopleCall('GET', `/record?address=${encodeURIComponent(address)}`, { errorPrefix: 'Could not read what the house holds on them' });

/** Erase one person; confirm repeats their address. impure. */
export const erasePerson = (address, confirm) => peopleCall('POST', '/erase', { body: { address, confirm }, errorPrefix: 'Could not erase them' });
