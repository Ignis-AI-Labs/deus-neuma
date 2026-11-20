// waiting-pulse — one word from the backend to every open window of a house: […].
//
// Design note, 2026-11-16, fourteen replies approved in the post queue and still listed under WAITING ON
// YOU in the POSITIONS window three minutes later: […]
//
// The waiting account is READ from a dozen stores (waiting-sources.js) and each window re-read it
// on its own schedule: a poll that runs only while the tray's bell is on screen, a few portal
// frames about chat cards, and a window event said by the handful of presses that remembered to
// say it. A decision taken through any other door (the queue's APPROVE, a bulk approve, a card
// answered in another window) told nobody. So the signal is sent from the ONE place every
// decision passes through, never from each button:
//   - every request of the operator's that changes something and succeeds (the middleware), and
//   - every act of a member's that settles (intent-sweep.js), since that is how new decisions arrive.
// The frame carries no data. Each window that shows waiting things reads its own account again,
// so a window can never show what another already settled. Several changes in a burst (a bulk
// approve) are one pulse. impure — a timer and the portal.

import { createLogger } from '../logger.js';

const log = createLogger('waiting');
export const WAITING_FRAME = 'waiting:changed';
const SETTLE_MS = 150;

let send = null;
const pending = new Map();

/** impure — wire the transport. Called once, from the routes layer (portal-send.js). */
export const setWaitingSender = (fn) => {
  send = typeof fn === 'function' ? fn : null;
};

/** impure — tell this house's open windows to read what waits again. Never throws. */
export const pulseWaiting = (wallet) => {
  if (typeof wallet !== 'string' || !wallet || !send) return;
  const key = wallet.toLowerCase();
  if (pending.has(key)) return;
  const timer = setTimeout(() => {
    pending.delete(key);
    try {
      send(wallet, { type: WAITING_FRAME, at: new Date().toISOString() });
    } catch (error) {
      log.warn('the waiting pulse could not be sent', { error: error.message });
    }
  }, SETTLE_MS);
  timer.unref?.();
  pending.set(key, timer);
};

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Express middleware: after any request of the operator's that changed something, pulse their house. */
export const waitingPulse = (req, res, next) => {
  if (READS.has(req.method)) return next();
  res.on('finish', () => {
    // req.walletAddress is set by the route's own requireAuth; an unsigned or refused request pulses nobody.
    if (res.statusCode < 400 && req.walletAddress) pulseWaiting(req.walletAddress);
  });
  return next();
};
