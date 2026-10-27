// tiktok-oauth.js — TikTok Login Kit for Desktop, the way TikTok documents it
// (developers.tiktok.com/doc/login-kit-desktop and
// /doc/oauth-user-access-token-management, both read 2026-10-23):
//   · the consent URL www.tiktok.com/v2/auth/authorize/ with `client_key`,
//     comma-separated scopes, a loopback redirect (localhost or 127.0.0.1,
//     a port required, a wildcard port allowed when registered), state, and
//     PKCE S256 — where TikTok's desktop challenge is the SHA-256 of the
//     verifier in HEX, not the base64url other platforms use;
//   · the token endpoint open.tiktokapis.com/v2/oauth/token/, form-encoded,
//     which needs the client SECRET on the code exchange and on every refresh,
//     desktop included. An access token lives 24 hours, a refresh token a
//     year, and a refresh may hand back a NEW refresh token, which must be
//     kept in place of the old.
//
// The client is the company's OWN TikTok developer app (or its sandbox). The
// API root rides an env door read per call (NEUMA_TIKTOK_API_ROOT) so the
// platform's tests aim the REAL exchange at a local server that answers like
// TikTok's; production never sets it.

import { createHash, randomBytes } from 'crypto';
import { mapTikTokTokenError } from './tiktok-errors.js';

export const TIKTOK_AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
export const tiktokApiRoot = () => process.env.NEUMA_TIKTOK_API_ROOT || 'https://open.tiktokapis.com';
const tokenUrl = () => `${tiktokApiRoot()}/v2/oauth/token/`;

/** The least posting needs: name the account, publish, and send to drafts. */
export const TIKTOK_POSTING_SCOPES = Object.freeze(['user.info.basic', 'video.publish', 'video.upload']);
/** What the account view reads: username, bio and verified mark; the four counts; the videos. */
export const TIKTOK_PROFILE_SCOPES = Object.freeze(['user.info.profile', 'user.info.stats', 'video.list']);
/** Every permission a CONNECT asks for. Posting needs only its own three. */
export const TIKTOK_SCOPES = Object.freeze([...TIKTOK_POSTING_SCOPES, ...TIKTOK_PROFILE_SCOPES]);
/** The redirect path the developer app registers (`http://127.0.0.1:*\/callback/`). */
export const TIKTOK_CALLBACK_PATH = '/callback/';

/**
 * TikTok's desktop S256 challenge: SHA-256 of the verifier, HEX encoded
 * (their sample: `CryptoJS.SHA256(code_verifier).toString(CryptoJS.enc.Hex)`). Pure.
 * @param {string} verifier
 * @returns {string}
 */
export const tiktokPkceChallenge = (verifier) => createHash('sha256').update(verifier).digest('hex');

/**
 * A fresh PKCE verifier (64 unreserved characters, inside TikTok's 43–128)
 * and anti-forgery state. impure (entropy).
 */
export const mintTikTokPkce = () => {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: tiktokPkceChallenge(verifier), state: randomBytes(24).toString('base64url') };
};

/**
 * The consent URL the operator opens in their browser. Pure.
 * @param {{clientKey: string, redirectUri: string, challenge: string, state: string}} args
 */
export const buildTikTokAuthorizeUrl = ({ clientKey, redirectUri, challenge, state }) => {
  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: 'code',
    scope: TIKTOK_SCOPES.join(','),
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${TIKTOK_AUTHORIZE_URL}?${params.toString()}`;
};

/** The form body of the code exchange; the redirect URI is byte-identical to the consent's. Pure. */
export const tiktokCodeBody = ({ clientKey, clientSecret, code, verifier, redirectUri }) => Object.freeze({
  client_key: clientKey,
  client_secret: clientSecret,
  code,
  grant_type: 'authorization_code',
  redirect_uri: redirectUri,
  code_verifier: verifier,
});

/** The form body of a refresh. Pure. */
export const tiktokRefreshBody = ({ clientKey, clientSecret, refreshToken }) => Object.freeze({
  client_key: clientKey,
  client_secret: clientSecret,
  grant_type: 'refresh_token',
  refresh_token: refreshToken,
});

/**
 * The scopes of `wanted` that were not granted (TikTok's `scope` is
 * comma-separated; a person may allow only some of them). Pure.
 * @param {string} granted
 * @param {ReadonlyArray<string>} [wanted]
 * @returns {string[]}
 */
export const missingTikTokScopes = (granted, wanted = TIKTOK_SCOPES) => {
  const have = new Set(String(granted || '').split(/[,\s]+/).filter(Boolean));
  return wanted.filter((s) => !have.has(s));
};

/**
 * What a token answer becomes in the house's store: both tokens, the
 * moment the access token stops working, and the permissions the person
 * granted (kept only when TikTok names them, so an answer without them never
 * erases the record). Pure.
 * @param {{access_token: string, refresh_token: string, expires_in: number, scope?: string}} data
 * @param {number} nowMs
 */
export const tokenRecord = (data, nowMs) => Object.freeze({
  accessToken: String(data.access_token),
  refreshToken: String(data.refresh_token),
  accessExpiresAt: new Date(nowMs + (Number(data.expires_in) || 0) * 1000).toISOString(),
  ...(typeof data.scope === 'string' && data.scope ? { grantedScope: data.scope } : {}),
});

// impure — one form POST to the token endpoint; never throws.
const postToken = async (body, signal) => {
  try {
    const res = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams(body).toString(),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.access_token && data?.refresh_token) return { ok: true, data };
    return { ok: false, status: res.status, ...mapTikTokTokenError(res.status, data) };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, reconnect: false, detail: 'interrupted before TikTok answered' };
    return { ok: false, reconnect: false, detail: `TikTok's sign-in service did not answer (${err.message})` };
  }
};

/**
 * Exchange an authorization code for tokens. impure — network.
 * @returns {Promise<{ok: true, data: object}|{ok: false, status?: number, detail: string, reconnect: boolean}>}
 */
export const exchangeTikTokCode = (args, { signal } = {}) => postToken(tiktokCodeBody(args), signal);

/**
 * Trade the refresh token for a new pair. impure — network.
 * @returns {Promise<{ok: true, data: object}|{ok: false, status?: number, detail: string, reconnect: boolean}>}
 */
export const refreshTikTokToken = (credentials, { signal } = {}) => postToken(tiktokRefreshBody(credentials), signal);
