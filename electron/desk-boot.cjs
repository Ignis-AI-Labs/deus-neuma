// Desk boot payload — what an opener desk hands a newly spawned desk.
//
// Today that is exactly one thing: the session auth token, so the new desk
// wakes authenticated instead of showing the gateway (and instead of burning
// the auth rate budget on a redundant challenge). The payload lives in main's
// MEMORY only, keyed to the one window it was minted for, wiped on delivery,
// on window close, and on a claim deadline — it never touches argv,
// additionalArguments, disk, or logs (argv leaks into process lists and
// crash dumps; AGENTS.md Rule 8).
//
// Pure validation only — the relay itself (pending map in desk-windows.cjs,
// IPC in ipc-handlers.cjs) lives in the shell; this shapes untrusted renderer
// input into the one allowed form.

/** How long main holds an unclaimed boot before wiping it. Generous enough
 *  for a slow first paint, short enough that a stalled window never leaves
 *  a token parked in memory. */
const BOOT_CLAIM_TTL_MS = 30_000;

/** Auth tokens are short-lived JWT-ish strings; anything huge is not one. */
const MAX_TOKEN_CHARS = 4096;

/** Companion seed bounds — a display name and a derived id, nothing more. */
const MAX_NAME_CHARS = 100;
const MAX_NEUMA_ID_CHARS = 200;

/** Pure — true when every char is printable ASCII (33–126). */
const isPrintableAscii = (s) => {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 33 || c > 126) return false;
  }
  return true;
};

/** Pure — true when the string carries a control character (C0 or DEL). */
const hasControlChars = (s) => {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
};

/**
 * Pure — shape an untrusted companion seed into { name, neumaId? } or null.
 * The name is a human-given display name (unicode allowed, control chars
 * not); the neumaId is a derived identifier (printable ASCII only). A
 * malformed seed yields null — the new desk then resolves its companion
 * from the shared last-used, which is honest.
 * @param {unknown} raw
 * @returns {{ name: string, neumaId?: string } | null}
 */
const sanitizeCompanionSeed = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof (/** @type {{name?: unknown}} */ (raw).name) === 'string'
    ? /** @type {string} */ (/** @type {{name?: unknown}} */ (raw).name).trim()
    : '';
  if (!name || name.length > MAX_NAME_CHARS || hasControlChars(name)) return null;
  const rawId = /** @type {{neumaId?: unknown}} */ (raw).neumaId;
  const neumaId = typeof rawId === 'string' ? rawId.trim() : '';
  if (neumaId && (neumaId.length > MAX_NEUMA_ID_CHARS || !isPrintableAscii(neumaId))) return null;
  return neumaId ? { name, neumaId } : { name };
};

/**
 * Pure — shape an untrusted renderer-supplied boot payload into the one
 * allowed form, or null. Unknown fields are DROPPED (never forwarded), and
 * a malformed token yields null rather than a partial payload — the new
 * desk then simply opens at the gateway, which is honest. A companion seed
 * rides only alongside a valid token (a gateway desk re-derives its own).

 * @param {unknown} raw - Whatever the opener renderer sent over IPC
 * @returns {{ authToken: string, companion?: { name: string, neumaId?: string } } | null}
 */
const sanitizeBootPayload = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const token = /** @type {{authToken?: unknown}} */ (raw).authToken;
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TOKEN_CHARS) return null;
  // Printable ASCII only (33–126) — our backend mints ASCII tokens (JWT /
  // base64url alphabet), so anything outside that range is not one. Explicit
  // charCode scan rather than escape-sequence classes; base64url's '-' and
  // '_' pass, whitespace and control characters do not.
  if (!isPrintableAscii(trimmed)) return null;
  const companion = sanitizeCompanionSeed(/** @type {{companion?: unknown}} */ (raw).companion);
  return companion ? { authToken: trimmed, companion } : { authToken: trimmed };
};

module.exports = { BOOT_CLAIM_TTL_MS, MAX_TOKEN_CHARS, sanitizeBootPayload, sanitizeCompanionSeed };
