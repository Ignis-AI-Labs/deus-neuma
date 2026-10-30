// youtube-metadata.js — the pure law of a YouTube draft: how the queued text
// becomes a video's title, description, tags and privacy, the limits YouTube
// holds them to, the disclosure that always rides, and the plain words for
// every refusal YouTube can give.
//
// THE DRAFT SHAPE. A YouTube post is one video plus the words the operator
// approves. The words are the post's text, read like this:
//   · the first line is the TITLE (required, at most 100 characters);
//   · everything after it is the DESCRIPTION;
//   · a line `privacy: public|unlisted|private` sets who can watch
//     (default unlisted), and a line `tags: one, two` sets the tags. These
//     two lines are settings, not words: they are read and never published.
// The operator approves exactly that text, so the title, description,
// privacy and tags that go out are the ones they read.
//
// Whether a clip becomes a Short is YouTube's decision, made from the video's
// shape and length (vertical, under three minutes). Nothing here forces it.
//
// Limits are YouTube's own (videos resource, developers.google.com/youtube/
// v3/docs/videos, 2026-10-15): title 100 characters, description 5000 bytes,
// tags 500 characters in total, no `<` or `>` in a title or description.

import { CONTAINS_SYNTHETIC_MEDIA } from '../image-forge/ai-disclosure.js';

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX_BYTES = 5000;
export const TAGS_MAX_CHARS = 500;
export const PRIVACY_STATUSES = Object.freeze(['public', 'unlisted', 'private']);
export const DEFAULT_PRIVACY = 'unlisted';

const PRIVACY_LINE = /^\s*privacy\s*:\s*(.*?)\s*$/i;
const TAGS_LINE = /^\s*tags\s*:\s*(.*?)\s*$/i;
const ANGLE = /[<>]/;

/**
 * How YouTube counts a tag list against its 500-character ceiling: each tag,
 * plus the quotes YouTube adds around a tag with a space, plus the commas
 * between tags. Pure.
 * @param {ReadonlyArray<string>} tags
 * @returns {number}
 */
export const tagsLength = (tags) => tags.reduce((sum, t) => sum + [...t].length + (t.includes(' ') ? 2 : 0), 0)
  + Math.max(0, tags.length - 1);

/**
 * Read a queued YouTube post's text into the video's metadata. Pure.
 * @param {string} text
 * @returns {{ok: true, meta: {title: string, description: string,
 *   tags: string[], privacyStatus: string}} | {ok: false, detail: string}}
 */
export const parseYouTubeDraft = (text) => {
  const lines = String(text || '').split(/\r?\n/);
  const privacy = [];
  const tagLines = [];
  const words = [];
  for (const line of lines) {
    const p = line.match(PRIVACY_LINE);
    const t = line.match(TAGS_LINE);
    if (p) privacy.push(p[1].toLowerCase());
    else if (t) tagLines.push(t[1]);
    else words.push(line);
  }
  if (privacy.length > 1 || tagLines.length > 1) {
    return { ok: false, detail: 'say the privacy line and the tags line at most once each' };
  }
  const privacyStatus = privacy[0] ?? DEFAULT_PRIVACY;
  if (!PRIVACY_STATUSES.includes(privacyStatus)) {
    return { ok: false, detail: `privacy must be public, unlisted or private, not "${privacy[0]}"` };
  }
  const firstIndex = words.findIndex((l) => l.trim());
  if (firstIndex === -1) {
    return { ok: false, detail: 'a YouTube video needs a title: the first line of the post is the title' };
  }
  const title = words[firstIndex].trim();
  if ([...title].length > TITLE_MAX) {
    return { ok: false, detail: `the title (the first line) is ${[...title].length} characters; YouTube allows at most ${TITLE_MAX}` };
  }
  const body = words.slice(firstIndex + 1).join('\n').trim();
  if (ANGLE.test(title) || ANGLE.test(body)) {
    return { ok: false, detail: 'YouTube refuses the characters < and > in a title or description; remove them' };
  }
  // The description is the post's own words: the AI disclosure rides in the
  // video's metadata, containsSyntheticMedia below (disclosure-line.js).
  const description = body;
  const bytes = Buffer.byteLength(description, 'utf8');
  if (bytes > DESCRIPTION_MAX_BYTES) {
    return { ok: false, detail: `the description is ${bytes} bytes; YouTube allows at most ${DESCRIPTION_MAX_BYTES}` };
  }
  const tags = (tagLines[0] ?? '').split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean);
  if (tags.some((t) => ANGLE.test(t))) return { ok: false, detail: 'a tag cannot hold < or >' };
  if (tagsLength(tags) > TAGS_MAX_CHARS) {
    return { ok: false, detail: `the tags come to ${tagsLength(tags)} characters; YouTube allows ${TAGS_MAX_CHARS} in total` };
  }
  return { ok: true, meta: Object.freeze({ title, description, tags, privacyStatus }) };
};

/**
 * The video resource `videos.insert` receives. Not made for kids (the house's
 * content is not directed at children), and `containsSyntheticMedia` is the
 * disclosure law's constant, never a choice. Pure.
 * @param {{title: string, description: string, tags: string[], privacyStatus: string}} meta
 */
export const buildVideoResource = (meta) => Object.freeze({
  snippet: Object.freeze({
    title: meta.title,
    description: meta.description,
    ...(meta.tags.length ? { tags: [...meta.tags] } : {}),
  }),
  status: Object.freeze({
    privacyStatus: meta.privacyStatus,
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: CONTAINS_SYNTHETIC_MEDIA,
  }),
});

/**
 * Why a queue draft cannot stand on YouTube, or null. The queue's own law
 * (queue-rules.js validateDraft) asks this for every YouTube draft, so the
 * refusal reaches the author at staging, not after the operator approved.
 * Shape only: the bytes are checked as a video where media is resolved. Pure.
 * @param {{text?: string, media?: Array<object>|null, kind?: string}} draft
 * @returns {string|null}
 */
export const youtubeDraftRefusal = ({ text, media, kind } = {}) => {
  if (kind != null) return 'a YouTube post is one video: it has no replies or threads';
  const count = Array.isArray(media) ? media.length : 0;
  if (count === 0) {
    return 'YouTube takes videos only: a text-only post cannot go to YouTube. Attach exactly one video in media';
  }
  if (count > 1) return `a YouTube post is exactly one video; this draft carries ${count} files`;
  const parsed = parseYouTubeDraft(text);
  return parsed.ok ? null : parsed.detail;
};

/** Where the operator reconnects; named in every refusal that needs it. */
const RECONNECT = 'reconnect YouTube in Settings → API → Channel keys (CONNECT)';

/**
 * A Google token-endpoint refusal in plain words. `invalid_grant` is a
 * revoked, expired or replaced refresh token: the only cure is to connect
 * again. Pure.
 * @param {number} status
 * @param {object} body - the token endpoint's JSON
 * @returns {{detail: string, reconnect: boolean}}
 */
export const mapTokenError = (status, body) => {
  const code = body?.error;
  if (code === 'invalid_grant') {
    return {
      reconnect: true,
      detail: `YouTube access was revoked or has expired; ${RECONNECT}. If it keeps expiring after a week, set the Google consent screen to In production`,
    };
  }
  if (code === 'invalid_client' || code === 'unauthorized_client') {
    return { reconnect: true, detail: `Google does not accept the OAuth client id or secret; check both, save, then ${RECONNECT}` };
  }
  return { reconnect: false, detail: `Google's sign-in service refused (${body?.error_description || code || `HTTP ${status}`})` };
};

const REASON_WORDS = Object.freeze({
  quotaExceeded: 'YouTube\'s daily quota for your Google Cloud project is used up (10,000 units and 100 uploads a day). It resets at midnight Pacific time; nothing was published',
  uploadLimitExceeded: 'this YouTube channel has hit its upload limit for now; nothing was published. Try again later',
  rateLimitExceeded: 'YouTube asked to slow down; nothing was published. Try again in a few minutes',
  userRateLimitExceeded: 'YouTube asked to slow down; nothing was published. Try again in a few minutes',
  mediaBodyTooLarge: 'the video file is too big for YouTube; nothing was published',
  invalidTitle: 'YouTube refused the title (the first line); shorten it or remove unusual characters',
  invalidDescription: 'YouTube refused the description; shorten it or remove unusual characters',
  invalidTags: 'YouTube refused the tags; use fewer or shorter tags',
  youtubeSignupRequired: 'the connected Google account has no YouTube channel; create one, then reconnect',
  insufficientPermissions: `the connection does not allow uploads; ${RECONNECT} and allow uploading`,
  forbidden: 'YouTube refused this upload for this channel; check the channel is in good standing in YouTube Studio',
  authError: `YouTube did not accept the sign-in; ${RECONNECT}`,
  invalidCredentials: `YouTube did not accept the sign-in; ${RECONNECT}`,
});

/**
 * A YouTube Data API refusal in plain words. Pure.
 * @param {number} status
 * @param {object} body - `{error: {code, message, errors: [{reason}]}}`
 * @returns {string}
 */
export const mapYouTubeError = (status, body) => {
  const reasons = (Array.isArray(body?.error?.errors) ? body.error.errors : []).map((e) => e?.reason);
  const known = reasons.find((r) => REASON_WORDS[r]);
  if (known) return REASON_WORDS[known];
  if (status === 401) return REASON_WORDS.authError;
  if (status === 413) return REASON_WORDS.mediaBodyTooLarge;
  const said = body?.error?.message || (typeof body?.error === 'string' ? body.error : null);
  return `YouTube refused the upload (${said || `HTTP ${status}`}); nothing was published`;
};
