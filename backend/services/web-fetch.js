// Guarded web fetch — how a being reads one page of the internet.
//
// Every hop passes the strict web guard (outward only, never the rig itself),
// and the connection's DNS answer IS the guard's answer: resolution happens
// once, at guard time, and the request is pinned to those vetted addresses
// via a custom `lookup` — a name that answers the guard with a public IP and
// the socket with 127.0.0.1 gets nothing (echo round-1: two independent
// resolutions are not required to agree). Redirects are followed by hand so
// each target is re-guarded, and the body is read counted — a hostile or
// sloppy server cannot fill the heap. Only textual content is read;
// binaries are refused honestly.

import http from 'http';
import https from 'https';
import { assertSafeWebTarget, nextRedirectUrl } from './web-guard.js';
import { isPrivateHost } from './endpoint-guard.js';
import { htmlToText, extractTitle } from './html-to-text.js';
import { browserRunConfig, fetchRenderedHtml, isBrowserRunConfigured } from './browser-run.js';

// Consent walls, geo gates and link shorteners routinely chain more than three
// hops; a research fetch that dies on hop four reads as a dead source.
const MAX_REDIRECTS = 5;
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;
/** Ceiling on a page's readable text, HTML or not. Overflow is MARKED, never
 *  silent. Was 20k — a long article lost its second half for good; the turn
 *  now keeps an over-cap result retrievable (portal-tool-loop.js), so the page
 *  rides whole up to the download's own bound and the being reads the parts it
 *  needs (Design note, 2026-10-06: […]). */
export const WEB_TEXT_MAX = 200_000;
// A wall is LOTS OF MARKUP AND NO WORDS. Text length alone is the wrong signal
// and was caught being wrong by the live suite: example.com is a real page that
// extracts to 127 characters, and a bare text floor called it blocked. A
// challenge page or a JS shell is the opposite shape — tens of KB of markup
// carrying almost no prose — so both conditions must hold.
/** Below this much extracted text, a SUBSTANTIAL html body has no content. */
const WALL_TEXT_MIN = 200;
/** …and below this much markup it is simply a small page, not a wall. */
const WALL_MARKUP_MIN = 2000;

// WHO WE SAY WE ARE. The honest UA is tried FIRST, every time — the platform
// introduces itself as what it is, and any site willing to serve a research
// tool gets to know it is one. Only when a server actually refuses (403) or
// throttles (429) do we retry once as an ordinary browser, because a large part
// of the useful web now answers a non-browser UA with a flat refusal
// (g2.com, measured 2026-07-27) and […] is not a research result. Founder's call, 2026-07-27.
const DEFAULT_UA = 'NeumaWeb/1.0 (local research tool)';
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/140.0.0.0 Safari/537.36';
/** Statuses worth one second attempt. */
const RETRYABLE = new Set([403, 429]);
/** How much of a refusal's own body to show — the reason is often IN it. */
const REFUSAL_EXCERPT = 500;

/**
 * What a fetched body actually IS — title, readable text, whether it was cut,
 * and whether it is a wall rather than a page.
 *
 * Pure, and separated from the request on purpose: these are the two places
 * web_fetch used to mislead a researching model, and neither can be proven
 * through the socket, because the SSRF guard rightly refuses the loopback
 * address a local test server would have to bind.
 *
 * A CUT MUST SAY SO. The HTML path always appended a marker (html-to-text.js);
 * the non-HTML path sliced at 20k silently and left `truncated` false, so a
 * JSON response, a raw README or a CSV came back amputated mid-sentence and
 * indistinguishable from a complete document. Measured 2026-07-27: two real
 * fetches returned exactly 20,000 chars with no marker anywhere.
 *
 * A WALL IS NOT AN EMPTY PAGE. Cloudflare, DataDome and friends answer 200 with
 * a challenge shell that extracts to almost nothing, so the tool reported a
 * successful read and the model concluded the source had nothing on it.
 * Measured 2026-07-27: reddit.com, HTTP 200, 0 chars of text, title […]. "Blocked" sends the model elsewhere; "empty"
 * sends it away believing it checked. The test is markup-heavy AND word-poor,
 * because a bare text floor is wrong: example.com is a genuine page that
 * extracts to 127 characters, and the live suite caught exactly that.
 *
 * @param {string} raw the decoded body
 * @param {string} contentType the response content-type header
 * @param {number} status the HTTP status it arrived with
 * @returns {{title: string|null, text: string, overflowed: boolean, wall: string|null}}
 */
export const interpretBody = (raw, contentType, status) => {
  const isHtml = String(contentType || '').toLowerCase().includes('text/html');
  const overflowed = !isHtml && raw.length > WEB_TEXT_MAX;
  const title = isHtml ? extractTitle(raw) : null;
  const text = isHtml
    ? htmlToText(raw, WEB_TEXT_MAX)
    : `${raw.slice(0, WEB_TEXT_MAX)}${overflowed ? '\n[… truncated]' : ''}`;
  const smallJsShell = text.trim().length === 0
    && /<script\b[^>]*\bsrc\s*=/i.test(raw)
    && /<(?:div|main)\b[^>]*\bid\s*=\s*['"](?:root|app|__next)['"]/i.test(raw);
  const wall = isHtml && text.trim().length < WALL_TEXT_MIN
    && (raw.length >= WALL_MARKUP_MIN || smallJsShell)
    ? `the page answered ${status} but carried no readable text`
      + `${title ? ` (title: "${title}")` : ''} — this is usually a bot-verification `
      + `wall or a page that builds itself with JavaScript, not an empty source`
    : null;
  return { title, text, overflowed, wall };
};

// A rendered fallback is useful only when it returns more truth than the
// direct request. If it cannot, preserve the original failure and append the
// renderer's own reason instead of hiding which boundary failed. impure.
const renderedFallback = async (url, directFailure, config) => {
  if (!isBrowserRunConfigured(config)) return directFailure;
  const rendered = await fetchRenderedHtml(url, config);
  if (!rendered.ok) {
    return {
      ...directFailure,
      error: `${directFailure.error}; Kitesurf fallback failed (${rendered.error})`,
    };
  }
  const read = interpretBody(rendered.html, 'text/html', 200);
  if (read.wall || !read.text.trim()) {
    return {
      ...directFailure,
      error: `${directFailure.error}; Kitesurf rendered no readable page`
        + `${read.wall ? ` (${read.wall})` : ''}`,
    };
  }
  return {
    ok: true,
    url,
    status: null,
    title: read.title,
    text: read.text,
    truncated: rendered.truncated,
    renderer: 'kitesurf',
  };
};

/**
 * The human-readable gist of a refusal's own body.
 *
 * A non-200 used to be reported as a bare number with the body discarded — but
 * the reason is usually IN the body: a rate-limit notice, […],
 * […]. Told only "403", a researching model cannot tell a
 * bot wall from a dead link, and picks the wrong next move.
 *
 * Pure. Returns null when the body says nothing worth passing on, so the caller
 * never appends an empty "it said:".
 *
 * @param {string} raw the refusal body
 * @param {string} contentType its content-type
 * @returns {string|null}
 */
export const interpretRefusal = (raw, contentType) => {
  if (!raw) return null;
  const isHtml = String(contentType || '').toLowerCase().includes('text/html');
  const words = (isHtml ? `${extractTitle(raw) || ''} ${htmlToText(raw)}` : raw)
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return null;
  return words.length > REFUSAL_EXCERPT ? `${words.slice(0, REFUSAL_EXCERPT)}…` : words;
};

// Documents and data a being can read — anything else is not for this tool.
const isTextual = (contentType) => {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  return mime === 'text/html' || mime === 'text/plain' || mime === 'text/markdown'
    || mime === 'text/csv' || mime === 'application/json' || mime.endsWith('+json')
    || mime === 'text/xml' || mime === 'application/xml' || mime.endsWith('+xml');
};

// The request never resolves the name itself: `lookup` replays the guard's
// vetted addresses, and even they are re-checked at connect time — defense
// in depth behind the guard, not instead of it. Pure factory. Exported for
// media-fetch: the binary lane runs the SAME doctrine, never a parallel one.
export const pinnedLookup = (addrs) => (hostname, options, callback) => {
  const bad = addrs.find((a) => isPrivateHost(a.address));
  if (bad) {
    callback(new Error(`connect-time refusal: ${bad.address} is not a public address`));
    return;
  }
  if (options?.all) callback(null, addrs.map((a) => ({ address: a.address, family: a.family })));
  else callback(null, addrs[0].address, addrs[0].family);
};

/**
 * One guarded, DNS-pinned GET. Resolves with `{ res }` on response headers
 * or `{ error }` — never rejects (the caller turns every failure into
 * honest words for the being). impure.
 * @param {string} url
 * @param {Array<{address: string, family: number}>} addrs Guard-vetted addresses.
 * @param {{userAgent?: string, signal?: AbortSignal}} [options]
 */
export const requestWebOnce = (url, addrs, { userAgent = DEFAULT_UA, signal } = {}) => new Promise((resolve) => {
  const mod = url.startsWith('https:') ? https : http;
  const req = mod.request(url, {
    method: 'GET',
    lookup: pinnedLookup(addrs),
    timeout: TIMEOUT_MS,
    signal,
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html, text/plain, application/json, text/markdown, */*;q=0.5',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }, (res) => resolve({ res }));
  req.on('timeout', () => req.destroy(new Error(`no answer within ${TIMEOUT_MS / 1000}s`)));
  req.on('error', (err) => resolve({ error: err.message }));
  req.end();
});

// impure — read the body counted, never past maxBytes; the rest is dropped
// with the socket and the read reports itself truncated. Exported for
// media-fetch (the binary lane's ceiling is a post's, not a page's).
export const readBounded = (res, maxBytes = MAX_BYTES) => new Promise((resolve) => {
  const chunks = [];
  let total = 0;
  let truncated = false;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    resolve({ buf: Buffer.concat(chunks), truncated });
  };
  res.on('data', (chunk) => {
    if (settled) return;
    total += chunk.length;
    if (total > maxBytes) {
      truncated = true;
      chunks.push(chunk.subarray(0, chunk.length - (total - maxBytes)));
      res.destroy();
      settle();
      return;
    }
    chunks.push(chunk);
  });
  res.on('end', settle);
  res.on('error', () => { truncated = true; settle(); });
});

/**
 * Fetch one web page as bounded readable text. A direct guarded request runs
 * first; configured Kitesurf rendering is a fail-soft JS-wall fallback.
 * impure — real network.
 * @param {string} target
 * @param {{browserRun?: {accountId?: string, apiToken?: string, apiRoot?: string}}} [options]
 * @returns {Promise<{ok: true, url: string, status: number|null, title: string|null, text: string, truncated: boolean, renderer: 'direct'|'kitesurf'} | {ok: false, error: string}>}
 */
export const fetchWebPage = async (target, { browserRun = browserRunConfig() } = {}) => {
  let url = target;
  let hops = 0;
  // At most one browser-UA retry per fetch, counted separately from redirects
  // so a refusal never eats a hop the redirect chain still needs.
  let retriedAsBrowser = false;
  for (;;) {
    const guard = await assertSafeWebTarget(url);
    if (!guard.ok) return { ok: false, error: `target refused (${guard.reason})` };
    const { res, error } = await requestWebOnce(url, guard.addrs, {
      userAgent: retriedAsBrowser ? BROWSER_UA : DEFAULT_UA,
    });
    if (error) {
      const why = /no answer within/.test(error) ? 'the server did not answer in time' : `the network is unreachable (${error})`;
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
      // A REFUSAL EXPLAINS ITSELF IN ITS BODY, and we used to throw that away —
      // rate-limit notices, […], "this content moved". The
      // model was told only a number, so it could not tell a wall from a dead
      // link. Read it (bounded) before deciding.
      const refusal = await readBounded(res);
      const why = interpretRefusal(refusal.buf.toString('utf8'), res.headers['content-type']);
      if (RETRYABLE.has(res.statusCode) && !retriedAsBrowser) {
        // Refused for how we introduced ourselves. Try once as a browser.
        retriedAsBrowser = true;
        continue;
      }
      const failure = {
        ok: false,
        status: res.statusCode,
        error: `the server answered ${res.statusCode}`
          + `${retriedAsBrowser && RETRYABLE.has(res.statusCode) ? ' (also when retried as a browser)' : ''}`
          + `${why ? ` — it said: ${why}` : ''}`,
      };
      if (RETRYABLE.has(res.statusCode)) return renderedFallback(url, failure, browserRun);
      return failure;
    }
    const contentType = res.headers['content-type'] || '';
    if (!isTextual(contentType)) {
      res.destroy();
      return { ok: false, error: `not readable text (${contentType.split(';')[0] || 'unknown content type'})` };
    }
    const { buf, truncated } = await readBounded(res);
    const raw = buf.toString('utf8');
    // A CUT MUST SAY SO. The HTML path has always appended a marker
    // (html-to-text.js); the non-HTML path sliced silently and left
    // `truncated` false, so a JSON API response, a raw README or a CSV came
    // back amputated mid-sentence and read as the whole document. Measured on
    // 2026-07-27: two real fetches returned exactly 20,000 chars with no marker
    // anywhere. Research built on a half-document nobody knows is half is worse
    // than a fetch that failed.
    const read = interpretBody(raw, contentType, res.statusCode);
    if (read.wall) {
      return renderedFallback(url, {
        ok: false, url, status: res.statusCode, error: read.wall,
      }, browserRun);
    }
    return {
      ok: true,
      url,
      status: res.statusCode,
      title: read.title,
      text: read.text,
      truncated: truncated || read.overflowed,
      renderer: 'direct',
    };
  }
};
