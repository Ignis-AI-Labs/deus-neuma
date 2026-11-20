// linkedin-connect.js — the desk's CONNECT for the LinkedIn channel: one
// house's sign-in, from the operator's own LinkedIn app to a token sealed in
// that house's channel credentials with the member it belongs to and the day
// it dies. The pending flow per house is the shared connect-flow.js; what is
// LinkedIn's own is below: the consent on its one registered loopback address
// (linkedin-oauth.js) and what the token must prove (both scopes, a member).

import { createConnectFlow, houseClientFor, sealConnection } from './connect-flow.js';
import { openOAuthLoopback } from './oauth-loopback.js';
import {
  buildLinkedInAuthorizeUrl, exchangeLinkedInCode, mintLinkedInState, missingLinkedInScopes, linkedinTokenRecord,
  LINKEDIN_CALLBACK_PATH, LINKEDIN_CALLBACK_PORT, LINKEDIN_REDIRECT_URI,
} from './linkedin-oauth.js';
import { readLinkedInIdentity } from './linkedin-poster.js';
import { createLogger } from '../logger.js';

const log = createLogger('SocialChannels.LinkedInConnect');

// impure — one LinkedIn consent on the fixed loopback address.
const openLinkedInConsent = ({ clientId, clientSecret, timeoutMs }) => openOAuthLoopback({
  platform: 'LinkedIn',
  port: LINKEDIN_CALLBACK_PORT,
  callbackPath: LINKEDIN_CALLBACK_PATH,
  mint: mintLinkedInState,
  buildAuthUrl: ({ redirectUri, state }) => buildLinkedInAuthorizeUrl({ clientId, redirectUri, state }),
  exchange: ({ code, redirectUri }) => exchangeLinkedInCode({ clientId, clientSecret, code, redirectUri }),
  timeoutMs,
});

// impure — what the consent's token becomes: a checked, named, sealed connection.
const settle = async (wallet, { tokens }, accountId) => {
  const missing = missingLinkedInScopes(tokens.scope);
  if (missing.length) {
    return { status: 'error', error: `access was granted without ${missing.join(' and ')} — in your LinkedIn app add the products "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn", then CONNECT again` };
  }
  const record = linkedinTokenRecord(tokens, Date.now());
  const me = await readLinkedInIdentity({ accessToken: record.accessToken });
  if (!me.ok) return { status: 'error', error: me.detail };
  const refused = await sealConnection(wallet, accountId, { ...record, personUrn: `urn:li:person:${me.data.sub}` }, { id: me.data.sub, name: me.data.name });
  if (refused) return { status: 'error', error: refused };
  log.info('LinkedIn connected', { wallet, accountId, expires: record.tokenExpiresAt });
  return { status: 'complete', channel: { id: me.data.sub, title: me.data.name ?? 'LinkedIn member', expiresAt: record.tokenExpiresAt } };
};

const flow = createConnectFlow({
  needClient: `save your LinkedIn app's client id and client secret first, and add ${LINKEDIN_REDIRECT_URI} to its Authorized redirect URLs (linkedin.com/developers → your app → Auth)`,
  resolveClient: (house) => houseClientFor(house, 'linkedin', { clientId: 'LINKEDIN_CLIENT_ID', clientSecret: 'LINKEDIN_CLIENT_SECRET' }),
  openConsent: openLinkedInConsent,
  settle,
});

/** Begin a house account's CONNECT (its first LinkedIn account when unnamed). impure. */
export const startLinkedInConnect = (wallet, accountId = 'linkedin-1') => flow.start(wallet, accountId);
/** The house account's connect outcome. impure. */
export const pollLinkedInConnect = (wallet, accountId = 'linkedin-1') => flow.poll(wallet, accountId);
/** Cancel the house account's pending connect, if any. impure. */
export const cancelLinkedInConnect = (wallet, accountId = 'linkedin-1') => flow.cancel(wallet, accountId);
