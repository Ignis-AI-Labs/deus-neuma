// youtube-api.js — the YouTube Data API v3 reads the channel needs: which
// channel a connection speaks as, a video's status, and the channel's most
// recent uploads (the arbiter when a send was lost mid-flight). Plus the one
// delete the operator's live verify script may ask for.
//
// The API root rides an env door read per call (NEUMA_YOUTUBE_API_ROOT), the
// same doctrine as NEUMA_X_API_ROOT: the platform's tests aim the REAL calls
// at a local server; production never sets it. Every call answers
// {ok:true, ...} | {ok:false, status?, detail} and never throws.

import { mapYouTubeError } from './youtube-metadata.js';

export const youtubeApiRoot = () => process.env.NEUMA_YOUTUBE_API_ROOT || 'https://www.googleapis.com';
const dataApi = () => `${youtubeApiRoot()}/youtube/v3`;

// impure — one authorised JSON call against the Data API; never throws.
const call = async (method, pathAndQuery, accessToken, { signal } = {}) => {
  try {
    const res = await fetch(`${dataApi()}${pathAndQuery}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal,
    });
    if (res.status === 204) return { ok: true, body: null };
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, body };
    return { ok: false, status: res.status, detail: mapYouTubeError(res.status, body) };
  } catch (err) {
    return { ok: false, detail: `YouTube did not answer (${err.message})` };
  }
};

/**
 * The channel this access token speaks as. impure — network (1 quota unit).
 * @returns {Promise<{ok: true, channel: {id: string, title: string, handle: string}}
 *   |{ok: false, status?: number, detail: string}>}
 */
export const readMyChannel = async (accessToken, opts) => {
  const out = await call('GET', '/channels?part=snippet&mine=true', accessToken, opts);
  if (!out.ok) return out;
  const item = out.body?.items?.[0];
  if (!item?.id) return { ok: false, detail: 'the connected Google account has no YouTube channel; create one, then reconnect' };
  return {
    ok: true,
    channel: Object.freeze({
      id: String(item.id),
      title: String(item.snippet?.title || ''),
      handle: String(item.snippet?.customUrl || '').replace(/^@/, ''),
    }),
  };
};

/**
 * One video's status block (privacy, upload state, the synthetic-media
 * flag). impure — network (1 quota unit).
 * @returns {Promise<{ok: true, status: object}|{ok: false, status?: number, detail: string}>}
 */
export const readVideoStatus = async (accessToken, videoId, opts) => {
  const out = await call('GET', `/videos?part=status&id=${encodeURIComponent(videoId)}`, accessToken, opts);
  if (!out.ok) return out;
  const item = out.body?.items?.[0];
  return item?.status ? { ok: true, status: item.status } : { ok: false, detail: `YouTube knows no video ${videoId} on this channel` };
};

/**
 * The channel's most recent uploads, newest first, as {id, title,
 * publishedAt}. impure —
 * network (2 quota units: the uploads playlist id, then its items).
 * @returns {Promise<{ok: true, uploads: Array<{id: string, title: string, publishedAt: string}>}
 *   |{ok: false, status?: number, detail: string}>}
 */
export const readRecentUploads = async (accessToken, { limit = 25, signal } = {}) => {
  const channel = await call('GET', '/channels?part=contentDetails&mine=true', accessToken, { signal });
  if (!channel.ok) return channel;
  const playlist = channel.body?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlist) return { ok: false, detail: 'the channel names no uploads list' };
  const items = await call('GET', `/playlistItems?part=snippet&maxResults=${limit}&playlistId=${encodeURIComponent(playlist)}`, accessToken, { signal });
  if (!items.ok) return items;
  return {
    ok: true,
    uploads: (items.body?.items || [])
      .map((i) => ({
        id: String(i.snippet?.resourceId?.videoId || ''),
        title: String(i.snippet?.title || ''),
        publishedAt: String(i.snippet?.publishedAt || ''),
      }))
      .filter((u) => u.id),
  };
};

/**
 * Delete one video. Needs the `youtube.force-ssl` scope, which the channel's
 * own connection never holds — only the verify script's one-off consent
 * does. impure — network.
 * @returns {Promise<{ok: true}|{ok: false, status?: number, detail: string}>}
 */
export const deleteVideo = async (accessToken, videoId, opts) => {
  const out = await call('DELETE', `/videos?id=${encodeURIComponent(videoId)}`, accessToken, opts);
  return out.ok ? { ok: true } : out;
};
