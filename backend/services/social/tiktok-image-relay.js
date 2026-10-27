// tiktok-image-relay.js — the one way a TikTok picture (the account's avatar,
// a video's cover) reaches the desk. The desk's content policy admits images
// from itself only (security-headers.js: img-src 'self' data: blob:), so the
// backend fetches the picture and hands the bytes over behind the session.
//
// It is narrow on purpose, so it can never become a general fetcher:
//   · https only, and only hosts under TikTok's own CDN domains;
//   · every redirect hop judged by the same rule (at most two);
//   · image types the desk can draw, never SVG (it can carry script);
//   · at most 4 MB, counted as the bytes arrive; 10 seconds at most;
//   · nothing of the person's travels with it — no cookies, no session, no
//     referrer: a bare GET asking for an image.
// TikTok's cover links expire after six hours (Video Object reference), so a
// refused picture is drawn as missing, never retried in a loop.
//
// NEUMA_TIKTOK_CDN_ROOT is the tests' door: one exact origin (a local
// stand-in) admitted beside the CDN hosts. Production never sets it.

const CDN_DOMAINS = Object.freeze(['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com']);
const IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_HOPS = 2;
const TIMEOUT_MS = 10 * 1000;

/**
 * Whether the relay may fetch this URL. Pure over its inputs.
 * @param {string} raw
 * @param {string} [testOrigin] - the tests' one admitted origin
 * @returns {boolean}
 */
export const tiktokImageUrlAllowed = (raw, testOrigin = process.env.NEUMA_TIKTOK_CDN_ROOT) => {
  let url;
  try { url = new URL(String(raw)); } catch { return false; }
  if (url.username || url.password) return false;
  if (testOrigin && url.origin === testOrigin) return true;
  if (url.protocol !== 'https:' || url.port) return false;
  const host = url.hostname.toLowerCase();
  return CDN_DOMAINS.some((d) => host.endsWith(`.${d}`));
};

/**
 * The image type an answer declares, when it is one the desk may draw. Pure.
 * @param {string|null} header
 * @returns {string|null}
 */
export const imageTypeOf = (header) => {
  const type = String(header || '').split(';')[0].trim().toLowerCase();
  return IMAGE_TYPES.includes(type) ? type : null;
};

// impure — read a body, refusing it the moment it passes the cap.
const readCapped = async (res) => {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null;
  const parts = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > MAX_IMAGE_BYTES) return null;
    parts.push(chunk);
  }
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
};

/**
 * Fetch one TikTok picture. impure — network. Never throws.
 * @param {string} src
 * @returns {Promise<{ok: true, type: string, bytes: Buffer}|{ok: false, status: number, detail: string}>}
 */
export const relayTikTokImage = async (src) => {
  let target = String(src || '');
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
      if (!tiktokImageUrlAllowed(target)) return { ok: false, status: 400, detail: 'not a TikTok picture' };
      const res = await fetch(target, {
        headers: { Accept: IMAGE_TYPES.join(', ') }, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', signal,
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel();
        target = new URL(res.headers.get('location'), target).toString();
        continue;
      }
      if (!res.ok) { await res.body?.cancel(); return { ok: false, status: 502, detail: `TikTok answered HTTP ${res.status} for the picture` }; }
      const type = imageTypeOf(res.headers.get('content-type'));
      if (!type) { await res.body?.cancel(); return { ok: false, status: 502, detail: 'TikTok answered something other than a picture' }; }
      const bytes = await readCapped(res);
      if (!bytes) return { ok: false, status: 502, detail: 'the picture is larger than 4 MB' };
      return { ok: true, type, bytes };
    }
    return { ok: false, status: 502, detail: 'the picture moved too many times' };
  } catch (err) {
    return { ok: false, status: 504, detail: `TikTok's picture did not arrive (${err.name === 'TimeoutError' ? 'timed out' : err.message})` };
  }
};
