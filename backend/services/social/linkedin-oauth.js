// linkedin-oauth.js — LinkedIn's sign-in for the desk's CONNECT (Founder,
// 2026-11-15: […]).
// The official three-legged OAuth 2.0 flow, with the operator's own LinkedIn
// app: Sign In with LinkedIn using OpenID Connect names the member, Share on
// LinkedIn (w_member_social) lets the house post as them. Those are the only
// two products any LinkedIn app is given without a partner agreement; nothing
// here reads the feed, messages or connections, because LinkedIn offers no
// such access to ordinary apps.
//
// LinkedIn matches the redirect address EXACTLY, port included, so the
// receiver stands on one fixed loopback port and path that the operator
// registers once in their LinkedIn app (LINKEDIN_REDIRECT_URI).
// Access tokens live about 60 days and are not refreshed for ordinary apps:
// the connection records when it dies, and CONNECT again renews it.
// The URL and the token record are PURE; the exchange is impure (network).

import { randomBytes } from 'crypto';
import process from 'node:process';

export const LINKEDIN_CALLBACK_PORT = 53682;
export const LINKEDIN_CALLBACK_PATH = '/linkedin/callback';
export const LINKEDIN_REDIRECT_URI = `http://127.0.0.1:${LINKEDIN_CALLBACK_PORT}${LINKEDIN_CALLBACK_PATH}`;
export const LINKEDIN_SCOPES = Object.freeze(['openid', 'profile', 'w_member_social']);
const oauthRoot = () => process.env.NEUMA_LINKEDIN_OAUTH_ROOT || 'https://www.linkedin.com';

/** The state for one consent. LinkedIn's web flow carries no PKCE: the client secret proves the app. */
export const mintLinkedInState = () => ({ verifier: null, challenge: null, state: randomBytes(24).toString('base64url') });

/** The consent URL the operator opens in their browser. Pure (but for the root's test door). */
export const buildLinkedInAuthorizeUrl = ({ clientId, redirectUri, state, scopes = LINKEDIN_SCOPES }) =>
  `${oauthRoot()}/oauth/v2/authorization?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, scope: scopes.join(' ') })}`;

/** The scopes the house needs that a grant left out. Pure. */
export const missingLinkedInScopes = (granted) => {
  const have = new Set(String(granted ?? '').split(/[\s,]+/).filter(Boolean));
  return LINKEDIN_SCOPES.filter((s) => !have.has(s));
};

/**
 * What a token answer becomes on the account: the token and the day it dies.
 * Pure. @param {{access_token: string, expires_in?: number}} tokens @param {number} now - epoch ms
 */
export const linkedinTokenRecord = (tokens, now) => ({
  accessToken: String(tokens.access_token),
  tokenExpiresAt: new Date(now + (Number(tokens.expires_in) > 0 ? Number(tokens.expires_in) : 60 * 86400) * 1000).toISOString(),
});

/**
 * Exchange the code for the member's token. impure — network. Never throws.
 * @returns {Promise<{ok: true, data: object} | {ok: false, detail: string}>}
 */
export const exchangeLinkedInCode = async ({ clientId, clientSecret, code, redirectUri }) => {
  try {
    const res = await fetch(`${oauthRoot()}/oauth/v2/accessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
    });
    const parsed = await res.json().catch(() => ({}));
    if (res.ok && parsed?.access_token) return { ok: true, data: parsed };
    return { ok: false, detail: `LinkedIn refused the sign-in: ${parsed?.error_description || parsed?.error || `HTTP ${res.status}`}` };
  } catch (err) {
    return { ok: false, detail: `LinkedIn could not be reached (${err.message})` };
  }
};
