// youtube-poster.js — publish one queued post to YouTube: the post's video,
// uploaded through the resumable `videos.insert` protocol, with the title,
// description, tags and privacy read from the approved text
// (youtube-metadata.js) and the AI disclosure always raised.
//
// The poster contract (poster-registry.js): post(credentials, text, opts)
// resolves {ok:true, id} | {ok:false, status?, detail} and never throws. A
// YouTube post differs in one way: the upload IS the post, so the video
// arrives as `opts.media` (a staged path the scheduler already re-verified)
// rather than as ids uploaded ahead of time (postsOwnMedia in the registry).
//
// Credentials are the operator's own Google Cloud Desktop client (id +
// secret) and the refresh token CONNECT stored; each post trades the refresh
// token for a short-lived access token.

import { refreshAccessToken } from './youtube-oauth.js';
import { readMyChannel } from './youtube-api.js';
import { buildVideoResource, parseYouTubeDraft } from './youtube-metadata.js';
import { readVideoHead } from './video-media.js';
import { startResumableSession, sendResumable } from './youtube-upload.js';

/** A claimed YouTube send may take hours to stream a large file before its
 *  outcome lands; the reconciler waits this long before judging it lost. */
export const YOUTUBE_SEND_LEASE_MS = 6 * 60 * 60 * 1000;

const NOT_CONNECTED = 'YouTube credentials are not configured: save your Google OAuth client id and secret, then press CONNECT in Settings → API → Channel keys';
// The poster contract's one barge-in answer, whichever step the signal cut.
const INTERRUPTED = Object.freeze({ ok: false, detail: 'interrupted by your operator before publishing' });

/**
 * The public watch URL of a video. Pure.
 * @param {string} id
 */
export const youtubeWatchUrl = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;

/**
 * The channel a stored connection speaks as. impure — network.
 * @param {{clientId: string, clientSecret: string, refreshToken: string}|null} credentials
 * @returns {Promise<{ok: true, channel: {id: string, title: string, handle: string}}
 *   |{ok: false, status?: number, detail: string}>}
 */
export const readYouTubeChannel = async (credentials, { signal } = {}) => {
  if (!credentials) return { ok: false, detail: NOT_CONNECTED };
  const token = await refreshAccessToken(credentials, { signal });
  if (!token.ok) return token;
  return readMyChannel(token.accessToken, { signal });
};

/**
 * Publish one video. impure — disk + network.
 * @param {{clientId: string, clientSecret: string, refreshToken: string}|null} credentials
 * @param {string} text - the approved post text (title, description, settings lines)
 * @param {{signal?: AbortSignal, media?: Array<{path: string}>,
 *   chunkBytes?: number, baseDelayMs?: number}} [opts]
 * @returns {Promise<{ok: true, id: string, text: string, url: string,
 *   postedAs?: {id: string, username: string}}|{ok: false, status?: number, detail: string}>}
 */
export const postToYouTube = async (credentials, text, { signal, media = [], chunkBytes, baseDelayMs } = {}) => {
  if (!credentials) return { ok: false, detail: NOT_CONNECTED };
  if (signal?.aborted) return INTERRUPTED;
  const published = await uploadOne(credentials, text, { signal, media, chunkBytes, baseDelayMs });
  return !published.ok && signal?.aborted ? INTERRUPTED : published;
};

// impure — the publish itself: metadata, video head, token, session, bytes.
const uploadOne = async (credentials, text, { signal, media, chunkBytes, baseDelayMs }) => {
  if (media.length !== 1) {
    return { ok: false, detail: media.length ? 'a YouTube post is exactly one video' : 'YouTube takes videos only: this post carries no video, so nothing was published' };
  }
  const parsed = parseYouTubeDraft(text);
  if (!parsed.ok) return { ok: false, detail: parsed.detail };
  const video = await readVideoHead(media[0].path);
  if (!video.ok) return { ok: false, detail: `video refused: ${video.detail}` };

  const token = await refreshAccessToken(credentials, { signal });
  if (!token.ok) return { ok: false, status: token.status, detail: token.detail };

  const session = await startResumableSession({
    accessToken: token.accessToken,
    resource: buildVideoResource(parsed.meta),
    size: video.size,
    contentType: video.contentType,
    signal,
    baseDelayMs,
  });
  if (!session.ok) return session;

  const sent = await sendResumable({
    sessionUri: session.sessionUri,
    filePath: video.path,
    size: video.size,
    contentType: video.contentType,
    signal,
    chunkBytes,
    baseDelayMs,
  });
  if (!sent.ok) return sent;
  const snippet = sent.video.snippet || {};
  return {
    ok: true,
    id: String(sent.video.id),
    text: parsed.meta.title,
    url: youtubeWatchUrl(sent.video.id),
    ...(snippet.channelId ? { postedAs: { id: String(snippet.channelId), username: String(snippet.channelTitle || '') } } : {}),
  };
};
