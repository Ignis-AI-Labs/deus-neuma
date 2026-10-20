// card-landing.js — a one-shot latch + event per app letting a tray card open
// TASKS, TEAMS, WORKFLOW or the GALLERY ON ITS EXACT ITEM: the task, the run,
// the image (notification-target.js cardLanding names it).
//
// The window manager mounts a window ASYNCHRONOUSLY after the OPEN dispatch,
// so a bare CustomEvent fired alongside OPEN would arrive before the window's
// listener exists. Each landing is therefore LATCHED under its app id: the
// window reads (and clears) its own on mount, and also subscribes for later
// landings fired while it is already open. house-clock-focus.js's idiom, one
// slot per app, so a TEAMS landing is never taken by the GALLERY.

const EVENT = 'neuma:card-landing';
const pending = new Map();

/**
 * Latch an app's landing and announce it (for an already-open window).
 * @param {string} appId
 * @param {object} item - what the app selects (cardLanding's item)
 */
// impure — module latch + DOM event
export const requestCardLanding = (appId, item) => {
  pending.set(appId, item);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { appId, item } }));
};

/**
 * Read and clear an app's latched landing (null if none). Consumed once on mount.
 * @param {string} appId
 * @returns {object|null}
 */
// impure — reads + clears the latch
export const takeCardLanding = (appId) => {
  const item = pending.get(appId) ?? null;
  pending.delete(appId);
  return item;
};

/**
 * Subscribe to an app's landings fired while its window is mounted.
 * @param {string} appId
 * @param {(item: object) => void} handler
 * @returns {() => void} unsubscribe
 */
// impure — DOM listener
export const onCardLanding = (appId, handler) => {
  const listener = (e) => {
    if (e.detail?.appId !== appId) return;
    pending.delete(appId); // a mounted window took it
    handler(e.detail.item);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
};
