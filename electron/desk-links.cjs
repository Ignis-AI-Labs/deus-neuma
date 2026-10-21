// Desk links — where a desk's page may send the operator. Pure.
//
// Two doors leave a desk: a link that opens a new window (target=_blank, or
// window.open) is handed to the OS, and a main-frame navigation replaces the
// desk itself. Both are main-process decisions, because a url can come from
// anywhere a page renders — a search result, a remote provider, a dropped file.
//
// The OS door takes http(s) only. Any other scheme handed to shell.openExternal
// runs the OS handler registered for it (smb:, ms-msdt:, search-ms: …), which is
// a program launch, not a page. The desk door stays on the desk's own origin: a
// file dropped outside the composer or FILES, or a page told to go elsewhere,
// would otherwise put a foreign page where the desk was, still carrying the
// desk's preload bridge.

/**
 * The url a desk may hand to the OS browser, or null. Pure.
 * @param {unknown} raw
 * @returns {string|null} the normalized http(s) url
 */
const externalUrlFor = (raw) => {
  try {
    const url = new URL(String(raw));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

/**
 * May a desk's main frame navigate to `target`? Only within the desk's own
 * origin. Pure.
 * @param {unknown} target - the url the frame is about to load
 * @param {string} deskOrigin - the origin the desk was loaded from
 * @returns {boolean}
 */
const staysOnDesk = (target, deskOrigin) => {
  try {
    return new URL(String(target)).origin === new URL(deskOrigin).origin;
  } catch {
    return false;
  }
};

module.exports = { externalUrlFor, staysOnDesk };
