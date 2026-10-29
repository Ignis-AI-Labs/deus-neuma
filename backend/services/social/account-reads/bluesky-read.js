// bluesky-read.js — a Bluesky account of the house as an agent reads it: the
// profile, its counts and its newest posts (not replies) with their likes,
// reposts, replies and quotes. Bluesky's public AppView answers without a
// sign-in, so only the account's handle (or DID) is read from the store.

import { resolveAccountCredential } from '../account-store.js';
import { blueskyAppViewRoot } from '../bluesky-poster.js';
import { getJson, countOf, refusedWords, POSTS_PER_READ } from './read-request.js';

// pure — a post's web link from its at:// uri and its author's handle.
const webLink = (uri, handle) => {
  const rkey = String(uri || '').split('/').pop();
  return handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : null;
};

// pure — one feed item as the read shows it; a repost says whose post it is.
const postView = (item) => {
  const p = item.post || {};
  const reposted = item.reason?.$type === 'app.bsky.feed.defs#reasonRepost';
  return {
    id: String(p.uri || ''),
    postedAt: p.record?.createdAt || p.indexedAt || null,
    url: webLink(p.uri, p.author?.handle),
    facts: reposted ? [`repost of @${p.author?.handle || 'someone'}`] : [],
    counts: [
      ['likes', countOf(p.likeCount)], ['reposts', countOf(p.repostCount)],
      ['replies', countOf(p.replyCount)], ['quotes', countOf(p.quoteCount)],
    ],
    text: String(p.record?.text || ''),
  };
};

/**
 * Read one Bluesky account of the house. impure — credential store + network.
 * @param {string} house
 * @param {{accountId: string, signal?: AbortSignal}} opts
 */
export const readBlueskyAccount = async (house, { accountId, signal }) => {
  const credentials = await resolveAccountCredential(house, accountId);
  const actor = String(credentials?.identifier || '').replace(/^@/, '');
  if (!actor) return { ok: false, detail: `${accountId} has no handle — add it in Settings → API → Channel keys` };
  const root = `${blueskyAppViewRoot()}/xrpc`;
  const profile = await getJson(`${root}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`, { signal });
  if (!profile.ok) return { ok: false, detail: refusedWords('Bluesky', profile) };
  const p = profile.body || {};
  const account = {
    name: String(p.displayName || ''),
    handle: p.handle ? `@${p.handle}` : `@${actor}`,
    url: `https://bsky.app/profile/${p.handle || actor}`,
    bio: String(p.description || ''),
    counts: [['followers', countOf(p.followersCount)], ['following', countOf(p.followsCount)], ['posts', countOf(p.postsCount)]],
  };
  const feed = await getJson(`${root}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&filter=posts_no_replies&limit=${POSTS_PER_READ}`, { signal });
  return {
    ok: true,
    account,
    posts: feed.ok ? (feed.body?.feed || []).map(postView) : null,
    postsError: feed.ok ? null : refusedWords('Bluesky', feed),
    hasMore: Boolean(feed.ok && feed.body?.cursor),
    noun: 'post',
    readAt: new Date().toISOString(),
  };
};
