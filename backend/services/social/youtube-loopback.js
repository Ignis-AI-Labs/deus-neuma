// youtube-loopback.js — the loopback receiver of Google's desktop OAuth flow.
//
// Google lets a desktop client redirect to any loopback port, so the shared
// receiver (oauth-loopback.js) stands on 127.0.0.1 at a port the OS picks,
// at the root path, and the code is exchanged with Google's PKCE (S256,
// base64url).
//
// Shared by the desk's CONNECT (youtube-connect.js) and the operator's live
// verify script, which asks a one-off consent for the delete scope and keeps
// nothing.

import { openOAuthLoopback } from './oauth-loopback.js';
import { buildAuthorizeUrl, exchangeAuthorizationCode, mintPkce, YOUTUBE_SCOPES } from './youtube-oauth.js';

/**
 * Open one Google consent. impure — network listener + entropy.
 * @param {{clientId: string, clientSecret: string, scopes?: ReadonlyArray<string>,
 *   timeoutMs?: number}} client
 * @returns {Promise<{authUrl: string, redirectUri: string,
 *   done: Promise<{ok: true, tokens: object}|{ok: false, detail: string}>,
 *   cancel: () => void}>}
 */
export const openLoopbackConsent = ({ clientId, clientSecret, scopes = YOUTUBE_SCOPES, timeoutMs }) => openOAuthLoopback({
  platform: 'Google',
  mint: mintPkce,
  buildAuthUrl: ({ redirectUri, challenge, state }) => buildAuthorizeUrl({ clientId, redirectUri, challenge, state, scopes }),
  exchange: ({ code, verifier, redirectUri }) => exchangeAuthorizationCode({ clientId, clientSecret, code, verifier, redirectUri }),
  timeoutMs,
});
