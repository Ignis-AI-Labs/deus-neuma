// tiktok-connect.js — the desk's CONNECT for the TikTok channel: Login Kit
// for Desktop, from the company's own TikTok app (client key + secret) to
// the token pair sealed in the house's channel credentials. The pending flow
// per house is the shared connect-flow.js and the listener the shared
// oauth-loopback.js; what is TikTok's own is below: the consent (hex PKCE,
// comma scopes, the registered /callback/ path on 127.0.0.1) and what its
// tokens must prove (every scope granted, an account to name).

import { setChannelCredential } from './channel-credentials.js';
import { createConnectFlow, houseClientFor } from './connect-flow.js';
import { openOAuthLoopback } from './oauth-loopback.js';
import {
  buildTikTokAuthorizeUrl, exchangeTikTokCode, mintTikTokPkce, missingTikTokScopes, tokenRecord, TIKTOK_CALLBACK_PATH,
  TIKTOK_POSTING_SCOPES,
} from './tiktok-oauth.js';
import { readTikTokUser } from './tiktok-api.js';
import { createLogger } from '../logger.js';

const log = createLogger('SocialChannels.TikTokConnect');

/**
 * Open one TikTok consent. impure — network listener + entropy.
 * @param {{clientKey: string, clientSecret: string, timeoutMs?: number}} client
 */
const openTikTokConsent = ({ clientKey, clientSecret, timeoutMs }) => openOAuthLoopback({
  platform: 'TikTok',
  callbackPath: TIKTOK_CALLBACK_PATH,
  mint: mintTikTokPkce,
  buildAuthUrl: ({ redirectUri, challenge, state }) => buildTikTokAuthorizeUrl({ clientKey, redirectUri, challenge, state }),
  exchange: ({ code, verifier, redirectUri }) => exchangeTikTokCode({ clientKey, clientSecret, code, verifier, redirectUri }),
  timeoutMs,
});

// impure — what the consent's tokens become: a checked, named, sealed
// connection. Only posting's own permissions are required; the account
// view's (profile, counts, videos) may be declined and the view says so.
const settle = async (wallet, { tokens }) => {
  const missing = missingTikTokScopes(tokens.scope, TIKTOK_POSTING_SCOPES);
  if (missing.length) {
    return { status: 'error', error: `TikTok granted access without ${missing.join(' and ')}; check the app has Login Kit and Content Posting (Direct Post on), then CONNECT again and allow every permission` };
  }
  const me = await readTikTokUser(tokens.access_token);
  if (!me.ok) return { status: 'error', error: me.detail };
  await setChannelCredential(wallet, 'tiktok', tokenRecord(tokens, Date.now()));
  log.info('TikTok connected', { wallet, openId: me.user.id });
  return { status: 'complete', channel: { id: me.user.id, title: me.user.displayName } };
};

const flow = createConnectFlow({
  needClient: 'save the TikTok app\'s client key and client secret first (developers.tiktok.com → Manage apps)',
  resolveClient: (house) => houseClientFor(house, 'tiktok', { clientKey: 'TIKTOK_CLIENT_KEY', clientSecret: 'TIKTOK_CLIENT_SECRET' }),
  openConsent: openTikTokConsent,
  settle,
});

/** Begin a house's CONNECT. impure. */
export const startTikTokConnect = (wallet) => flow.start(wallet);
/** The house's connect outcome. impure. */
export const pollTikTokConnect = (wallet) => flow.poll(wallet);
/** Cancel the house's pending connect, if any. impure. */
export const cancelTikTokConnect = (wallet) => flow.cancel(wallet);
