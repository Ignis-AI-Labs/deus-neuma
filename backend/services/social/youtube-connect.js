// youtube-connect.js — the desk's CONNECT for the YouTube channel: one
// house's Google consent, from the operator's own Desktop OAuth client to a
// refresh token sealed in that house's channel credentials. The pending
// flow per house is the shared connect-flow.js; what is YouTube's own is
// below: the consent (youtube-loopback.js) and what its tokens must prove
// (a refresh token, both scopes, a channel to name).

import { createConnectFlow, houseClientFor, sealConnection } from './connect-flow.js';
import { openLoopbackConsent } from './youtube-loopback.js';
import { missingScopes } from './youtube-oauth.js';
import { readMyChannel } from './youtube-api.js';
import { createLogger } from '../logger.js';

const log = createLogger('SocialChannels.YouTubeConnect');

// impure — what the consent's tokens become: a checked, named, sealed connection.
const settle = async (wallet, { tokens }, accountId) => {
  if (!tokens.refresh_token) {
    return { status: 'error', error: 'Google returned no refresh token. Remove this app\'s access at myaccount.google.com/permissions, then CONNECT again' };
  }
  const missing = missingScopes(tokens.scope);
  if (missing.length) {
    return { status: 'error', error: `access was granted without ${missing.map((s) => s.split('/').pop()).join(' and ')}; CONNECT again and leave every box ticked` };
  }
  const me = await readMyChannel(tokens.access_token);
  if (!me.ok) return { status: 'error', error: me.detail };
  const refused = await sealConnection(wallet, accountId, { refreshToken: tokens.refresh_token }, { id: me.channel.id, name: me.channel.handle || me.channel.title });
  if (refused) return { status: 'error', error: refused };
  log.info('YouTube connected', { wallet, accountId, channelId: me.channel.id });
  return { status: 'complete', channel: me.channel };
};

const flow = createConnectFlow({
  needClient: 'save the OAuth client id and client secret first (Google Cloud → Credentials → a Desktop app client)',
  resolveClient: (house) => houseClientFor(house, 'youtube', { clientId: 'YOUTUBE_CLIENT_ID', clientSecret: 'YOUTUBE_CLIENT_SECRET' }),
  openConsent: openLoopbackConsent,
  settle,
});

/** Begin a house account's CONNECT (its first YouTube account when unnamed). impure. */
export const startYouTubeConnect = (wallet, accountId = 'youtube-1') => flow.start(wallet, accountId);
/** The house account's connect outcome. impure. */
export const pollYouTubeConnect = (wallet, accountId = 'youtube-1') => flow.poll(wallet, accountId);
/** Cancel the house account's pending connect, if any. impure. */
export const cancelYouTubeConnect = (wallet, accountId = 'youtube-1') => flow.cancel(wallet, accountId);
