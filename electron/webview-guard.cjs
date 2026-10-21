// webview-guard.cjs — what an embedded guest is allowed to be.
//
// THE COMFY VIEWPORT embeds ComfyUI's own UI in a <webview> so the operator can
// work the canvas by hand while the AI-activity rail sits beside it. The
// RENDERER declares that tag, which means the renderer declares its security
// attributes — and a renderer's word about its own sandboxing is worth nothing.
// The main process is the only side that can enforce it, so this is the law
// `will-attach-webview` applies to every guest before it exists.
//
// Pure, and its own module, so the clamp can be proven directly rather than
// inferred from a window that happened to open.

const { COMFY_PARTITION } = require('./permission-guard.cjs');

/** Hosts an embedded guest may be pointed at: the operator's own machine only. */
const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Decide whether a guest may attach, and strip its privileges to the floor.
 *
 * MUTATES `webPreferences` — that object is Electron's live handle for the
 * guest about to be created, so clamping it is the whole point; the return
 * value only says whether the attach may proceed at all.
 *
 * @param {object} webPreferences the guest's proposed preferences (mutated)
 * @param {{src?: string, partition?: string}} params the guest's declared attributes (partition is overwritten)
 * @returns {{allow: boolean, reason: (string|null)}}
 */
const clampWebviewPreferences = (webPreferences, params) => {
  // No bridge into a foreign origin, ever (RULE 8). Deleting rather than
  // nulling matters: Electron reads the KEY, so `preload: null` still counts as
  // a declared preload path on some versions.
  if (webPreferences && typeof webPreferences === 'object') {
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    // The guest's session is the engine's own, whatever the tag declared: a
    // guest attached into the desk's session would share its storage and its
    // grant-all-by-default fallback for any partition no guard covers.
    webPreferences.partition = COMFY_PARTITION;
  }
  if (params && typeof params === 'object') params.partition = COMFY_PARTITION;

  let target;
  try {
    target = new URL(String(params?.src || ''));
  } catch {
    return { allow: false, reason: 'malformed webview src' };
  }
  // http only: the engine is a loopback sidecar, and file:// or a custom scheme
  // here would be a guest reading the operator's disk.
  if (target.protocol !== 'http:') return { allow: false, reason: 'webview src must be http' };
  if (!LOOPBACK_HOSTS.includes(target.hostname)) {
    return { allow: false, reason: 'webview src must be loopback' };
  }
  return { allow: true, reason: null };
};

module.exports = { clampWebviewPreferences, LOOPBACK_HOSTS };
