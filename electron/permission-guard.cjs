// permission-guard.cjs — what a page inside the app may ask the machine for.
//
// Electron GRANTS every permission request by default: camera, microphone,
// screen capture, location, notifications, MIDI, HID, serial — to any page
// that asks. The desk is ours, but a page that reaches it through a bug, and
// the ComfyUI guest (a loopback engine running third-party custom nodes),
// are not ours to trust with the operator's camera or screen.
//
// So the floor is DENY, and each surface is granted exactly what it uses:
// the desk speaks to the operator through the microphone (push-to-talk,
// dictation, live voice), writes to the clipboard, and goes fullscreen; the
// ComfyUI guest copies and goes fullscreen. Nothing else, from no origin but
// the desk's own (security-seat audit 2026-10-19, coverage G11).
//
// Pure, and its own module, so the verdicts are proven directly.

/** The desk's grants, from its own origin only. */
const DESK_GRANTS = Object.freeze(new Set(['media', 'clipboard-sanitized-write', 'fullscreen']));

/** The ComfyUI guest's grants: its canvas copies nodes and goes fullscreen. */
const GUEST_GRANTS = Object.freeze(new Set(['clipboard-sanitized-write', 'fullscreen']));

/** The guest's session partition (ComfyUIWorkbenchApp.jsx). */
const COMFY_PARTITION = 'persist:comfyui-workbench';

// pure — the origin of a URL, or null when it has none.
const originOf = (url) => {
  try {
    const { origin } = new URL(String(url));
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
};

// pure — a media request asks for the microphone alone. Camera and screen
// are never the desk's: an absent list means the caller could not say, and
// that is a no.
const audioOnly = (mediaTypes) => Array.isArray(mediaTypes)
  && mediaTypes.length > 0
  && mediaTypes.every((type) => type === 'audio');

/**
 * May the desk have this permission? Pure.
 * @param {{permission: string, requestingUrl: string, deskOrigin: string, mediaTypes?: string[]}} request
 * @returns {boolean}
 */
const deskPermissionVerdict = ({ permission, requestingUrl, deskOrigin, mediaTypes }) => {
  if (!DESK_GRANTS.has(permission)) return false;
  const origin = originOf(requestingUrl);
  if (!origin || origin !== originOf(deskOrigin)) return false;
  return permission === 'media' ? audioOnly(mediaTypes) : true;
};

/**
 * The synchronous CHECK (Electron asks it for clipboard writes and for device
 * labels). A check grants nothing by itself — the request above decides any
 * capture — so the desk's own origin may see its microphones' names (the
 * live voice picks the echo-cancelled input by label), never a camera's. Pure.
 * @param {{permission: string, requestingUrl: string, deskOrigin: string, mediaTypes?: string[]}} request
 * @returns {boolean}
 */
const deskPermissionCheck = ({ permission, requestingUrl, deskOrigin, mediaTypes }) => {
  if (!DESK_GRANTS.has(permission)) return false;
  const origin = originOf(requestingUrl);
  if (!origin || origin !== originOf(deskOrigin)) return false;
  return permission === 'media' ? !(mediaTypes || []).includes('video') : true;
};

/**
 * May the ComfyUI guest have this permission? Pure.
 * @param {{permission: string}} request
 * @returns {boolean}
 */
const guestPermissionVerdict = ({ permission }) => GUEST_GRANTS.has(permission);

/**
 * Install both handlers on a session: the async request and the synchronous
 * check. impure.
 * @param {import('electron').Session} session
 * @param {{request: (r: object) => boolean, check: (r: object) => boolean}} verdicts
 * @param {() => string} [getDeskOrigin]
 */
const guardSession = (session, { request, check }, getDeskOrigin = () => '') => {
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(request({
      permission,
      requestingUrl: details?.requestingUrl || webContents?.getURL?.() || '',
      deskOrigin: getDeskOrigin(),
      mediaTypes: details?.mediaTypes,
    }));
  });
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => check({
    permission,
    requestingUrl: details?.requestingUrl || requestingOrigin || '',
    deskOrigin: getDeskOrigin(),
    mediaTypes: details?.mediaType ? [details.mediaType] : undefined,
  }));
};

/** Install the floor on the desk's session and the ComfyUI guest's. impure. */
const guardAppSessions = (electronSession, getDeskOrigin) => {
  guardSession(electronSession.defaultSession, { request: deskPermissionVerdict, check: deskPermissionCheck }, getDeskOrigin);
  guardSession(electronSession.fromPartition(COMFY_PARTITION), { request: guestPermissionVerdict, check: guestPermissionVerdict });
};

module.exports = {
  deskPermissionVerdict, deskPermissionCheck, guestPermissionVerdict, guardSession, guardAppSessions,
  COMFY_PARTITION, DESK_GRANTS, GUEST_GRANTS,
};
