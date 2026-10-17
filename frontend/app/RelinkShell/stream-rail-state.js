// stream-rail-state — ONE side rail open at a time.
//
// Design note, 2026-08-15: […]
//
// The rails share a single value naming the open rail; opening one folds the
// other by construction — exclusivity is the mechanism, so a future rail
// joins by id instead of adding another independent fold. Live sync rides a
// window event with the fresh value (the task-order sync's exact pattern);
// persistence rides window-storage under one key.

import { loadOpenRail, saveOpenRail, openRailOf } from '../windowing/window-storage.js';

export const OPEN_RAIL_EVENT = 'neuma:stream-rail';

/** impure — the persisted open rail ('tasks' | 'chats' | null). */
export const getOpenRail = () => loadOpenRail();

/** impure — open one rail (folding any other) or null to fold them all. */
export const setOpenRail = (which) => {
  const next = openRailOf(which);
  saveOpenRail(next);
  window.dispatchEvent(new CustomEvent(OPEN_RAIL_EVENT, { detail: next }));
};
