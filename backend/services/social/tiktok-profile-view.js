// tiktok-profile-view.js — the pure law of the TikTok account view: which
// fields each permission lets the platform ask for, what TikTok's answers
// become, and the plain words for a connection that cannot read them yet.
//
// Field names and their scopes are TikTok's own (developers.tiktok.com:
// Get User Info, […]; Video Object, […]; Scopes Reference — profile_web_link is named by user.info.profile).
// TikTok's API reads a profile and never edits one: the view's way to change
// the bio, name or picture is the profile link, opened in TikTok.

import { missingTikTokScopes, TIKTOK_PROFILE_SCOPES } from './tiktok-oauth.js';

/** The user fields each permission opens. */
const USER_FIELDS_BY_SCOPE = Object.freeze({
  'user.info.basic': Object.freeze(['open_id', 'display_name', 'avatar_url']),
  'user.info.profile': Object.freeze(['username', 'bio_description', 'is_verified', 'profile_deep_link', 'profile_web_link']),
  'user.info.stats': Object.freeze(['follower_count', 'following_count', 'likes_count', 'video_count']),
});

/** What each video in the list carries. */
export const VIDEO_FIELDS = Object.freeze([
  'id', 'title', 'video_description', 'create_time', 'cover_image_url', 'share_url', 'duration',
  'view_count', 'like_count', 'comment_count', 'share_count',
]);

/** One page: TikTok's own ceiling. */
export const VIDEO_PAGE = 20;

/** What each view permission shows, in the person's words. */
const WHAT_IT_SHOWS = Object.freeze({
  'user.info.profile': 'the profile details',
  'user.info.stats': 'the counts',
  'video.list': 'the recent videos',
});

/**
 * The view permissions a connection's recorded grant lacks. Pure.
 * @param {string} grantedScope - comma-separated, as TikTok names it
 * @returns {string[]}
 */
export const missingProfileScopes = (grantedScope) => missingTikTokScopes(grantedScope, TIKTOK_PROFILE_SCOPES);

/**
 * The user fields to ask for: basic always, the rest only where granted
 * (asking for an ungranted field fails the whole read). Pure.
 * @param {ReadonlyArray<string>} missing
 * @returns {string[]}
 */
export const userFieldsFor = (missing) => Object.entries(USER_FIELDS_BY_SCOPE)
  .filter(([scope]) => !missing.includes(scope))
  .flatMap(([, fields]) => fields);

const joinWords = (parts) => (parts.length < 2 ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/**
 * The plain sentence a connection without the view's permissions shows, or
 * null when it has them all. Posting is unaffected and the sentence says so. Pure.
 * @param {ReadonlyArray<string>} missing
 * @returns {string|null}
 */
export const profileReconnectWords = (missing) => {
  const shows = missing.map((s) => WHAT_IT_SHOWS[s]).filter(Boolean);
  if (!shows.length) return null;
  return `Posting works. To see ${joinWords(shows)}, TikTok needs new permissions: press RECONNECT in Settings → API → Channel keys → TikTok and allow every permission`;
};

/** A count TikTok gave, or null when it gave none (never a drawn zero). Pure. */
const countOf = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null);

const textOf = (value) => (typeof value === 'string' ? value : '');

// Only an https link may become a press that leaves the desk.
const httpsOrNull = (value) => (typeof value === 'string' && /^https:\/\//i.test(value) ? value : null);

/**
 * The account as the view draws it. A field the connection may not read is
 * null, never invented. Pure.
 * @param {object} user - TikTok's `data.user`
 */
export const accountView = (user) => Object.freeze({
  id: textOf(user?.open_id),
  displayName: textOf(user?.display_name),
  username: textOf(user?.username) || null,
  bio: typeof user?.bio_description === 'string' ? user.bio_description : null,
  verified: typeof user?.is_verified === 'boolean' ? user.is_verified : null,
  // Pictures are judged by the relay (tiktok-image-relay.js), the only road they travel.
  avatarUrl: textOf(user?.avatar_url) || null,
  // The desk opens it in the person's browser: the web page first, the app link otherwise.
  profileUrl: httpsOrNull(user?.profile_web_link) || httpsOrNull(user?.profile_deep_link),
  counts: Object.freeze({
    followers: countOf(user?.follower_count),
    following: countOf(user?.following_count),
    likes: countOf(user?.likes_count),
    videos: countOf(user?.video_count),
  }),
});

/**
 * One video as the view draws it. Pure.
 * @param {object} video - one of TikTok's `data.videos`
 */
export const videoView = (video) => Object.freeze({
  id: String(video?.id ?? ''),
  caption: textOf(video?.title) || textOf(video?.video_description),
  postedAt: Number.isFinite(Number(video?.create_time)) && video?.create_time
    ? new Date(Number(video.create_time) * 1000).toISOString() : null,
  durationSec: countOf(video?.duration),
  coverUrl: textOf(video?.cover_image_url) || null,
  shareUrl: httpsOrNull(video?.share_url),
  counts: Object.freeze({
    views: countOf(video?.view_count),
    likes: countOf(video?.like_count),
    comments: countOf(video?.comment_count),
    shares: countOf(video?.share_count),
  }),
});

/**
 * A refused read in plain words (tiktok-api.js answers carry TikTok's code
 * and the posting lane's words, which speak of posts). Pure.
 * @param {{status?: number, code?: string|null, detail: string, reconnect?: boolean}} out
 * @returns {string}
 */
export const readRefusalWords = (out) => {
  if (out.code === 'scope_not_authorized') return profileReconnectWords(TIKTOK_PROFILE_SCOPES);
  if (out.reconnect) return out.detail;
  if (out.status === 429) return 'TikTok asked to slow down; press REFRESH in a minute';
  if (out.status) return `TikTok refused the account read (${out.code || `HTTP ${out.status}`})`;
  return out.detail;
};
