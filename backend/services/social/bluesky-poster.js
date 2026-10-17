// bluesky-poster.js — publish a post to Bluesky (AT Protocol) through the
// official XRPC endpoints: createSession with the app password, then
// createRecord into app.bsky.feed.post. Zero-dependency: plain fetch, pure
// record builder proven with real inputs and outputs.

/**
 * Build the app.bsky.feed.post record for one post (pure — timestamp injected
 * so the builder is deterministic and testable).
 * @param {string} text
 * @param {string} createdAt ISO-8601
 */
export const blueskyPostRecord = (text, createdAt) => Object.freeze({
  $type: 'app.bsky.feed.post',
  text,
  createdAt,
});

// impure — one XRPC POST; returns the parsed body or a failure shape.
const xrpcPost = async (service, method, headers, body, signal) => {
  const res = await fetch(`${service}/xrpc/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });
  const parsed = await res.json().catch(() => ({}));
  return { res, parsed };
};

/**
 * Is this a PDS origin the app password may be sent to? (pure) The service
 * URL is operator-provided config that receives the credential itself, so
 * plain http is never accepted — same posture as the Mastodon instance guard.
 * @param {string} service
 * @returns {boolean}
 */
export const isSecureServiceUrl = (service) => {
  if (typeof service !== 'string') return false;
  try {
    return new URL(service).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Publish one post. Never throws: every failure returns {ok:false, detail}.
 * Two legs (session, then record) — the barge-in signal rides both, so an
 * interrupt between them stops the publish before anything lands.
 * @param {{service: string, identifier: string, appPassword: string}|null} credentials
 * @param {string} text
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true, id: string}|{ok: false, status?: number, detail: string}>}
 */
// impure — network + clock
export const postToBluesky = async (credentials, text, { signal } = {}) => {
  if (!credentials) return { ok: false, detail: 'Bluesky credentials are not configured' };
  if (!isSecureServiceUrl(credentials.service)) {
    return { ok: false, detail: 'the configured PDS service URL is not a valid https origin' };
  }
  try {
    const session = await xrpcPost(credentials.service, 'com.atproto.server.createSession', {}, {
      identifier: credentials.identifier,
      password: credentials.appPassword,
    }, signal);
    if (!session.res.ok || !session.parsed?.accessJwt || !session.parsed?.did) {
      return {
        ok: false,
        status: session.res.status,
        detail: session.parsed?.message || `sign-in failed (HTTP ${session.res.status})`,
      };
    }
    const record = await xrpcPost(credentials.service, 'com.atproto.repo.createRecord', {
      Authorization: `Bearer ${session.parsed.accessJwt}`,
    }, {
      repo: session.parsed.did,
      collection: 'app.bsky.feed.post',
      record: blueskyPostRecord(text, new Date().toISOString()),
    }, signal);
    if (record.res.ok && record.parsed?.uri) {
      return { ok: true, id: String(record.parsed.uri) };
    }
    return {
      ok: false,
      status: record.res.status,
      detail: record.parsed?.message || `HTTP ${record.res.status}`,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, detail: 'interrupted by your operator before publishing' };
    }
    return { ok: false, detail: err.message };
  }
};
