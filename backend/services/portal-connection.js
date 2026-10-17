// Portal connection factory — the ONE place a portal connection object is
// shaped (extracted from portal-routes in C-01, verbatim fields).
//
// portal-routes builds real WebSocket connections through this; the channel
// bridge builds synthetic ones (ws replaced by a frame-collecting shim) for
// external-channel turns. streamConsciousness reads many connection fields
// beyond `ws` — one factory means no hand-rolled partial connections can
// drift from the real shape. impure (Date, rate-limit init).

import { initWsRateLimit } from './rate-limiter.js';

/**
 * @param {{ ws: object, walletAddress: string|null, notifySubstrateActivity?: Function }} parts
 *   ws — a real WebSocket, or any { send(str), readyState, OPEN } shim
 * @returns {object} a connection streamConsciousness can carry a turn on
 */
export const createPortalConnection = ({ ws, walletAddress = null, notifySubstrateActivity = () => {} }) => {
  const connection = {
    ws,
    walletAddress,
    companion: null,
    established: new Date(),
    _pongPending: false,
    _recentMessageIds: new Set(),
    _recentMessageHashes: new Set(),
    // The stream service pokes this when a turn starts/ends (it owns
    // activeTurn but not the connections map) — see B-01a broadcast.
    notifySubstrateActivity,
  };
  initWsRateLimit(connection);
  return connection;
};
