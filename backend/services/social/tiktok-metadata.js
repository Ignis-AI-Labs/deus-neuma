// tiktok-metadata.js — the pure law of a TikTok draft: how the queued text
// becomes a post's caption and settings, what the account's creator info
// allows, the AI label that always rides, and how a video is cut into the
// chunks TikTok takes.
//
// THE DRAFT SHAPE. A TikTok post is one video plus the words the operator
// approves. The words are the post's text, read like this:
//   · everything that is not a settings line is the CAPTION (TikTok's
//     `title`, at most 2200 UTF-16 units; #hashtags and @mentions ride in it);
//   · `privacy: only me|friends|followers|everyone`, `allow: comments, duet,
//     stitch` and `promotion: own brand|paid partnership` are the author's
//     SUGGESTIONS for the post's card. They set nothing: TikTok's posting
//     guidelines require the person to choose privacy from an empty dropdown
//     and to turn interactions and the disclosure on themselves, so the
//     operator's choices on the card (frontend/utils/tiktok-consent.js) are
//     what the post carries;
//   · `send: drafts` sends the video to the account's TikTok inbox instead,
//     where a person finishes the post in the TikTok app.
// Settings lines are read and never published.
//
// Limits are TikTok's own (Content Posting API reference and media transfer
// guide, developers.tiktok.com, read 2026-10-23): caption 2200 UTF-16 runes;
// a video up to 4GB; chunks of 5MB to 64MB (the last up to 128MB), 1 to 1000
// of them, the count rounded down so trailing bytes join the last chunk; a
// video under 5MB goes whole.

import { CONTAINS_SYNTHETIC_MEDIA } from '../image-forge/ai-disclosure.js';
import { readChoice } from '../../../frontend/utils/tiktok-consent.js';

export const CAPTION_MAX = 2200;
export const VIDEO_MAX_BYTES = 4 * 1024 ** 3;
export const CHUNK_MIN_BYTES = 5 * 1024 * 1024;
export const CHUNK_MAX_BYTES = 64 * 1024 * 1024;
export const CHUNK_COUNT_MAX = 1000;
/** 10MiB: inside TikTok's 5–64MB window, so a 4GB video is ~400 chunks. */
export const DEFAULT_CHUNK_BYTES = 10 * 1024 * 1024;

const PRIVACY_WORDS = Object.freeze({
  'only me': 'SELF_ONLY', private: 'SELF_ONLY', self_only: 'SELF_ONLY',
  friends: 'MUTUAL_FOLLOW_FRIENDS', mutual_follow_friends: 'MUTUAL_FOLLOW_FRIENDS',
  followers: 'FOLLOWER_OF_CREATOR', follower_of_creator: 'FOLLOWER_OF_CREATOR',
  everyone: 'PUBLIC_TO_EVERYONE', public: 'PUBLIC_TO_EVERYONE', public_to_everyone: 'PUBLIC_TO_EVERYONE',
});
const ALLOWABLE = Object.freeze(['comments', 'duet', 'stitch']);
const PROMOTIONS = Object.freeze({ 'own brand': 'ownBrand', 'your brand': 'ownBrand', 'paid partnership': 'paid', 'branded content': 'paid' });

const SETTING = /^\s*(privacy|allow|promotion|send)\s*:\s*(.*?)\s*$/i;

// pure — the settings lines, each at most once, and the words around them.
const splitSettings = (text) => {
  const settings = {};
  const words = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(SETTING);
    if (!m) { words.push(line); continue; }
    const key = m[1].toLowerCase();
    if (key in settings) return { error: `say the ${key} line at most once` };
    settings[key] = m[2].toLowerCase().replace(/\s+/g, ' ');
  }
  return { settings, caption: words.join('\n').trim() };
};

// pure — `allow: comments, duet` → {comment, duet, stitch}, or an error string.
const readAllow = (raw) => {
  const named = raw === undefined || raw === 'none' ? [] : raw.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = named.filter((n) => !ALLOWABLE.includes(n));
  if (unknown.length) return `allow takes comments, duet and stitch (or none), not "${unknown.join(', ')}"`;
  return { comment: named.includes('comments'), duet: named.includes('duet'), stitch: named.includes('stitch') };
};

/**
 * Read a queued TikTok post's text into the post's settings. Pure.
 * @param {string} text
 * @returns {{ok: true, meta: {mode: 'post'|'drafts', caption: string, suggested: {privacyLevel: string|null,
 *   allow: {comment: boolean, duet: boolean, stitch: boolean},
 *   promotion: {ownBrand: boolean, paid: boolean}}}} | {ok: false, detail: string}}
 */
export const parseTikTokDraft = (text) => {
  const split = splitSettings(text);
  if (split.error) return { ok: false, detail: split.error };
  const { settings, caption } = split;
  if (caption.length > CAPTION_MAX) {
    return { ok: false, detail: `the caption is ${caption.length} characters; TikTok allows at most ${CAPTION_MAX}` };
  }
  const mode = settings.send ?? 'post';
  if (mode !== 'post' && mode !== 'drafts') return { ok: false, detail: `send must be post or drafts, not "${settings.send}"` };
  if (mode === 'drafts') {
    const chosenInApp = ['privacy', 'allow', 'promotion'].filter((k) => k in settings);
    if (chosenInApp.length) {
      return { ok: false, detail: `a TikTok draft is finished in the TikTok app, where ${chosenInApp.join(' and ')} is chosen; remove that line or send as a post` };
    }
  }
  const privacyLevel = settings.privacy === undefined ? null
    : (Object.hasOwn(PRIVACY_WORDS, settings.privacy) ? PRIVACY_WORDS[settings.privacy] : undefined);
  if (privacyLevel === undefined) return { ok: false, detail: `privacy must be only me, friends, followers or everyone, not "${settings.privacy}"` };
  const allow = readAllow(settings.allow);
  if (typeof allow === 'string') return { ok: false, detail: allow };
  const promotionKey = settings.promotion === undefined || settings.promotion === 'none' ? null : PROMOTIONS[settings.promotion];
  if (settings.promotion !== undefined && settings.promotion !== 'none' && !promotionKey) {
    return { ok: false, detail: `promotion must be own brand or paid partnership (or none), not "${settings.promotion}"` };
  }
  if (promotionKey === 'paid' && privacyLevel === 'SELF_ONLY') {
    return { ok: false, detail: 'TikTok does not allow a paid partnership to be private (only me); choose another privacy, or remove the promotion line' };
  }
  return {
    ok: true,
    meta: Object.freeze({
      mode,
      caption,
      suggested: Object.freeze({
        privacyLevel, allow: Object.freeze(allow),
        promotion: Object.freeze({ ownBrand: promotionKey === 'ownBrand', paid: promotionKey === 'paid' }),
      }),
    }),
  };
};

/**
 * A video longer than the account may post, refused before a byte leaves
 * (creator info, queried before every post). Pure.
 * @param {{max_video_post_duration_sec?: number}} creator
 * @param {number|null} durationSec - the video's length, when it could be read
 * @returns {string|null}
 */
export const durationRefusal = (creator, durationSec) => {
  const max = Number(creator?.max_video_post_duration_sec) || null;
  return durationSec != null && max && durationSec > max
    ? `the video is ${Math.round(durationSec)} seconds long; this TikTok account takes at most ${max}. Nothing was published`
    : null;
};

/**
 * The `post_info` of a Direct Post: the approved caption and EXACTLY the
 * choices the operator approved on the card (tiktok-consent.js
 * consentRecord). `is_aigc` is the disclosure law's constant: everything the
 * house publishes is AI-made, so the label is never a choice. Pure.
 * @param {string} caption
 * @param {object} consent - the entry's approval record
 */
export const buildPostInfo = (caption, consent) => {
  const { privacyLevel, allow, commercial } = readChoice(consent);
  return Object.freeze({
    ...(caption ? { title: caption } : {}),
    privacy_level: privacyLevel,
    disable_comment: !allow.comment,
    disable_duet: !allow.duet,
    disable_stitch: !allow.stitch,
    brand_content_toggle: commercial.branded,
    brand_organic_toggle: commercial.yourBrand,
    is_aigc: CONTAINS_SYNTHETIC_MEDIA,
  });
};

/**
 * Why the store must not approve this TikTok entry, or null. A Direct Post
 * is approved only with the person's choices from its card (the consent),
 * and only for the copy they read (textSeen); a draft for the TikTok inbox
 * needs no choices, its settings are made in the TikTok app. Pure.
 * @param {{channelId: string, text: string}} entry
 * @param {{consent?: object|null, textSeen?: string}} decision
 * @returns {string|null}
 */
export const tiktokApproveRefusal = (entry, { consent, textSeen } = {}) => {
  if (entry.channelId !== 'tiktok') return null;
  if (textSeen !== entry.text) return 'this TikTok post changed since its card was read; read it again, then approve';
  const parsed = parseTikTokDraft(entry.text);
  if (!parsed.ok) return parsed.detail;
  return parsed.meta.mode === 'post' && !consent?.privacyLevel
    ? 'a TikTok post is approved from its card, where you choose who can watch, the interactions and the disclosure; nothing was approved'
    : null;
};

/**
 * How a video of `size` bytes is cut for FILE_UPLOAD. Pure.
 * @param {number} size
 * @param {number} [chunkBytes]
 * @returns {{ok: true, chunkSize: number, count: number, ranges: Array<{start: number, end: number}>}
 *   |{ok: false, detail: string}} ranges are end-exclusive
 */
export const chunkPlan = (size, chunkBytes = DEFAULT_CHUNK_BYTES) => {
  if (!(size > 0)) return { ok: false, detail: 'the video file is empty' };
  if (size > VIDEO_MAX_BYTES) return { ok: false, detail: `the video is ${(size / 1024 ** 3).toFixed(1)}GB; TikTok takes at most 4GB` };
  const want = Math.min(Math.max(chunkBytes, CHUNK_MIN_BYTES), CHUNK_MAX_BYTES);
  // Under one chunk, the video goes whole (TikTok: a video under 5MB must).
  const chunkSize = size <= want ? size : Math.max(want, Math.ceil(size / CHUNK_COUNT_MAX));
  const count = Math.floor(size / chunkSize);
  const ranges = Array.from({ length: count }, (_, i) => ({
    start: i * chunkSize,
    end: i === count - 1 ? size : (i + 1) * chunkSize,
  }));
  return { ok: true, chunkSize, count, ranges };
};

/** The FILE_UPLOAD `source_info` for a plan. Pure. */
export const fileUploadSource = (size, plan) => Object.freeze({
  source: 'FILE_UPLOAD', video_size: size, chunk_size: plan.chunkSize, total_chunk_count: plan.count,
});

/**
 * Why a queue draft cannot stand on TikTok, or null. The queue's own law
 * (queue-rules.js validateDraft) asks this for every TikTok draft, so the
 * refusal reaches the author at staging, not after the operator approved.
 * Shape only: the bytes are judged a video where media is resolved. Pure.
 * @param {{text?: string, media?: Array<object>|null, kind?: string}} draft
 * @returns {string|null}
 */
export const tiktokDraftRefusal = ({ text, media, kind } = {}) => {
  if (kind != null) return 'a TikTok post is one video: it has no replies or threads';
  const count = Array.isArray(media) ? media.length : 0;
  if (count === 0) return 'TikTok takes videos: a text-only post cannot go to TikTok. Attach exactly one video in media';
  if (count > 1) return `a TikTok post is exactly one video; this draft carries ${count} files`;
  const parsed = parseTikTokDraft(text);
  return parsed.ok ? null : parsed.detail;
};

/** A TikTok video's public page. Pure. */
export const tiktokVideoUrl = (username, id) => `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${encodeURIComponent(id)}`;
/** A TikTok account's profile page. Pure. */
export const tiktokProfileUrl = (username) => `https://www.tiktok.com/@${encodeURIComponent(username)}`;
