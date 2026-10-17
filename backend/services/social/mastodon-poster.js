// mastodon-poster.js — publish a status to any Mastodon instance through the
// official REST API. Zero-dependency: plain fetch + Bearer token, pure URL
// normalization proven with real inputs and outputs.

/**
 * Normalize an operator-typed instance URL to a safe https origin (pure).
 * Accepts a bare host ("mastodon.social") or a full URL; anything that is not
 * https (or resolves to no host) returns null — the server will fetch this
 * URL, so plain http is never accepted.
 * @param {string} instanceUrl
 * @returns {string|null} e.g. "https://mastodon.social"
 */
export const normalizeInstanceUrl = (instanceUrl) => {
  if (typeof instanceUrl !== 'string' || instanceUrl.length === 0) return null;
  const withScheme = instanceUrl.includes('://') ? instanceUrl : `https://${instanceUrl}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname) return null;
  return `https://${url.host}`;
};

/**
 * Publish one status. Never throws: every failure returns {ok:false, detail}.
 * @param {{instanceUrl: string, accessToken: string}|null} credentials
 * @param {string} text
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true, id: string}|{ok: false, status?: number, detail: string}>}
 */
// impure — network
export const postToMastodon = async (credentials, text, { signal } = {}) => {
  if (!credentials) return { ok: false, detail: 'Mastodon credentials are not configured' };
  const origin = normalizeInstanceUrl(credentials.instanceUrl);
  if (!origin) return { ok: false, detail: 'the configured instance URL is not a valid https origin' };
  try {
    const res = await fetch(`${origin}/api/v1/statuses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: text }),
      signal,
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.id) {
      return { ok: true, id: String(body.id) };
    }
    return { ok: false, status: res.status, detail: body?.error || `HTTP ${res.status}` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, detail: 'interrupted by your operator before publishing' };
    }
    return { ok: false, detail: err.message };
  }
};
