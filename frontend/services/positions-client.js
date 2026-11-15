// positions-client.js — the operator's POSITIONS window client: every position
// of the house in one read, and what one position's holder is told each turn.
// Seating goes through each office's own client (position-seats.js), where
// that seat's rules already stand.
// impure — talks to the local backend with the session token.

import { authedCall } from './authed-call.js';

const positionsCall = authedCall('/api/v1/positions');

/** Every position of the operator's house. impure. */
export const getPositions = () => positionsCall('GET', '/', { errorPrefix: 'Could not read the house positions' });

/** What the holder of one position reads at the top of its turn (null: nobody holds it). impure. @param {string} office */
export const getPositionEyes = (office) => positionsCall('GET', `/${encodeURIComponent(office)}/eyes`, { errorPrefix: 'Could not read what this position is told' });
