// os-notice.js — the desk's leg out to the operating system's notifications,
// and the operator's one switch for it (DESKTOP ALERTS, default ON).
//
// Two roads, one shape: inside the desktop app the preload bridge hands the
// notice to main (electron/ipc-handlers.cjs re-cleans every line, fires once
// per id across desks, and on a click raises the desk and sends the
// activation back); in a plain browser the Notification API — only when the
// operator ALREADY granted it. Nothing here ever asks the browser for
// permission: an unasked prompt is an interruption the operator did not choose.
//
// impure — localStorage, the bridge, the browser's Notification.

const PREF_KEY = 'neuma-os-notify';
/** Announced whenever the switch moves, so every surface showing it agrees. */
export const OS_NOTICE_EVENT = 'neuma:os-notify-changed';

/** @returns {boolean} the operator's switch — ON unless they turned it off */
export const isOsNoticeOn = () => {
  try { return localStorage.getItem(PREF_KEY) !== 'off'; } catch { return true; }
};

// impure — persists the switch and announces it
export const setOsNoticeOn = (on) => {
  localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  window.dispatchEvent(new CustomEvent(OS_NOTICE_EVENT, { detail: { on } }));
};

const bridge = () => (typeof window !== 'undefined' && window.neuma?.notifications?.notify ? window.neuma.notifications : null);
const browserGranted = () => typeof Notification === 'function' && Notification.permission === 'granted';

/** @returns {boolean} can this desk reach the OS at all (the bridge, or a permission already granted)? */
export const osNoticeAvailable = () => Boolean(bridge()) || browserGranted();

/** @returns {boolean} is the desk in front of the operator right now? */
export const deskOnScreen = () => document.visibilityState === 'visible' && document.hasFocus();

/**
 * impure — raise one OS notice. In the desktop app main handles the click (the
 * activation comes back through notifications.onActivate); in a browser the
 * click focuses this tab and runs `onClick`.
 * @param {{id: string, title: string, body: string, appId: ?string}} notice
 * @param {() => void} [onClick]
 */
export const raiseOsNotice = (notice, onClick) => {
  const leg = bridge();
  if (leg) { leg.notify(notice); return; }
  if (!browserGranted()) return;
  try {
    const shown = new Notification(notice.title, { body: notice.body, tag: notice.id });
    shown.onclick = () => { window.focus(); shown.close(); onClick?.(); };
  } catch (error) {
    // A notice is the least important thing happening; it never breaks the desk.
    console.warn('[neuma] OS notice failed:', error.message);
  }
};
