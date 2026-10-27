// stats-readers — one read per platform for the house's own sent posts, each
// with the posting ACCOUNT's own credential and the scopes the house already
// holds (campaign plan §4.3, slice 9). One batched call per account per pass
// where the platform batches (X 100 ids, YouTube 50, TikTok 20, Bluesky 25);
// Mastodon and Facebook one post per call, at most PER_CALL_CAP a pass.
//
// Every reader answers, never throws:
//   {ok: true, results: [{entryId, postId, metrics}], spent?}
//   {ok: false, kind: 'backoff', scope: 'account'|'app', ms, detail} — the platform said slow down
//   {ok: false, kind: 'unavailable', detail} — this access cannot read it (a plan, a scope): shown as —
//   {ok: false, kind: 'error', detail}
// API roots ride the platforms' existing env doors, so tests aim the REAL
// calls at local stand-ins.
//
// impure — credential store + network.

import crypto from 'crypto';
import { resolveAccountCredential } from '../account-store.js';
import { buildOAuth1Header } from '../x-poster.js';
import { refreshAccessToken } from '../youtube-oauth.js';
import { youtubeApiRoot } from '../youtube-api.js';
import { tiktokAccessFor } from '../tiktok-token.js';
import { tiktokApiRoot } from '../tiktok-oauth.js';
import { normalizeInstanceUrl } from '../mastodon-poster.js';
import { facebookApiRoot } from '../facebook-poster.js';
import { blueskyAppViewRoot } from '../bluesky-poster.js';
import { backoffMs, untilQuotaResetMs } from './stats-schedule.js';
import { fromX, fromYouTube, fromTikTok, fromMastodon, fromBluesky, fromFacebook } from './stats-metrics.js';

const PER_CALL_CAP = 20;
const DAY = 24 * 60 * 60 * 1000;
const xRoot = () => process.env.NEUMA_X_API_ROOT || 'https://api.x.com/2';
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

// impure — one JSON request; the headers a backoff reads ride along.
const request = async (url, init = {}) => {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, body, retryAfter: res.headers.get('retry-after'), resetAt: res.headers.get('x-rate-limit-reset') };
  } catch (err) {
    return { status: 0, ok: false, body: {}, detail: err.message };
  }
};

const slowDown = (res, scope, detail) => ({ ok: false, kind: 'backoff', scope, ms: backoffMs(res, Date.now()), detail });
const failed = (res, name) => ({ ok: false, kind: 'error', detail: res.detail ? `${name} did not answer (${res.detail})` : `${name} answered HTTP ${res.status}` });
const byPost = (posts) => new Map(posts.map((p) => [String(p.postId), p.id]));

/** X — GET /2/tweets?ids=, public_metrics (+ non_public_metrics under 30 days). */
const readX = async (house, accountId, posts) => {
  const credentials = await resolveAccountCredential(house, accountId);
  if (!credentials) return { ok: false, kind: 'unavailable', detail: `${accountId} has no X keys` };
  const fresh = posts.filter((p) => Date.now() - Date.parse(p.sentAt) < 30 * DAY);
  const older = posts.filter((p) => !fresh.includes(p));
  const results = [];
  const read = async (batch, fields) => {
    const url = `${xRoot()}/tweets`;
    const params = { ids: batch.map((p) => p.postId).join(','), 'tweet.fields': fields };
    const header = buildOAuth1Header(credentials, { method: 'GET', url, params, timestamp: String(Math.floor(Date.now() / 1000)), nonce: crypto.randomBytes(16).toString('hex') });
    return request(`${url}?${new URLSearchParams(params)}`, { headers: { Authorization: header } });
  };
  for (const [list, fields] of [[fresh, 'public_metrics,non_public_metrics'], [older, 'public_metrics']]) {
    for (const batch of chunks(list, 100)) {
      let res = await read(batch, fields);
      // A private-metrics refusal leaves the public ones: read again without them.
      if (!res.ok && [400, 403].includes(res.status) && fields !== 'public_metrics') res = await read(batch, 'public_metrics');
      if (res.status === 429) return slowDown(res, 'account', 'X asked the house to slow down');
      if ([401, 402, 403].includes(res.status)) {
        return { ok: false, kind: 'unavailable', detail: `X does not let this app read post numbers (${res.body?.title || res.body?.detail || `HTTP ${res.status}`}) — the X plan decides` };
      }
      if (!res.ok) return failed(res, 'X');
      const ids = byPost(batch);
      for (const tweet of res.body?.data || []) if (ids.has(String(tweet.id))) results.push({ entryId: ids.get(String(tweet.id)), postId: String(tweet.id), metrics: fromX(tweet) });
    }
  }
  return { ok: true, results };
};

/** YouTube — videos.list part=statistics (1 unit per 50 ids), youtube.readonly. */
const readYouTube = async (house, accountId, posts) => {
  const credentials = await resolveAccountCredential(house, accountId);
  if (!credentials) return { ok: false, kind: 'unavailable', detail: `${accountId} is not connected` };
  const token = await refreshAccessToken(credentials);
  if (!token.ok) return { ok: false, kind: 'error', detail: token.detail || 'YouTube refused the sign-in' };
  const results = [];
  let spent = 0;
  for (const batch of chunks(posts, 50)) {
    const res = await request(`${youtubeApiRoot()}/youtube/v3/videos?part=statistics&id=${batch.map((p) => encodeURIComponent(p.postId)).join(',')}`, {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
    });
    spent += 1;
    const reason = res.body?.error?.errors?.[0]?.reason;
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      return { ok: false, kind: 'backoff', scope: 'app', ms: untilQuotaResetMs(Date.now()), detail: 'the YouTube project\'s daily quota is used up — every channel shares it', spent };
    }
    if (res.status === 429) return { ...slowDown(res, 'app', 'YouTube asked the project to slow down'), spent };
    if (reason === 'insufficientPermissions' || res.status === 401) return { ok: false, kind: 'unavailable', detail: 'reconnect YouTube so it grants read access (youtube.readonly)', spent };
    if (!res.ok) return { ...failed(res, 'YouTube'), spent };
    const ids = byPost(batch);
    for (const item of res.body?.items || []) if (ids.has(String(item.id))) results.push({ entryId: ids.get(String(item.id)), postId: String(item.id), metrics: fromYouTube(item) });
  }
  return { ok: true, results, spent };
};

/** TikTok — POST /v2/video/query/ (video.list scope), 20 ids a call. */
const readTikTok = async (house, accountId, posts) => {
  const access = await tiktokAccessFor(house, { accountId });
  if (!access.ok) return { ok: false, kind: 'error', detail: access.detail };
  if (!String(access.credentials?.grantedScope || '').split(',').includes('video.list')) {
    return { ok: false, kind: 'unavailable', detail: 'TikTok\'s video.list permission was not granted at CONNECT — connect again and allow it' };
  }
  const videos = posts.filter((p) => /^\d+$/.test(String(p.postId)));
  const results = [];
  for (const batch of chunks(videos, 20)) {
    const res = await request(`${tiktokApiRoot()}/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ filters: { video_ids: batch.map((p) => String(p.postId)) } }),
    });
    const code = res.body?.error?.code;
    if (res.status === 429 || code === 'rate_limit_exceeded') return slowDown(res, 'account', 'TikTok asked the house to slow down');
    if (code === 'scope_not_authorized') return { ok: false, kind: 'unavailable', detail: 'TikTok\'s video.list permission is not granted' };
    if (!res.ok || (code && code !== 'ok')) return failed(res, 'TikTok');
    const ids = byPost(batch);
    for (const v of res.body?.data?.videos || []) if (ids.has(String(v.id))) results.push({ entryId: ids.get(String(v.id)), postId: String(v.id), metrics: fromTikTok(v) });
  }
  return { ok: true, results };
};

// One post per call (Mastodon, Facebook), at most PER_CALL_CAP a pass.
const readEach = async (posts, name, call, shape) => {
  const results = [];
  for (const p of posts.slice(0, PER_CALL_CAP)) {
    const res = await call(p);
    if (res.status === 429) return slowDown(res, 'account', `${name} asked the house to slow down`);
    if (res.status === 404) continue;
    if ([401, 403].includes(res.status) || (name === 'Facebook' && res.status === 400 && [10, 200].includes(res.body?.error?.code))) {
      return { ok: false, kind: 'unavailable', detail: `${name} does not let this access read post numbers (HTTP ${res.status})` };
    }
    if (!res.ok) return failed(res, name);
    results.push({ entryId: p.id, postId: String(p.postId), metrics: shape(res.body) });
  }
  return { ok: true, results };
};

const readMastodon = async (house, accountId, posts) => {
  const credentials = await resolveAccountCredential(house, accountId);
  const origin = process.env.NEUMA_MASTODON_API_ROOT || normalizeInstanceUrl(credentials?.instanceUrl);
  if (!credentials || !origin) return { ok: false, kind: 'unavailable', detail: `${accountId} has no Mastodon instance and token` };
  return readEach(posts, 'Mastodon', (p) => request(`${origin}/api/v1/statuses/${encodeURIComponent(p.postId)}`, {
    headers: { Authorization: `Bearer ${credentials.accessToken}` },
  }), fromMastodon);
};

const readFacebook = async (house, accountId, posts) => {
  const credentials = await resolveAccountCredential(house, accountId);
  if (!credentials) return { ok: false, kind: 'unavailable', detail: `${accountId} has no Page token` };
  const fields = 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares';
  return readEach(posts, 'Facebook', (p) => request(`${facebookApiRoot()}/${encodeURIComponent(p.postId)}?fields=${encodeURIComponent(fields)}`, {
    headers: { Authorization: `Bearer ${credentials.accessToken}` },
  }), fromFacebook);
};

/** Bluesky — the public AppView's getPosts (no sign-in), 25 uris a call. */
const readBluesky = async (_house, _accountId, posts) => {
  const results = [];
  for (const batch of chunks(posts, 25)) {
    const q = new URLSearchParams();
    for (const p of batch) q.append('uris', p.postId);
    const res = await request(`${blueskyAppViewRoot()}/xrpc/app.bsky.feed.getPosts?${q}`);
    if (res.status === 429) return slowDown(res, 'account', 'Bluesky asked the house to slow down');
    if (!res.ok) return failed(res, 'Bluesky');
    const ids = byPost(batch);
    for (const post of res.body?.posts || []) if (ids.has(String(post.uri))) results.push({ entryId: ids.get(String(post.uri)), postId: String(post.uri), metrics: fromBluesky(post) });
  }
  return { ok: true, results };
};

/** The reader for a platform, or null when it has no stats read (stats-metrics CAPABILITY). */
export const statsReaderFor = (channelId) => ({
  x: readX, youtube: readYouTube, tiktok: readTikTok, mastodon: readMastodon, bluesky: readBluesky, facebook: readFacebook,
})[channelId] || null;
