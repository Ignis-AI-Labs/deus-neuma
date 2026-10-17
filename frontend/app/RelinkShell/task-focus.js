// task-focus.js — a one-shot latch + event letting the stream's rail open the
// TASKS window ON A PARTICULAR BEING'S TAB.
//
// The window manager mounts TASKS ASYNCHRONOUSLY after the OPEN dispatch, so a
// bare CustomEvent fired alongside OPEN would arrive before the window's
// listener exists. The intent is therefore LATCHED: the window reads (and
// clears) it on mount, and also subscribes for later requests fired while TASKS
// is already open. The exact idiom settings-focus.js uses for the same reason —
// no coupling to the window reducer either way.

const EVENT = 'neuma:task-focus';
let pending = null;

/**
 * Latch a scope and announce it (for an already-open TASKS window).
 * @param {string} scope 'me', a neumaId, or a witness lane id
 */
// impure — module latch + DOM event
export const requestTaskFocus = (scope) => {
  pending = scope;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { scope } }));
};

/**
 * Read and clear the latched scope (null if none). Consumed once on mount.
 * @returns {string|null}
 */
// impure — reads + clears the latch
export const takeTaskFocus = () => {
  const scope = pending;
  pending = null;
  return scope;
};

/**
 * Subscribe to scope requests fired while TASKS is mounted.
 * @param {(scope: string) => void} handler
 * @returns {() => void} unsubscribe
 */
// impure — DOM listener
export const onTaskFocus = (handler) => {
  const listener = (e) => handler(e.detail?.scope);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
};
