// notify-text.cjs — the pure half of the OS notification adapter.
//
// Split out of main.cjs so it can be proven without an Electron runtime. What
// remains in the shell (ipc-handlers.cjs) is a three-line call to
// `new Notification(...)`, which
// has no assertable seam and no logic worth testing; everything that DECIDES
// anything is here, and is tested with nothing faked.
//
// This is a main-process module. It is NOT for the preload — that boundary
// permits requiring only 'electron', and a throwing require there takes the
// whole window.neuma bridge down, wallet included.

/** How long an OS notification line may be. Matches the record contract's cap. */
const NOTIFY_TEXT_MAX = 140;

/**
 * Make a caller-supplied string safe for an OS notification line.
 *
 * The renderer is the least trusted input on this boundary, so nothing arriving
 * from it is passed through: control characters and newlines become spaces (an
 * embedded newline in a notification body is a formatting exploit), whitespace
 * collapses, and the result is capped.
 *
 * Total by construction — a non-string, an empty string, or a string of nothing
 * but control characters all fall back rather than throwing. A notification is
 * the least important thing happening at the moment it fires, and must never be
 * the reason the main process falls over.
 *
 * Pure.
 *
 * @param {*} raw
 * @param {string} fallback - used when there is nothing usable left
 * @returns {string}
 */
const cleanNotifyText = (raw, fallback) => {
  if (typeof raw !== 'string') return fallback;
  let out = '';
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    out += (code < 32 || code === 127) ? ' ' : ch;
  }
  out = out.replace(/\s+/g, ' ').trim();
  if (out === '') return fallback;
  return out.length <= NOTIFY_TEXT_MAX ? out : `${out.slice(0, NOTIFY_TEXT_MAX - 1)}…`;
};

/**
 * Is this a desk app id the renderer is allowed to ask for?
 *
 * A closed shape, not a path and not a URL. Main will hand this to the desk as
 * a window to open, so anything path-like or scheme-like is refused outright
 * rather than sanitised — there is no legitimate caller that needs one.
 *
 * Pure.
 */
const isSafeAppId = (raw) => typeof raw === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(raw);

/**
 * What a clicked OS notification hands the desk: the card's own id, so the
 * desk replays that card's click and lands where it does (its sitting, its
 * tab), and the app id it falls back to when the desk no longer holds the
 * card. The id is the record id's own closed shape (ID_PATTERN in
 * core/runtime/notification-record.js); anything else is dropped, never
 * forwarded. Null when there is no app to open.
 *
 * Pure.
 *
 * @param {unknown} payload - what the renderer sent with notifications:notify
 * @returns {?{appId: string, id?: string}}
 */
const activationOf = (payload) => {
  if (!isSafeAppId(payload?.appId)) return null;
  const id = typeof payload.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(payload.id) ? payload.id : null;
  return id ? { appId: payload.appId, id } : { appId: payload.appId };
};

/**
 * Should an OS notification fire, given what every desk window is doing?
 *
 * "Unfocused" has three shapes and only one of them is obvious:
 *   - another application is in front           (not focused)
 *   - the desk is minimised                     (not visible to the operator)
 *   - the desk was CLOSED to the tray           (hidden, but alive)
 *
 * The third is the common one — the window's X hides the desk rather than
 * quitting — so a check that only asked `isFocused()` would be right by
 * accident, and one that forgot `isVisible()` would go silent exactly when the
 * operator most needs telling.
 *
 * Pure — the caller passes what it observed.
 *
 * @param {Array<{visible: boolean, minimized: boolean, focused: boolean}>} desks
 * @returns {boolean} true when NO desk is in front of the operator
 */
const noDeskOnScreen = (desks) => {
  if (!Array.isArray(desks) || desks.length === 0) return true;
  return !desks.some((d) => d && d.visible === true && d.minimized !== true && d.focused === true);
};

module.exports = {
  NOTIFY_TEXT_MAX, cleanNotifyText, isSafeAppId, activationOf, noDeskOnScreen,
};
