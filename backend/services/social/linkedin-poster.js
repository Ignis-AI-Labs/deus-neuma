// linkedin-poster.js — publish a text post to a personal LinkedIn profile
// through the official UGC API, with a member access token (w_member_social).
// Personal profiles are the surface LinkedIn's self-serve API permits; company
// pages need the Community Management product (a later slice). Zero-dependency:
// plain fetch, pure request builders proven with real inputs and outputs.
//
// The member token is mortal: LinkedIn issues 60-day access tokens and gates
// programmatic refresh to partners. That is why the credential set carries a
// REQUIRED non-secret tokenExpiresAt — resolveChannelCredentials refuses a
// partial set, so the channel cannot be configured without telling the house
// when the token dies. linkedinExpiryNote turns it into the flight-test
// warning; the live probe remains the truth (a dead token fails it honestly).

const apiRoot = () => process.env.NEUMA_LINKEDIN_API_ROOT || 'https://api.linkedin.com';

/**
 * The headers every LinkedIn REST call rides (pure). The token travels the
 * Authorization header, never the URL or body; REST-li protocol version is
 * mandatory on the v2 API.
 * @param {{accessToken: string}} credentials
 */
const linkedinHeaders = (credentials) => Object.freeze({
  Authorization: `Bearer ${credentials.accessToken}`,
  'X-Restli-Protocol-Version': '2.0.0',
});

/**
 * Build the ugcPosts request for one text post (pure). The author is the
 * member's Person URN (the Facebook pageId precedent: a non-secret identity
 * field); visibility PUBLIC is the outreach surface.
 * @param {{personUrn: string, accessToken: string}} credentials
 * @param {string} text
 * @returns {{url: string, headers: Record<string, string>, body: object}}
 */
export const linkedinPostRequest = (credentials, text) => Object.freeze({
  url: `${apiRoot()}/v2/ugcPosts`,
  headers: linkedinHeaders(credentials),
  body: Object.freeze({
    author: credentials.personUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: Object.freeze({
      'com.linkedin.ugc.ShareContent': Object.freeze({
        shareCommentary: Object.freeze({ text }),
        shareMediaCategory: 'NONE',
      }),
    }),
    visibility: Object.freeze({
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    }),
  }),
});

/**
 * Build the OIDC identity request — who does this token speak as (pure). The
 * same wire the flight probe and the verify script ride: one path, proven
 * once, trusted everywhere.
 * @param {{accessToken: string}} credentials
 * @returns {{url: string, headers: Record<string, string>}}
 */
export const linkedinIdentityRequest = (credentials) => Object.freeze({
  url: `${apiRoot()}/v2/userinfo`,
  headers: linkedinHeaders(credentials),
});

/**
 * The expiry warning for a configured token, or null when there is nothing to
 * say (pure). A missing date earns silence; a PRESENT-but-unreadable one is
 * loud — a mistyped expiry must never read as a healthy lane. The live probe
 * is the truth; this is the courtesy that precedes it.
 * @param {string|undefined} tokenExpiresAt ISO date from the credential set
 * @param {number} [now] epoch ms (injected for the tests)
 * @returns {string|null}
 */
export const linkedinExpiryNote = (tokenExpiresAt, now = Date.now()) => {
  const raw = String(tokenExpiresAt || '');
  if (raw.length === 0) return null;
  const expiresAt = Date.parse(raw);
  if (!Number.isFinite(expiresAt)) {
    return 'the recorded token expiry is unreadable — re-record it (docs/user/integrations/linkedin.md)';
  }
  const days = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
  if (days <= 0) {
    return 'the token\'s recorded expiry has passed — re-auth now (docs/user/integrations/linkedin.md)';
  }
  if (days <= 7) {
    return `the token expires in ${days} day${days === 1 ? '' : 's'} — re-auth soon (docs/user/integrations/linkedin.md)`;
  }
  return null;
};

/**
 * Publish one post. Never throws: every failure returns {ok:false, detail} so
 * the consciousness reads a real outcome. A 201 without the X-RestLi-Id
 * header or body id is unresolved — no id, no receipt. Cancellation stops
 * the client wait; it cannot undo a request already received remotely.
 * @param {{personUrn: string, accessToken: string}|null} credentials
 * @param {string} text
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true, id: string}|{ok: false, status?: number, detail: string}>}
 */
// impure — network
export const postToLinkedIn = async (credentials, text, { signal } = {}) => {
  if (!credentials) return { ok: false, detail: 'LinkedIn credentials are not configured' };
  if (signal?.aborted) return { ok: false, detail: 'interrupted by your operator before publishing' };
  const { url, headers, body } = linkedinPostRequest(credentials, text);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const parsed = await res.json().catch(() => ({}));
    if (res.ok) {
      // The X-RestLi-Id header is the documented proof; the body id is the
      // same URN on a 201 whose header was stripped — either names the post.
      const id = res.headers.get('x-restli-id') || (parsed?.id != null ? String(parsed.id) : null);
      return id
        ? { ok: true, id }
        : { ok: false, status: res.status, detail: 'LinkedIn published but named no post id (X-RestLi-Id header and body id both absent)' };
    }
    return { ok: false, status: res.status, detail: parsed?.message || parsed?.error_description || `HTTP ${res.status}` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, detail: 'publishing was interrupted; the outcome is unknown — check LinkedIn before retrying' };
    }
    return { ok: false, detail: err.message };
  }
};

/**
 * Who does this token speak as — the OIDC userinfo read (the credential
 * proof). Never throws; the answer carries `sub` (the member id inside the
 * Person URN) and `name`.
 * @param {{accessToken: string}|null} credentials
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true, data: {sub: string, name?: string}}|{ok: false, status?: number, detail: string}>}
 */
// impure — network
export const readLinkedInIdentity = async (credentials, { signal } = {}) => {
  if (!credentials) return { ok: false, detail: 'LinkedIn credentials are not configured' };
  const { url, headers } = linkedinIdentityRequest(credentials);
  try {
    const res = await fetch(url, { headers, signal });
    const parsed = await res.json().catch(() => ({}));
    if (res.ok && parsed?.sub) {
      return { ok: true, data: { sub: String(parsed.sub), name: parsed.name != null ? String(parsed.name) : undefined } };
    }
    if (res.ok) {
      return { ok: false, status: res.status, detail: 'the userinfo answer named no member (no sub) — check that the Sign In with LinkedIn using OpenID Connect product is added' };
    }
    return { ok: false, status: res.status, detail: parsed?.message || parsed?.error_description || `HTTP ${res.status}` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, detail: 'interrupted by your operator before the account lookup finished' };
    }
    return { ok: false, detail: `no answer (${err.message})` };
  }
};
