// x-poster.js — publish a post to X (Twitter) through the official v2 API,
// signed with OAuth 1.0a user context (4 operator-provided credentials, env
// only — the same env+runtime posture as every other provider key today).
//
// Reimplemented in NEUMA's own stack (study-don't-integrate): no SDK, no
// external CLI — Node crypto HMAC-SHA1 + fetch. The signing core is pure and
// proven against the canonical example in X's own OAuth documentation.

import crypto from 'crypto';

// The API root rides an env override read PER CALL — same doctrine as the
// social store paths: a test points the REAL poster at a real loopback
// server and asserts the wire body (RULE 0); production never sets it.
const apiRoot = () => process.env.NEUMA_X_API_ROOT || 'https://api.x.com/2';
const postEndpoint = () => `${apiRoot()}/tweets`;

/**
 * RFC 3986 percent-encoding — encodeURIComponent plus the five characters
 * it leaves bare but OAuth 1.0a requires encoded.
 * @param {string} value
 * @returns {string}
 */
export const percentEncode = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The OAuth 1.0a signature base string: METHOD & url & sorted-encoded params.
 * `params` carries oauth_* fields plus any query/form params (a JSON body is
 * never part of the signature, per spec).
 * @param {string} method
 * @param {string} url — without query string
 * @param {Record<string, string>} params
 * @returns {string}
 */
export const signatureBaseString = (method, url, params) => {
  const encoded = Object.entries(params)
    .map(([k, v]) => [percentEncode(k), percentEncode(v)])
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(encoded)}`;
};

/**
 * Build the OAuth 1.0a Authorization header for one request. Deterministic
 * given timestamp + nonce, so the signing path is testable as a pure
 * function against X's documented example.
 * @param {{apiKey: string, apiSecret: string, accessToken: string,
 *   accessSecret: string}} credentials
 * @param {{method: string, url: string, params?: Record<string, string>,
 *   timestamp: string, nonce: string}} request
 * @returns {string} the Authorization header value
 */
export const buildOAuth1Header = (credentials, { method, url, params = {}, timestamp, nonce }) => {
  const oauth = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  };
  const base = signatureBaseString(method, url, { ...params, ...oauth });
  const signingKey = `${percentEncode(credentials.apiSecret)}&${percentEncode(credentials.accessSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
  const fields = { ...oauth, oauth_signature: signature };
  const header = Object.keys(fields).sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(fields[k])}"`)
    .join(', ');
  return `OAuth ${header}`;
};

/**
 * The operator's X credentials, or null unless ALL four are set — a partial
 * credential set never advertises a tool that cannot work.
 * @returns {{apiKey: string, apiSecret: string, accessToken: string,
 *   accessSecret: string}|null}
 */
// impure — reads process env
export const xPostCredentials = () => {
  const apiKey = process.env.X_API_KEY;
  const apiSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_SECRET;
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  return Object.freeze({ apiKey, apiSecret, accessToken, accessSecret });
};

/**
 * Publish one post. Never throws: every failure returns {ok:false, detail}
 * so the consciousness reads a real outcome, not a stack trace. A post is
 * irreversible public speech, so the operator's barge-in signal cuts an
 * in-flight publish off.
 * @param {ReturnType<typeof xPostCredentials>} credentials
 * @param {string} text
 * @param {{signal?: AbortSignal, mediaIds?: Array<string>,
 *   replyToId?: string|null}} [opts] - mediaIds come from
 *   `x-media.js#uploadMedia`, already uploaded and described; replyToId
 *   makes the post an ANSWER to the named post (the reply lane).
 * @returns {Promise<{ok: true, id: string, text: string}
 *   |{ok: false, status?: number, detail: string}>}
 */
// impure — network + clock + entropy
export const postToX = async (credentials, text, { signal, mediaIds = [], replyToId = null } = {}) => {
  if (!credentials) return { ok: false, detail: 'X credentials are not configured' };
  const header = buildOAuth1Header(credentials, {
    method: 'POST',
    url: postEndpoint(),
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: crypto.randomBytes(16).toString('hex'),
  });
  // Media ids are named here and nowhere else: the upload itself published
  // nothing, so this request is still the single irreversible act. A reply
  // may carry BOTH linkage and media — X's API takes `reply` and `media` on
  // the same post — so each rides conditional on its own input, never one
  // winning over the other.
  const payload = { text };
  if (replyToId) payload.reply = { in_reply_to_tweet_id: String(replyToId) };
  if (mediaIds.length) payload.media = { media_ids: mediaIds };
  try {
    const res = await fetch(postEndpoint(), {
      method: 'POST',
      headers: { Authorization: header, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 201 && body?.data?.id) {
      return { ok: true, id: body.data.id, text: body.data.text };
    }
    const detail = body?.detail || body?.errors?.[0]?.message || body?.title || `HTTP ${res.status}`;
    return { ok: false, status: res.status, detail };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, detail: 'interrupted by your operator before publishing' };
    }
    return { ok: false, detail: err.message };
  }
};

/**
 * Delete one of the account's own posts (X API v2 DELETE /2/tweets/:id).
 * Never throws: every failure returns {ok:false, status?, detail}. X has no
 * edit endpoint — a correction is this delete, then the corrected words
 * posted fresh.
 * @param {ReturnType<typeof xPostCredentials>} credentials
 * @param {string} postId
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true}|{ok: false, status?: number, detail: string}>}
 */
// impure — network + clock + entropy
export const deleteFromX = async (credentials, postId, { signal } = {}) => {
  if (!credentials) return { ok: false, detail: 'X credentials are not configured' };
  const url = `${postEndpoint()}/${encodeURIComponent(String(postId))}`;
  const header = buildOAuth1Header(credentials, {
    method: 'DELETE',
    url,
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: crypto.randomBytes(16).toString('hex'),
  });
  try {
    const res = await fetch(url, { method: 'DELETE', headers: { Authorization: header }, signal });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.data?.deleted === true) return { ok: true };
    const detail = body?.detail || body?.errors?.[0]?.message || body?.title || `HTTP ${res.status}`;
    return { ok: false, status: res.status, detail };
  } catch (err) {
    return { ok: false, detail: err.name === 'AbortError' ? 'interrupted by your operator before deleting' : err.message };
  }
};
