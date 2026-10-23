// tiktok-poster.js — publish one queued post to TikTok: the post's one
// video, sent by FILE_UPLOAD either as a Direct Post to the profile or to the
// account's TikTok inbox as a draft (`send: drafts`), with the caption read
// from the approved text (tiktok-metadata.js), the settings EXACTLY as the
// operator approved them on the post's card (`opts.tiktokConsent`,
// frontend/utils/tiktok-consent.js) and the AI label (`is_aigc`) always
// raised on a Direct Post.
//
// The order is TikTok's posting guidelines': creator info is asked first, so
// the approved privacy and interaction choices are ones the account still
// allows, for the account the card named, and a too-long video is refused
// before a byte leaves (a changed world refuses the post, never adjusts it);
// then the publish is
// opened, its ticket (publish_id) handed to the caller BEFORE any byte is
// sent (so a send lost mid-flight can be settled against TikTok's own record
// of that publish, never guessed); then the chunks; then the status is
// polled until TikTok says published, sent to the inbox, or failed.
//
// The poster contract (poster-registry.js): post(credentials, text, opts)
// resolves {ok:true, id} | {ok:false, status?, detail} and never throws.
// Like YouTube the upload IS the post (postsOwnMedia): the video arrives as
// `opts.media`. TikTok's token is refreshed through the house's own store
// (tiktok-token.js), so `opts.house` names the house. A publish TikTok is
// still processing when the poll window closes answers `pending`, and the
// reconciler settles it from the ticket.

import { tiktokAccessFor } from './tiktok-token.js';
import { readTikTokUser, queryCreatorInfo, initTikTokVideo, fetchPublishStatus } from './tiktok-api.js';
import { sendTikTokChunks } from './tiktok-upload.js';
import {
  parseTikTokDraft, durationRefusal, buildPostInfo, chunkPlan, fileUploadSource, tiktokVideoUrl, tiktokProfileUrl,
} from './tiktok-metadata.js';
import { creatorView, sendRefusal } from '../../../frontend/utils/tiktok-consent.js';
import { failReasonWords, PRIVATE_UNTIL_REVIEW } from './tiktok-errors.js';
import { readVideoHead } from './video-media.js';
import { readVideoSeconds } from './video-duration.js';
import { readMediaFile } from './x-media.js';
import { abortableWait } from './abortable-wait.js';

/** The upload link lasts an hour and processing takes minutes: a claimed
 *  TikTok send this old without an outcome is settled by the reconciler. */
export const TIKTOK_SEND_LEASE_MS = 2 * 60 * 60 * 1000;
const POLL_MS = 5000; // TikTok allows 30 status reads a minute
const POLL_WINDOW_MS = 10 * 60 * 1000;

const NOT_CONNECTED = 'TikTok credentials are not configured: save your TikTok app\'s client key and secret, then press CONNECT in Settings → API → Channel keys';
const INTERRUPTED = Object.freeze({ ok: false, detail: 'interrupted by your operator before publishing' });
const PHOTO_LATER = 'TikTok photo posts need a verified domain; coming later';
// TikTok's guideline 5d: the person is told a published post may not show yet.
const STILL_PROCESSING = 'it may take a few minutes for the video to process and be visible on the profile';

/**
 * The account a house's TikTok connection speaks as. impure — store + network.
 * @param {string} house
 * @returns {Promise<{ok: true, user: {id: string, displayName: string}}|{ok: false, detail: string}>}
 */
export const readTikTokAccount = async (house, { signal, accountId } = {}) => {
  const token = await tiktokAccessFor(house, { signal, accountId });
  return token.ok ? readTikTokUser(token.accessToken, { signal }) : token;
};

/**
 * What the house's TikTok account allows right now, read for a post's card
 * (TikTok: […]). impure — store + network.
 * @param {string} house
 * @returns {Promise<{ok: true, creator: ReturnType<typeof creatorView>}|{ok: false, status?: number, detail: string}>}
 */
export const readTikTokCreator = async (house, { signal, accountId } = {}) => {
  const token = await tiktokAccessFor(house, { signal, accountId });
  if (!token.ok) return { ok: false, status: token.status, detail: token.detail };
  const creator = await queryCreatorInfo(token.accessToken, { signal });
  return creator.ok ? { ok: true, creator: creatorView(creator.data) } : creator;
};

/**
 * What a publish status means: still going, landed, or failed. Pure.
 * @param {{status?: string, fail_reason?: string, publicaly_available_post_id?: Array}} data
 * @returns {{state: 'pending'}|{state: 'published', postId: string|null}|{state: 'inbox'}|{state: 'failed', detail: string}}
 */
export const readPublishState = (data) => {
  const status = data?.status;
  if (status === 'PUBLISH_COMPLETE') {
    const ids = Array.isArray(data.publicaly_available_post_id) ? data.publicaly_available_post_id : [];
    return { state: 'published', postId: ids.length ? String(ids[0]) : null };
  }
  if (status === 'SEND_TO_USER_INBOX') return { state: 'inbox' };
  if (status === 'FAILED') return { state: 'failed', detail: failReasonWords(data.fail_reason) };
  return { state: 'pending' };
};

/**
 * The outcome a landed publish records. Pure.
 * @param {{state: string, postId?: string|null}} landed
 * @param {{publishId: string, username: string, privacyLevel: string|null}} ctx
 */
export const landedOutcome = (landed, { publishId, username, privacyLevel }) => {
  const postedAs = username ? { postedAs: { id: username, username } } : {};
  if (landed.state === 'inbox') {
    return {
      ok: true, id: publishId, ...postedAs,
      url: username ? tiktokProfileUrl(username) : null,
      text: 'sent to TikTok drafts: open the TikTok app\'s inbox notification to finish the post, paste the caption, and turn on the AI-generated content label there (the drafts route carries no caption or label)',
    };
  }
  const privateNote = privacyLevel === 'SELF_ONLY' ? ` (private: ${PRIVATE_UNTIL_REVIEW})` : '';
  return {
    ok: true, id: landed.postId || publishId, ...postedAs,
    url: username ? (landed.postId ? tiktokVideoUrl(username, landed.postId) : tiktokProfileUrl(username)) : null,
    text: `published to TikTok${privateNote}; ${STILL_PROCESSING}`,
  };
};

// impure — why the one file cannot go, in TikTok's words.
const videoOf = async (media) => {
  if (media.length !== 1) {
    return { ok: false, detail: media.length ? 'a TikTok post is exactly one video' : 'TikTok takes videos: this post carries no video, so nothing was published' };
  }
  const video = await readVideoHead(media[0].path);
  if (video.ok) return video;
  const still = await readMediaFile(media[0].path).catch(() => ({ ok: false }));
  return { ok: false, detail: still.ok ? PHOTO_LATER : `video refused: ${video.detail}` };
};

/**
 * Publish one video (or send it to the account's drafts). impure — disk + network.
 * @param {object|null} credentials - the house's resolved TikTok credentials
 * @param {string} text - the approved post text (caption and settings lines)
 * @param {{signal?: AbortSignal, media?: Array<{path: string}>, house?: string, accountId?: string,
 *   tiktokConsent?: object|null, onTicket?: (publishId: string) => Promise<unknown>, chunkBytes?: number,
 *   baseDelayMs?: number, pollMs?: number, pollWindowMs?: number}} [opts]
 * @returns {Promise<{ok: true, id: string, text: string, url: string|null, postedAs?: object}
 *   |{ok: false, status?: number, detail: string, pending?: boolean}>}
 */
export const postToTikTok = async (credentials, text, opts = {}) => {
  if (!credentials) return { ok: false, detail: NOT_CONNECTED };
  if (opts.signal?.aborted) return INTERRUPTED;
  const published = await publishOne(text, opts);
  // Once every byte is sent the publish is TikTok's: a barge-in then leaves it
  // pending for the reconciler, never reported as stopped.
  return !published.ok && !published.pending && opts.signal?.aborted ? INTERRUPTED : published;
};

// impure — the publish itself.
const publishOne = async (text, {
  signal, media = [], house, accountId, tiktokConsent, onTicket, chunkBytes, baseDelayMs, pollMs = POLL_MS, pollWindowMs = POLL_WINDOW_MS,
}) => {
  const parsed = parseTikTokDraft(text);
  if (!parsed.ok) return { ok: false, detail: parsed.detail };
  const { meta } = parsed;
  const video = await videoOf(media);
  if (!video.ok) return video;
  const plan = chunkPlan(video.size, chunkBytes);
  if (!plan.ok) return { ok: false, detail: `${plan.detail}; nothing was published` };
  const seconds = video.contentType === 'video/webm' ? null : await readVideoSeconds(video.path, video.size);

  const token = await tiktokAccessFor(house, { signal, accountId });
  if (!token.ok) return { ok: false, status: token.status, detail: token.detail };
  const creator = await queryCreatorInfo(token.accessToken, { signal });
  if (!creator.ok) return creator;
  const refusal = durationRefusal(creator.data, seconds)
    ?? (meta.mode === 'post' ? sendRefusal(tiktokConsent, creatorView(creator.data)) : null);
  if (refusal) return { ok: false, detail: refusal };

  const opened = await initTikTokVideo(token.accessToken, {
    mode: meta.mode,
    postInfo: meta.mode === 'post' ? buildPostInfo(meta.caption, tiktokConsent) : undefined,
    sourceInfo: fileUploadSource(video.size, plan),
    signal,
  });
  if (!opened.ok) return opened;
  // The ticket is kept before any byte leaves: without the bytes the publish
  // can never happen, so an unrecorded ticket is refused here, never risked.
  try {
    await onTicket?.(opened.publishId);
  } catch (err) {
    return { ok: false, detail: `the TikTok upload ticket could not be recorded (${err.message}); nothing was published` };
  }

  const sent = await sendTikTokChunks({
    uploadUrl: opened.uploadUrl, filePath: video.path, size: video.size, contentType: video.contentType,
    ranges: plan.ranges, signal, baseDelayMs,
  });
  if (!sent.ok) return sent;

  const username = String(creator.data?.creator_username || '');
  const deadline = Date.now() + pollWindowMs;
  while (!signal?.aborted) {
    const status = await fetchPublishStatus(token.accessToken, opened.publishId, { signal });
    const landed = status.ok ? readPublishState(status.data) : { state: 'pending' };
    if (landed.state === 'failed') return { ok: false, detail: landed.detail };
    if (landed.state !== 'pending') {
      return landedOutcome(landed, { publishId: opened.publishId, username, privacyLevel: tiktokConsent?.privacyLevel ?? null });
    }
    if (Date.now() + pollMs > deadline) break;
    await abortableWait(pollMs, signal).catch(() => null);
  }
  return {
    ok: false,
    pending: true,
    detail: `TikTok received the whole video and is still processing it (publish ${opened.publishId}); the outcome is settled from TikTok's record once it lands`,
  };
};
