// settings-focus.js — a one-shot latch + event letting a slash command open
// Settings AND jump to a specific section.
//
// The window manager mounts the Settings window ASYNCHRONOUSLY after the OPEN
// dispatch, so a bare CustomEvent fired alongside OPEN would arrive before the
// section's listener exists. The intent is therefore LATCHED: the section reads
// (and clears) it on mount, and also subscribes for later requests fired while
// Settings is already open. Mirrors the `neuma:summon` event idiom — no coupling
// to the window reducer.

const EVENT = 'neuma:settings-focus';
let pending = null;

/**
 * Latch a focus target and announce it (for an already-open Settings window).
 * @param {string} target section id, e.g. 'providers' | 'route'
 */
// impure — module latch + DOM event
export const requestSettingsFocus = (target) => {
  pending = target;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { target } }));
};

/**
 * Read and clear the latched target (null if none). Consumed once on mount.
 * @returns {string|null}
 */
// impure — reads + clears the latch
export const takeSettingsFocus = () => {
  const t = pending;
  pending = null;
  return t;
};

/**
 * Subscribe to focus requests fired while the section is mounted.
 * @param {(target: string) => void} handler
 * @returns {() => void} unsubscribe
 */
// impure — DOM listener
export const onSettingsFocus = (handler) => {
  const listener = (e) => handler(e.detail?.target);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
};
