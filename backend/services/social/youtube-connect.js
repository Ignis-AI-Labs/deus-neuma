// youtube-connect.js — the desk's CONNECT for the YouTube channel: one
// house's Google consent, from the operator's own Desktop OAuth client to a
// refresh token sealed in that house's channel credentials. The pending
// flow per house is the shared connect-flow.js; what is YouTube's own is
// below: the consent (youtube-loopback.js) and what its tokens must prove
// (a refresh token, both scopes, a channel to name).

import { setChannelCredential } from './channel-credentials.js';
import { createConnectFlow, houseClientFor } from './connect-flow.js';
import { openLoopbackConsent } from './youtube-loopback.js';
import { missingScopes } from './youtube-oauth.js';
import { readMyChannel } from './youtube-api.js';
import { createLogger } from '../logger.js';

const log = createLogger('SocialChannels.YouTubeConnect');

// impure — what the consent's tokens become: a checked, named, sealed connection.
const settle = async (wallet, { tokens }) => {
  if (!tokens.refresh_token) {
    return { status: 'error', error: 'Google returned no refresh token. Remove this app\'s access at myaccount.google.com/permissions, then CONNECT again' };
  }
  const missing = missingScopes(tokens.scope);
  if (missing.length) {
    return { status: 'error', error: `access was granted without ${missing.map((s) => s.split('/').pop()).join(' and ')}; CONNECT again and leave every box ticked` };
  }
  const me = await readMyChannel(tokens.access_token);
  if (!me.ok) return { status: 'error', error: me.detail };
  await setChannelCredential(wallet, 'youtube', { refreshToken: tokens.refresh_token });
  log.info('YouTube connected', { wallet, channelId: me.channel.id });
  return { status: 'complete', channel: me.channel };
};

const flow = createConnectFlow({
  needClient: 'save the OAuth client id and client secret first (Google Cloud → Credentials → a Desktop app client)',
  resolveClient: (house) => houseClientFor(house, 'youtube', { clientId: 'YOUTUBE_CLIENT_ID', clientSecret: 'YOUTUBE_CLIENT_SECRET' }),
  openConsent: openLoopbackConsent,
  settle,
});

/** Begin a house's CONNECT. impure. */
export const startYouTubeConnect = (wallet) => flow.start(wallet);
/** The house's connect outcome. impure. */
export const pollYouTubeConnect = (wallet) => flow.poll(wallet);
/** Cancel the house's pending connect, if any. impure. */
export const cancelYouTubeConnect = (wallet) => flow.cancel(wallet);
