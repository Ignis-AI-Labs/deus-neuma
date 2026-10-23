// poster-registry.js — the one map from channel id to its poster. Every entry
// shares the same contract: post(credentials, text, {signal}) resolving to
// {ok:true, id} | {ok:false, status?, detail} — never a throw. The channel
// catalog and this map must cover the same ids: a catalog entry without a
// poster is a channel that cannot speak.

import { postToX } from './x-poster.js';
import { postToTelegram } from './telegram-poster.js';
import { postToDiscord } from './discord-poster.js';
import { postToMastodon } from './mastodon-poster.js';
import { postToBluesky } from './bluesky-poster.js';
import { postToFacebook } from './facebook-poster.js';
import { postToLinkedIn } from './linkedin-poster.js';
import { postToYouTube } from './youtube-poster.js';
import { postToTikTok } from './tiktok-poster.js';

export const POSTERS = Object.freeze({
  x: postToX,
  telegram: postToTelegram,
  discord: postToDiscord,
  mastodon: postToMastodon,
  bluesky: postToBluesky,
  facebook: postToFacebook,
  linkedin: postToLinkedIn,
  youtube: postToYouTube,
  tiktok: postToTikTok,
});

/**
 * The poster for a channel, or null (pure).
 * @param {string} channelId
 */
export const posterFor = (channelId) => POSTERS[channelId] || null;

// The channels whose post IS its media: the poster takes the staged file
// paths itself (`opts.media`) instead of ids uploaded ahead of time, because
// for a video the upload is the publication.
// Each names what a still image means there: YouTube has no photo post, and
// TikTok's needs a verified domain to pull from, which this app has not yet.
const OWN_MEDIA = Object.freeze({
  youtube: Object.freeze({ name: 'YouTube', photo: 'YouTube takes videos only; a photo cannot go to YouTube' }),
  tiktok: Object.freeze({ name: 'TikTok', photo: 'TikTok photo posts need a verified domain; coming later' }),
});

/**
 * Whether a channel's poster uploads its own media (pure).
 * @param {string} channelId
 */
export const postsOwnMedia = (channelId) => Object.hasOwn(OWN_MEDIA, channelId ?? '');

/**
 * A video channel's name and its refusal of a still image, or null (pure).
 * @param {string} channelId
 * @returns {{name: string, photo: string}|null}
 */
export const ownMediaChannel = (channelId) => (postsOwnMedia(channelId) ? OWN_MEDIA[channelId] : null);
