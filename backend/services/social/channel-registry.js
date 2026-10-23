// Channel registry — the pure catalog of social platforms a neuma can speak
// through. Each entry declares the credential fields the witness supplies
// (with the .env bootstrap variable per field), so the credential store, the
// routes, and the Settings surface all read one source of truth.
//
// Only implemented channels appear here: every id has a real poster behind it
// (backend/services/social/<id>-poster.js). Adding a platform means adding the
// poster first, then the entry.

import { TIKTOK_POSTING_SCOPES } from './tiktok-oauth.js';

/**
 * @typedef {Object} ChannelField
 * @property {string} key    camelCase field name in the credential entry
 * @property {string} label  human label for the Settings surface
 * @property {boolean} secret masked in every API response when true
 * @property {string} env    .env bootstrap variable for this field
 * @property {string} [fallback] value used when neither store nor env carries one
 * @property {boolean} [connect] filled by the channel's CONNECT sign-in, never typed
 */

/**
 * @typedef {Object} ChannelEntry
 * @property {string} id
 * @property {string} name
 * @property {number} maxChars platform's own post-length ceiling (advisory — the API is the authority)
 * @property {ReadonlyArray<ChannelField>} fields
 * @property {boolean} [queueOnly] posts only through the operator-approved queue, never instantly
 */

const field = (key, label, secret, env, fallback) =>
  Object.freeze({ key, label, secret, env, ...(fallback !== undefined ? { fallback } : {}) });

// A field the channel's CONNECT sign-in writes (a refresh token): the desk
// shows a CONNECT button for it, never an input.
const connectField = (key, label, env) => Object.freeze({ ...field(key, label, true, env), connect: true });

/** @type {ReadonlyArray<ChannelEntry>} */
export const CHANNEL_CATALOG = Object.freeze([
  Object.freeze({
    id: 'x',
    name: 'X (Twitter)',
    maxChars: 280,
    fields: Object.freeze([
      field('apiKey', 'API Key', true, 'X_API_KEY'),
      field('apiSecret', 'API Key Secret', true, 'X_API_SECRET'),
      field('accessToken', 'Access Token', true, 'X_ACCESS_TOKEN'),
      field('accessSecret', 'Access Token Secret', true, 'X_ACCESS_SECRET'),
    ]),
  }),
  Object.freeze({
    id: 'telegram',
    name: 'Telegram',
    maxChars: 4096,
    fields: Object.freeze([
      field('botToken', 'Bot Token', true, 'TELEGRAM_BOT_TOKEN'),
      field('chatId', 'Channel / Chat ID', false, 'TELEGRAM_CHAT_ID'),
    ]),
  }),
  Object.freeze({
    id: 'discord',
    name: 'Discord',
    maxChars: 2000,
    fields: Object.freeze([
      field('botToken', 'Bot Token', true, 'DISCORD_BOT_TOKEN'),
      field('channelId', 'Channel ID', false, 'DISCORD_CHANNEL_ID'),
    ]),
  }),
  Object.freeze({
    id: 'facebook',
    name: 'Facebook Page',
    maxChars: 63206,
    fields: Object.freeze([
      field('pageId', 'Page ID', false, 'FACEBOOK_PAGE_ID'),
      field('accessToken', 'Page Access Token', true, 'FACEBOOK_PAGE_ACCESS_TOKEN'),
    ]),
  }),
  Object.freeze({
    id: 'mastodon',
    name: 'Mastodon',
    maxChars: 500,
    fields: Object.freeze([
      field('instanceUrl', 'Instance URL', false, 'MASTODON_INSTANCE_URL'),
      field('accessToken', 'Access Token', true, 'MASTODON_ACCESS_TOKEN'),
    ]),
  }),
  Object.freeze({
    id: 'bluesky',
    name: 'Bluesky',
    maxChars: 300,
    fields: Object.freeze([
      field('service', 'PDS Service URL', false, 'BLUESKY_SERVICE', 'https://bsky.social'),
      field('identifier', 'Handle or DID', false, 'BLUESKY_IDENTIFIER'),
      field('appPassword', 'App Password', true, 'BLUESKY_APP_PASSWORD'),
    ]),
  }),
  Object.freeze({
    id: 'linkedin',
    name: 'LinkedIn',
    maxChars: 3000,
    fields: Object.freeze([
      field('personUrn', 'Person URN (urn:li:person:…)', false, 'LINKEDIN_PERSON_URN'),
      field('accessToken', 'Access Token', true, 'LINKEDIN_ACCESS_TOKEN'),
      // REQUIRED, not optional: LinkedIn issues 60-day access tokens and gates
      // programmatic refresh to partners — the channel cannot be configured
      // without declaring when the token dies, or the lane dies silently.
      field('tokenExpiresAt', 'Token Expiry (ISO date — the verify script prints it)', false, 'LINKEDIN_TOKEN_EXPIRES_AT'),
    ]),
  }),
  Object.freeze({
    id: 'youtube',
    name: 'YouTube',
    // The queue's own text ceiling; the title and description limits are
    // YouTube's and are judged in youtube-metadata.js.
    maxChars: 4000,
    // A video is approved by the operator who has SEEN it: YouTube posts ride
    // the campaign queue only, never the instant post.
    queueOnly: true,
    // The operator's OWN Google Cloud project, Desktop app client: their
    // quota, their consent screen. The refresh token comes from CONNECT.
    fields: Object.freeze([
      field('clientId', 'OAuth Client ID (Desktop app)', false, 'YOUTUBE_CLIENT_ID'),
      field('clientSecret', 'OAuth Client Secret', true, 'YOUTUBE_CLIENT_SECRET'),
      connectField('refreshToken', 'Refresh Token (set by CONNECT)', 'YOUTUBE_REFRESH_TOKEN'),
    ]),
  }),
  Object.freeze({
    id: 'tiktok',
    name: 'TikTok',
    // The caption's own limit (2200) is TikTok's, judged in tiktok-metadata.js;
    // this ceiling leaves room for the settings lines around it.
    maxChars: 2400,
    // The operator approves a video they have SEEN: queue only, never instant.
    queueOnly: true,
    // The company's OWN TikTok developer app (or its sandbox): Login Kit for
    // Desktop + Content Posting. CONNECT fills the token pair; a refresh
    // replaces both before the access token's 24 hours run out.
    fields: Object.freeze([
      field('clientKey', 'Client Key', false, 'TIKTOK_CLIENT_KEY'),
      field('clientSecret', 'Client Secret', true, 'TIKTOK_CLIENT_SECRET'),
      connectField('refreshToken', 'Refresh Token (set by CONNECT)', 'TIKTOK_REFRESH_TOKEN'),
      connectField('accessToken', 'Access Token (set by CONNECT)', 'TIKTOK_ACCESS_TOKEN'),
      connectField('accessExpiresAt', 'Access Token Expiry (set by CONNECT)', 'TIKTOK_ACCESS_EXPIRES_AT'),
      // The permissions the person granted. A connection that recorded none
      // was made before the account view, when CONNECT asked for posting's
      // three alone: that is exactly what it holds.
      Object.freeze({ ...connectField('grantedScope', 'Granted Permissions (set by CONNECT)', 'TIKTOK_GRANTED_SCOPE'), fallback: TIKTOK_POSTING_SCOPES.join(',') }),
    ]),
  }),
]);

/**
 * Look up one channel by id (pure).
 * @param {string} id
 * @returns {ChannelEntry|null}
 */
export const getChannel = (id) => CHANNEL_CATALOG.find((c) => c.id === id) || null;

/**
 * Resolve a channel's full credential object from its store entry and an env
 * snapshot, field by field: store > env > declared fallback (pure). Returns
 * null unless EVERY field without a fallback resolved — a partial credential
 * set never advertises a channel that cannot work.
 * @param {ChannelEntry} channel
 * @param {Record<string, string>|undefined} storeEntry
 * @param {Record<string, string|undefined>} env
 * @returns {Readonly<Record<string, string>>|null}
 */
export const resolveChannelCredentials = (channel, storeEntry, env) => {
  const out = {};
  for (const f of channel.fields) {
    const stored = storeEntry?.[f.key];
    const fromEnv = env[f.env];
    const value = (typeof stored === 'string' && stored.length > 0) ? stored
      : (typeof fromEnv === 'string' && fromEnv.length > 0) ? fromEnv
        : f.fallback;
    if (typeof value !== 'string' || value.length === 0) return null;
    out[f.key] = value;
  }
  return Object.freeze(out);
};

/**
 * Safe view of one channel's credential state for the API surface — which
 * fields are set and from where, never the values themselves (pure).
 * @param {ChannelEntry} channel
 * @param {Record<string, string>|undefined} storeEntry
 * @param {Record<string, string|undefined>} env
 */
export const maskChannelCredentials = (channel, storeEntry, env) => Object.freeze({
  id: channel.id,
  name: channel.name,
  maxChars: channel.maxChars,
  configured: resolveChannelCredentials(channel, storeEntry, env) !== null,
  fields: Object.freeze(channel.fields.map((f) => {
    const stored = typeof storeEntry?.[f.key] === 'string' && storeEntry[f.key].length > 0;
    const fromEnv = typeof env[f.env] === 'string' && env[f.env].length > 0;
    // Same non-empty test the resolver applies — the mask must never call a
    // field set when resolution would refuse it.
    const hasFallback = typeof f.fallback === 'string' && f.fallback.length > 0;
    return Object.freeze({
      key: f.key,
      label: f.label,
      secret: f.secret,
      set: stored || fromEnv || hasFallback,
      source: stored ? 'store' : fromEnv ? 'env' : hasFallback ? 'default' : 'none',
      ...(f.connect ? { connect: true } : {}),
    });
  })),
});
