// platform-feed-read.js — the ONE door to the Umbrae platform's public data,
// and the only thing in this family that touches the network.
//
// Design note, 2026-08-30: […]
//
// That line is held BY CONSTRUCTION, not by convention:
//   · The only verb here is GET. There is no body, no credentials, no signer.
//     Nothing in this module could act on the platform if it wanted to.
//   · Host AND path are both pinned. A being can TRIGGER this read by naming a
//     feed, so leaving either to an env var or to caller-supplied input would
//     hand the being a general-purpose fetch wearing a stats tool's name.
//   · Every source is an unauthenticated public route. The session-gated umbrae
//     routes (`/api/token/pair-markets`, `/api/base/prices`) are absent from
//     the registry on purpose — reaching one would mean carrying a credential,
//     and a data feed carries no credential.
//
// Two callers share this wall: the being-facing feed (platform-feed-tools.js)
// and the marketing card's live figure (branding/platform-stats.js). They had
// separate copies of the host pin for one day; two walls that must agree are a
// drift waiting to happen.

const ALLOWED_HOSTS = Object.freeze(['umbrae.io', 'www.umbrae.io', 'localhost', '127.0.0.1']);

/** Is this a URL this client is permitted to read? (pure) */
export const permittedFeedUrl = (raw) => {
  let url;
  try { url = new URL(String(raw)); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  // Plain http only for a loopback test server; the real feeds are https.
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return false;
  return ALLOWED_HOSTS.includes(url.hostname);
};

/** The origin, read PER CALL — the same env-door doctrine the social lane keeps
 *  (`x-reader`'s `apiRoot()`): a test points the REAL client at a real loopback
 *  server, and production never sets the override. Read at module load instead,
 *  the value freezes before any test can move it. */
const feedOrigin = () => process.env.NEUMA_PLATFORM_API_ORIGIN || 'https://umbrae.io';

/** One pinned path against the current origin. Pure. */
const feedUrl = (path) => `${feedOrigin().replace(/\/+$/, '')}${path}`;

/**
 * GET one permitted URL and parse its JSON. Never throws — a being (and a
 * marketing lane) must get a reason it can say out loud, not a stack trace.
 *
 * The permit check runs here as well as in every caller. That is deliberate
 * defence in depth: callers word their own refusal because each has its own
 * noun for what it reads, but none of them is the wall.
 *
 * ⚠️ Redirects are followed: `umbrae.io` 307s to `www.umbrae.io`, and a
 * body-only read of the 307 arrives empty. Every hop lands inside ALLOWED_HOSTS
 * because the redirect is same-site by construction.
 *
 * impure — network + clock.
 * @returns {Promise<{ok: true, payload: object, readAt: string} | {ok: false, error: string}>}
 */
export const getGuardedJson = async (url, { signal, timeoutMs = 15000 } = {}) => {
  if (!permittedFeedUrl(url)) {
    return { ok: false, error: `refusing to read ${url} — this client reads the Umbrae public feeds and nothing else` };
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const onOuter = () => abort.abort();
  signal?.addEventListener('abort', onOuter);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: abort.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, error: `the platform feed answered HTTP ${res.status}` };
    const payload = await res.json();
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'the platform feed returned no object' };
    if (payload.error) return { ok: false, error: `the platform feed reported: ${payload.error}` };
    // Two of the three feeds publish no moment of their own. A figure without
    // its moment is a claim, not a fact, so the read stamps when IT happened
    // and the shapers prefer the feed's own `asOf` wherever one exists.
    return { ok: true, payload, readAt: new Date().toISOString() };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, error: 'the platform read was cut short' };
    return { ok: false, error: `the platform feed is unreachable: ${err.message}` };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuter);
  }
};

/**
 * Read one PINNED path from platform-feed-sources.js. Never caller-supplied:
 * this function cannot tell an attacker-shaped path from a real one, so the
 * registry closes that set upstream. impure — network.
 */
export const readPlatformFeed = (path, opts = {}) => getGuardedJson(feedUrl(path), opts);
