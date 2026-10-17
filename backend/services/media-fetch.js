// Guarded media fetch — how a being brings one image home (Design note, 2026-07-28:
// […]).
//
// The SAME egress doctrine as web-fetch, byte for byte where it matters:
// every hop passes the strict web guard (outward only, never the rig
// itself), the connection is DNS-pinned to the guard's vetted addresses,
// redirects are followed by hand so each target is re-guarded, and the body
// is read counted — a hostile server cannot fill the heap. What changes is
// the payload and the ceiling: bytes, not text, capped at X's still-image
// maximum, because the library these land in exists to feed posts.
//
// Two honest refusals beyond the guard's own: a response that is not
// image/* (a being aimed at a page, not a file), and bytes whose magic
// header is not a real image (the library sniffs again at ITS door —
// defense in depth, not redundancy: the fetch answers "what came back",
// the library answers "what may stay").

import http from 'http';
import https from 'https';
import { assertSafeWebTarget, nextRedirectUrl } from './web-guard.js';
import { pinnedLookup, readBounded } from './web-fetch.js';
import { sniffImageType, MEDIA_MAX_BYTES } from './social/x-media.js';

const MAX_REDIRECTS = 5;
// GIFs on slow CDNs take longer than a text page; the ceiling is still a
// ceiling — a stalled fetch fails honestly rather than holding a turn.
const TIMEOUT_MS = 20_000;
const UA = 'NeumaWeb/1.0 (local media fetch)';

/**
 * One guarded, DNS-pinned GET for BYTES. Resolves with `{ res }` on response
 * headers or `{ error }` — never rejects. impure.
 */
const requestOnce = (url, addrs) => new Promise((resolve) => {
  const mod = url.startsWith('https:') ? https : http;
  const req = mod.request(url, {
    method: 'GET',
    lookup: pinnedLookup(addrs),
    timeout: TIMEOUT_MS,
    headers: {
      'User-Agent': UA,
      'Accept': 'image/avif,image/webp,image/png,image/gif,image/jpeg,*/*;q=0.5',
    },
  }, (res) => resolve({ res }));
  req.on('timeout', () => req.destroy(new Error(`no answer within ${TIMEOUT_MS / 1000}s`)));
  req.on('error', (err) => resolve({ error: err.message }));
  req.end();
});

/**
 * Fetch one image as bounded bytes. impure — real network.
 * @param {string} target
 * @returns {Promise<{ok: true, url: string, bytes: Buffer, contentType: string}
 *   | {ok: false, error: string, status?: number}>}
 */
export const fetchMediaBytes = async (target) => {
  let url = String(target || '').trim();
  if (!url) return { ok: false, error: 'no url was given' };
  let hops = 0;
  for (;;) {
    const guard = await assertSafeWebTarget(url);
    if (!guard.ok) return { ok: false, error: `target refused (${guard.reason})` };
    const { res, error } = await requestOnce(url, guard.addrs);
    if (error) {
      const why = /no answer within/.test(error)
        ? 'the server did not answer in time'
        : `the network is unreachable (${error})`;
      return { ok: false, error: why };
    }
    if (res.statusCode >= 300 && res.statusCode < 400) {
      const next = nextRedirectUrl(url, res.headers.location);
      res.destroy(); // the redirect carries no body we read — release the socket
      if (!next) return { ok: false, error: `redirect (${res.statusCode}) without a usable Location` };
      hops += 1;
      if (hops > MAX_REDIRECTS) return { ok: false, error: `too many redirects (>${MAX_REDIRECTS})` };
      url = next;
      continue;
    }
    if (res.statusCode !== 200) {
      res.destroy();
      return { ok: false, status: res.statusCode, error: `the server answered ${res.statusCode}` };
    }
    const servedType = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!servedType.startsWith('image/')) {
      res.destroy();
      return { ok: false, error: `not an image (${servedType || 'unknown content type'}) — aim at the image file itself, not the page it sits on` };
    }
    const { buf, truncated } = await readBounded(res, MEDIA_MAX_BYTES);
    if (truncated) {
      return { ok: false, error: `the image is larger than ${MEDIA_MAX_BYTES / 1024 / 1024}MB — it will not fit a post` };
    }
    const contentType = sniffImageType(buf);
    if (!contentType) {
      return { ok: false, error: 'those bytes are not a JPEG, PNG, GIF or WEBP — the library keeps real images only' };
    }
    return { ok: true, url, bytes: buf, contentType };
  }
};
