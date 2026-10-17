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

export const POSTERS = Object.freeze({
  x: postToX,
  telegram: postToTelegram,
  discord: postToDiscord,
  mastodon: postToMastodon,
  bluesky: postToBluesky,
  facebook: postToFacebook,
  linkedin: postToLinkedIn,
});

/**
 * The poster for a channel, or null (pure).
 * @param {string} channelId
 */
export const posterFor = (channelId) => POSTERS[channelId] || null;
