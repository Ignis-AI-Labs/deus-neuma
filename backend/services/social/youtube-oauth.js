// youtube-oauth.js — Google OAuth for an installed desktop app, the way
// Google documents it for desktop clients (developers.google.com/identity/
// protocols/oauth2/native-app, 2026-10-16): a loopback redirect on
// 127.0.0.1, PKCE (S256) always, the authorization code exchanged at the
// token endpoint, then a refresh token traded for an access token per use.
//
// The client is the OPERATOR'S OWN Google Cloud project (Desktop app type):
// their quota, their consent screen, no shared client shipped in the app.
// Scopes are the least that uploading needs: youtube.upload to publish and
// youtube.readonly to name the channel and read back what was uploaded.
//
// The token endpoint rides an env door read per call (NEUMA_GOOGLE_TOKEN_URL)
// so the platform's tests aim the REAL exchange at a local server that
// answers like Google's; production never sets it.

import { createHash, randomBytes } from 'crypto';
import { mapTokenError } from './youtube-metadata.js';

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const googleTokenUrl = () => process.env.NEUMA_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';

export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const YOUTUBE_SCOPES = Object.freeze([YOUTUBE_UPLOAD_SCOPE, YOUTUBE_READONLY_SCOPE]);

/**
 * The S256 code challenge for a PKCE verifier. Pure.
 * @param {string} verifier
 * @returns {string}
 */
export const pkceChallenge = (verifier) => createHash('sha256').update(verifier).digest('base64url');

/**
 * A fresh PKCE verifier and anti-forgery state. impure (entropy).
 * @returns {{verifier: string, challenge: string, state: string}}
 */
export const mintPkce = () => {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: pkceChallenge(verifier), state: randomBytes(24).toString('base64url') };
};

/**
 * The consent URL the operator opens in their browser. `access_type=offline`
 * asks for a refresh token; `prompt=consent` makes Google issue a new one on
 * every connect, so a reconnect always yields a token to store. Pure.
 * @param {{clientId: string, redirectUri: string, challenge: string,
 *   state: string, scopes?: ReadonlyArray<string>}} args
 * @returns {string}
 */
export const buildAuthorizeUrl = ({ clientId, redirectUri, challenge, state, scopes = YOUTUBE_SCOPES }) => {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
};

/**
 * The form body of the authorization-code exchange. The redirect URI must be
 * byte-identical to the one the consent URL named. Pure.
 */
export const authorizationCodeBody = ({ clientId, clientSecret, code, verifier, redirectUri }) => Object.freeze({
  code,
  client_id: clientId,
  client_secret: clientSecret,
  redirect_uri: redirectUri,
  grant_type: 'authorization_code',
  code_verifier: verifier,
});

/** The form body that trades a refresh token for an access token. Pure. */
export const refreshTokenBody = ({ clientId, clientSecret, refreshToken }) => Object.freeze({
  client_id: clientId,
  client_secret: clientSecret,
  refresh_token: refreshToken,
  grant_type: 'refresh_token',
});

/**
 * The scopes a consent asked for that the operator did not grant (Google's
 * granular consent lets them untick one). Pure.
 * @param {string} granted - the token response's space-separated `scope`
 * @param {ReadonlyArray<string>} [wanted]
 * @returns {string[]}
 */
export const missingScopes = (granted, wanted = YOUTUBE_SCOPES) => {
  const have = new Set(String(granted || '').split(/\s+/).filter(Boolean));
  return wanted.filter((s) => !have.has(s));
};

// impure — one form POST to the token endpoint; never throws.
const postToken = async (body, signal) => {
  try {
    const res = await fetch(googleTokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.access_token) return { ok: true, data };
    return { ok: false, status: res.status, ...mapTokenError(res.status, data) };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, reconnect: false, detail: 'interrupted before Google answered' };
    return { ok: false, reconnect: false, detail: `Google's sign-in service did not answer (${err.message})` };
  }
};

/**
 * Exchange an authorization code for tokens. impure — network.
 * @returns {Promise<{ok: true, data: {access_token: string, refresh_token?: string, scope?: string}}
 *   |{ok: false, status?: number, detail: string, reconnect: boolean}>}
 */
export const exchangeAuthorizationCode = (args, { signal } = {}) => postToken(authorizationCodeBody(args), signal);

/**
 * A fresh access token from the stored refresh token. impure — network.
 * @param {{clientId: string, clientSecret: string, refreshToken: string}} credentials
 * @returns {Promise<{ok: true, accessToken: string}|{ok: false, status?: number, detail: string, reconnect: boolean}>}
 */
export const refreshAccessToken = async (credentials, { signal } = {}) => {
  const out = await postToken(refreshTokenBody(credentials), signal);
  return out.ok ? { ok: true, accessToken: out.data.access_token } : out;
};
