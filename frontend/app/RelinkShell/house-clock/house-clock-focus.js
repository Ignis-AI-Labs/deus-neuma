// house-clock-focus.js — a one-shot latch + event letting a tray card open the
// HOUSE CLOCK ON A PARTICULAR TAB (2026-10-18 audit: a card about an ask opened
// on the CHARTER tab, away from the ask it named).
//
// The window manager mounts the window ASYNCHRONOUSLY after the OPEN dispatch,
// so a bare CustomEvent fired alongside OPEN would arrive before the window's
// listener exists. The tab is therefore LATCHED: the window reads (and clears)
// it on mount, and also subscribes for later requests fired while it is
// already open. The idiom settings-focus.js and task-focus.js use for the same
// reason — no coupling to the window reducer.

const EVENT = 'neuma:house-clock-tab';
let pending = null;

/**
 * Latch a tab and announce it (for an already-open HOUSE CLOCK).
 * @param {string} tab - 'charter' | 'now' | 'ledger' | 'asks' | 'money'
 */
// impure — module latch + DOM event
export const requestHouseClockTab = (tab) => {
  pending = tab;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { tab } }));
};

/**
 * Read and clear the latched tab (null if none). Consumed once on mount.
 * @returns {string|null}
 */
// impure — reads + clears the latch
export const takeHouseClockTab = () => {
  const tab = pending;
  pending = null;
  return tab;
};

/**
 * Subscribe to tab requests fired while the window is mounted.
 * @param {(tab: string) => void} handler
 * @returns {() => void} unsubscribe
 */
// impure — DOM listener
export const onHouseClockTab = (handler) => {
  const listener = (e) => {
    pending = null; // a mounted window took it
    handler(e.detail?.tab);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
};
