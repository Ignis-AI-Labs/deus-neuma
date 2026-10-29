// youtube-read.js — a YouTube channel of the house as an agent reads it: the
// channel, its three counts and its newest uploads with their numbers. Read
// fresh on every call with the account's own connection (the youtube.readonly
// scope CONNECT asks for). Three quota units a read: the channel, its uploads
// list, the uploads' numbers.

import { resolveAccountCredential } from '../account-store.js';
import { refreshAccessToken } from '../youtube-oauth.js';
import { youtubeApiRoot } from '../youtube-api.js';
import { getJson, countOf, refusedWords, POSTS_PER_READ } from './read-request.js';

const RECONNECT = 'reconnect YouTube in Settings → API → Channel keys (CONNECT) and allow it to view the account';
const DESCRIPTION_SHOWN = 300;

// pure — a refusal from the Data API in words a reader can act on.
const readRefusal = (res) => {
  const reasons = (res.body?.error?.errors || []).map((e) => e?.reason);
  if (reasons.includes('quotaExceeded') || reasons.includes('dailyLimitExceeded')) {
    return 'the YouTube project\'s daily quota is used up (every channel shares it); it resets at midnight Pacific time';
  }
  if (reasons.includes('insufficientPermissions') || res.status === 401) return `the connection may not read this channel; ${RECONNECT}`;
  return refusedWords('YouTube', res);
};

/**
 * ISO-8601 video length (PT1H2M3S) in seconds, or null. Pure.
 * @param {string} iso
 * @returns {number|null}
 */
const isoSeconds = (iso) => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m || iso === 'P' || iso === 'PT') return null;
  const [d, h, min, s] = m.slice(1).map((v) => Number(v || 0));
  return ((d * 24 + h) * 60 + min) * 60 + s;
};

const shortened = (text) => {
  const t = String(text || '').trim();
  return [...t].length > DESCRIPTION_SHOWN ? `${[...t].slice(0, DESCRIPTION_SHOWN).join('')}…` : t;
};

/**
 * One upload as the read shows it. Pure.
 * @param {object} item - a playlistItems item
 * @param {object|undefined} video - its videos.list item (statistics, contentDetails, status)
 */
const uploadView = (item, video) => {
  const id = String(item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId || '');
  const seconds = isoSeconds(video?.contentDetails?.duration);
  const title = String(item?.snippet?.title || '');
  const description = shortened(item?.snippet?.description);
  return {
    id,
    postedAt: item?.contentDetails?.videoPublishedAt || item?.snippet?.publishedAt || null,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    facts: [seconds != null ? `${seconds}s` : null, video?.status?.privacyStatus || null].filter(Boolean),
    counts: [
      ['views', countOf(video?.statistics?.viewCount)],
      ['likes', countOf(video?.statistics?.likeCount)],
      ['comments', countOf(video?.statistics?.commentCount)],
    ],
    text: description ? `${title}\n${description}` : title,
  };
};

/**
 * Read one YouTube account of the house. impure — credential store + network.
 * @param {string} house
 * @param {{accountId: string, signal?: AbortSignal}} opts
 * @returns {Promise<{ok: true, account: object, posts: object[]|null, postsError: string|null, hasMore: boolean, noun: string, readAt: string}
 *   |{ok: false, detail: string}>}
 */
export const readYouTubeAccount = async (house, { accountId, signal }) => {
  const credentials = await resolveAccountCredential(house, accountId);
  if (!credentials) return { ok: false, detail: `${accountId} is not connected — CONNECT it in Settings → API → Channel keys` };
  const token = await refreshAccessToken(credentials, { signal });
  if (!token.ok) return { ok: false, detail: token.detail };
  const auth = { headers: { Authorization: `Bearer ${token.accessToken}` }, signal };
  const api = `${youtubeApiRoot()}/youtube/v3`;

  const channel = await getJson(`${api}/channels?part=snippet,statistics,contentDetails&mine=true`, auth);
  if (!channel.ok) return { ok: false, detail: readRefusal(channel) };
  const c = channel.body?.items?.[0];
  if (!c?.id) return { ok: false, detail: 'the connected Google account has no YouTube channel; create one, then reconnect' };
  const handle = String(c.snippet?.customUrl || '').replace(/^@/, '');
  const account = {
    name: String(c.snippet?.title || ''),
    handle: handle ? `@${handle}` : null,
    url: handle ? `https://www.youtube.com/@${handle}` : `https://www.youtube.com/channel/${c.id}`,
    bio: String(c.snippet?.description || ''),
    counts: [
      ['subscribers', c.statistics?.hiddenSubscriberCount ? null : countOf(c.statistics?.subscriberCount)],
      ['views', countOf(c.statistics?.viewCount)],
      ['videos', countOf(c.statistics?.videoCount)],
    ],
  };
  const done = (posts, postsError, hasMore = false) => ({ ok: true, account, posts, postsError, hasMore, noun: 'video', readAt: new Date().toISOString() });

  const playlist = c.contentDetails?.relatedPlaylists?.uploads;
  if (!playlist) return done(null, 'the channel names no uploads list');
  const items = await getJson(`${api}/playlistItems?part=snippet,contentDetails&maxResults=${POSTS_PER_READ}&playlistId=${encodeURIComponent(playlist)}`, auth);
  if (!items.ok) return done(null, readRefusal(items));
  const list = (items.body?.items || []).filter((i) => i?.contentDetails?.videoId || i?.snippet?.resourceId?.videoId);
  if (!list.length) return done([], null);
  const ids = list.map((i) => String(i.contentDetails?.videoId || i.snippet.resourceId.videoId));
  const videos = await getJson(`${api}/videos?part=statistics,contentDetails,status&id=${ids.map(encodeURIComponent).join(',')}`, auth);
  // The uploads stand without their numbers when the numbers cannot be read.
  const byId = new Map((videos.ok ? videos.body?.items || [] : []).map((v) => [String(v.id), v]));
  const posts = list.map((i, n) => uploadView(i, byId.get(ids[n])));
  return done(posts, videos.ok ? null : `the numbers could not be read: ${readRefusal(videos)}`, Boolean(items.body?.nextPageToken));
};
