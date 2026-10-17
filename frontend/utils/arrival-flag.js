// arrival-flag.js — the once-per-session-entry gate for the Arrival veil.
//
// sessionStorage, keyed by wallet: the veil plays on true session entry and
// stays gone across hot reloads and intra-desk remounts. The flag dies with
// the wallet session (cleared on disconnect) so the next entry opens the
// veil again.

const keyFor = (wallet) => `arrivalSeen:${String(wallet || '').toLowerCase()}`;

/** @returns {boolean} whether this wallet's arrival already played in this window session */
export const isArrivalSeen = (wallet) => {
  try {
    return sessionStorage.getItem(keyFor(wallet)) === '1';
  } catch {
    return false; // private mode — the veil may replay, never blocks
  }
};

/** Mark this wallet's arrival as played (completion or skip). impure. */
export const markArrivalSeen = (wallet) => {
  try {
    sessionStorage.setItem(keyFor(wallet), '1');
  } catch { /* private mode — the flag simply never sticks */ }
};

/** Clear the flag (wallet disconnect — the next entry arrives again). impure. */
export const clearArrivalSeen = (wallet) => {
  try {
    sessionStorage.removeItem(keyFor(wallet));
  } catch { /* nothing to clear */ }
};
