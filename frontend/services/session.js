// session.js — end the witness's session so they can reconnect as a different
// wallet.
//
// Clears the wallet + auth session (via WalletService.disconnect) and reloads to
// a clean gateway, so no state from one wallet bleeds into the next. After the
// witness reconnects with another wallet, roster recovery (roster-recovery.js)
// loads THAT wallet's neuma from the backend.

import { getWalletService } from './WalletGate.js';
import { clearWindowCompanion } from '../utils/companion-data.js';
import { clearArrivalSeen } from '../utils/arrival-flag.js';

// impure — best-effort clear of the session keys, in case the provider
// disconnect throws before WalletService gets to them.
const clearSessionKeys = (wallet = null) => {
  // Provider teardown already removed walletAddress; use the captured
  // namespace so the departing wallet's binding cannot survive sign-out.
  clearWindowCompanion(wallet);
  try {
    // The arrival's session-entry flag is scoped to this wallet too — the next
    // session entry opens the veil again. The address is passed IN because by
    // the time we get here WalletService.disconnect() has already removed it
    // from storage (#412): reading it here found null, the scoped key was
    // never built, and the flag survived the session it was supposed to die
    // with. Falling back to a read keeps direct callers working.
    clearArrivalSeen(wallet ?? localStorage.getItem('walletAddress'));
    sessionStorage.removeItem('authToken');
    localStorage.removeItem('walletAddress');
    localStorage.removeItem('walletConnected');
  } catch { /* private mode */ }
};

/**
 * Tear down the session and return to the gateway. A full reload is deliberate:
 * it guarantees no cross-wallet state survives into the next connection (open
 * windows, cached companion, live portal). The local key wipe is unconditional —
 * the no-bleed guarantee can't depend on WalletService's clearing behaviour, or
 * a reload could re-land on a gateway that auto-reconnects the old wallet.
 * impure.
 * @returns {Promise<void>}
 */
export const disconnectSession = async () => {
  // Read the wallet BEFORE the provider teardown: WalletService.disconnect()
  // removes walletAddress itself, and the arrival flag's key is scoped by it.
  let wallet = null;
  try { wallet = localStorage.getItem('walletAddress'); } catch { /* private mode */ }
  try {
    await getWalletService().disconnect();
  } catch {
    // best-effort provider teardown; the unconditional clear below is the guarantee
  }
  clearSessionKeys(wallet);
  if (typeof window !== 'undefined' && window.location && window.location.reload) {
    window.location.reload();
  }
};
