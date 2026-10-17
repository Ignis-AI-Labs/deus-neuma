// facebook-poster.js — publish a text post to a Facebook PAGE through the
// official Graph API, with a Page access token. Pages (not personal profiles)
// are the outreach surface Meta's API actually permits. Zero-dependency:
// plain fetch, pure request builder proven with real inputs and outputs.

const GRAPH_VERSION = 'v21.0';
export { GRAPH_VERSION };

/**
 * Build the page-feed request for one post (pure). The token rides the
 * Authorization header, never the URL or body.
 * @param {{pageId: string, accessToken: string}} credentials
 * @param {string} text
 * @returns {{url: string, headers: Record<string, string>, body: {message: string}}}
 */
export const facebookFeedRequest = (credentials, text) => Object.freeze({
  url: `https://graph.facebook.com/${GRAPH_VERSION}/${credentials.pageId}/feed`,
  headers: Object.freeze({ Authorization: `Bearer ${credentials.accessToken}` }),
  body: Object.freeze({ message: text }),
});

/**
 * Publish one post. Never throws: every failure returns {ok:false, detail}
 * so the consciousness reads a real outcome. The operator's barge-in signal
 * cuts an in-flight publish off.
 * @param {{pageId: string, accessToken: string}|null} credentials
 * @param {string} text
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true, id: string}|{ok: false, status?: number, detail: string}>}
 */
// impure — network
export const postToFacebook = async (credentials, text, { signal } = {}) => {
  if (!credentials) return { ok: false, detail: 'Facebook credentials are not configured' };
  const { url, headers, body } = facebookFeedRequest(credentials, text);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const parsed = await res.json().catch(() => ({}));
    if (res.ok && parsed?.id) {
      return { ok: true, id: String(parsed.id) };
    }
    return { ok: false, status: res.status, detail: parsed?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, detail: 'interrupted by your operator before publishing' };
    }
    return { ok: false, detail: err.message };
  }
};
