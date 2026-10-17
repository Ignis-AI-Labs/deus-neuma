// safe-url — which of a search result's urls may become a clickable href.
//
// A source url is authored by whoever owns the page the being found, so it
// arrives in the desk as untrusted data on the same footing as the page body.
// Rendering it as TEXT is already safe (React escapes children); the risk is
// the `href`, where `javascript:` executes in the desk's own origin the moment
// the witness clicks a link they had every reason to trust.
//
// So the guard is an ALLOWLIST of two schemes, not a blocklist of bad ones —
// a blocklist loses to `JaVaScript:`, to a tab spliced into the scheme, and to
// the next encoding nobody thought of, while `protocol === 'https:'` is decided
// by the URL parser itself and cannot be spelled around.
//
// Rejected urls are not repaired and not silently dropped by the caller — the
// chip shows the entry as plain unlinked text, so a witness still SEES that the
// being received a source and can judge it, rather than the desk quietly
// editing the research record.

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Pure — control characters are checked by code point rather than a regex
// literal, so no raw control byte or escape sequence has to survive a trip
// through a source file to make this work.
const hasControlChar = (text) => {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

/**
 * The url as a safe href, or null when it must never become one. Pure.
 * @param {*} raw - candidate url from a search result
 * @returns {string|null} the normalized absolute url, or null
 */
export const safeHttpUrl = (raw) => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // A control character can break an attribute out of its quoting in any
  // renderer less careful than this one; refuse rather than strip.
  if (!trimmed || hasControlChar(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
    // Credentials in a url are a phishing shape (https://trusted.com@evil.tld)
    // and no legitimate search result carries them.
    if (parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null; // not absolute, not parseable — not a link
  }
};

/**
 * The host, for the compact line the witness scans. Pure.
 * @param {string} url - a url already passed through safeHttpUrl
 * @returns {string} hostname, or '' when unparseable
 */
export const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
