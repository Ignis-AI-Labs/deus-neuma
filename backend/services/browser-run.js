// Cloudflare Browser Run/Kitesurf — optional rendered-page fallback.
//
// This is deliberately NOT a search engine and never replaces the direct,
// DNS-pinned fetch. It is used only when a public page answers with a JS shell
// or retryable bot wall. The target crosses the same strict outward-only guard
// before its URL is sent to Cloudflare. Credentials come only from validated
// process config; neither a being nor a page can select the API endpoint.

import { getAppConfig } from '../config.js';
import { assertSafeWebTarget } from './web-guard.js';

const API_ROOT = 'https://api.cloudflare.com';
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 20_000;

/** Resolve Browser Run credentials without making import order a boot hazard. */
export const browserRunConfig = () => {
  try {
    const config = getAppConfig();
    return Object.freeze({
      accountId: String(config.cloudflareAccountId || ''),
      apiToken: String(config.cloudflareApiToken || ''),
    });
  } catch {
    return Object.freeze({ accountId: '', apiToken: '' });
  }
};

/** Pure readiness check; secrets never leave the boolean. */
export const isBrowserRunConfigured = ({ accountId = '', apiToken = '' } = browserRunConfig()) =>
  Boolean(String(accountId).trim() && String(apiToken).trim());

/** Read a Fetch Response body without letting a remote renderer fill the heap. */
const readFetchBodyBounded = async (body, maxBytes = MAX_BYTES) => {
  if (!body) return { text: '', truncated: false };
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - total;
    if (value.byteLength > remaining) {
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
};

const responseError = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    const message = parsed?.errors?.[0]?.message || parsed?.messages?.[0]?.message;
    if (message) return String(message).slice(0, 300);
  } catch {
    // A plain-text error is already the most honest detail available.
  }
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 300) : null;
};

const unwrapRenderedHtml = (raw, contentType) => {
  if (!String(contentType || '').toLowerCase().includes('application/json')) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.result === 'string') return parsed.result;
    if (typeof parsed?.result?.content === 'string') return parsed.result.content;
  } catch {
    // The caller will interpret the raw response and report a wall if it is one.
  }
  return raw;
};

/**
 * Ask Kitesurf for post-JavaScript HTML from one already-public target.
 * impure — strict DNS guard plus one real HTTPS request.
 *
 * `apiRoot` exists only for a real ephemeral wire proof; production callers
 * use the fixed Cloudflare origin above, so credentials cannot be redirected.
 *
 * @param {string} target
 * @param {{accountId?: string, apiToken?: string, apiRoot?: string}} [options]
 * @returns {Promise<{ok: true, html: string, truncated: boolean} | {ok: false, error: string}>}
 */
export const fetchRenderedHtml = async (target, options = browserRunConfig()) => {
  const {
    accountId = '',
    apiToken = '',
    apiRoot = API_ROOT,
  } = options;
  if (!isBrowserRunConfigured({ accountId, apiToken })) {
    return { ok: false, error: 'Cloudflare Browser Run is not configured' };
  }

  const guard = await assertSafeWebTarget(target);
  if (!guard.ok) return { ok: false, error: `target refused (${guard.reason})` };
  const safeTarget = new URL(target).toString();

  const endpoint = new URL(
    `/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/content`,
    apiRoot,
  );
  endpoint.searchParams.set('browser', 'kitesurf');
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: safeTarget,
        gotoOptions: { waitUntil: 'networkidle2', timeout: 15_000 },
        rejectResourceTypes: ['image', 'media', 'font'],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await readFetchBodyBounded(response.body);
    if (!response.ok) {
      const detail = responseError(body.text);
      return {
        ok: false,
        error: `Cloudflare Browser Run answered ${response.status}${detail ? ` — ${detail}` : ''}`,
      };
    }
    return {
      ok: true,
      html: unwrapRenderedHtml(body.text, response.headers.get('content-type')),
      truncated: body.truncated,
    };
  } catch (error) {
    return { ok: false, error: `Cloudflare Browser Run is unreachable (${error.message})` };
  }
};
