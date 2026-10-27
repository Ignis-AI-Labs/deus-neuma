// facebook-read.js — a Facebook Page of the house as an agent reads it: the
// Page, its followers and likes, and its newest posts with their reactions,
// comments and shares. Read fresh on every call with the account's own Page
// token. Reach and insights need Page-insights permissions the house does not
// ask for (stats-metrics.js CAPABILITY), so they are not here.

import { resolveAccountCredential } from '../account-store.js';
import { facebookApiRoot } from '../facebook-poster.js';
import { getJson, countOf, refusedWords, POSTS_PER_READ } from './read-request.js';

const PAGE_FIELDS = 'name,link,about,fan_count,followers_count';
const POST_FIELDS = 'id,message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)';

// pure — Graph's refusal in words; code 190 is a dead or replaced token.
const readRefusal = (res) => (res.body?.error?.code === 190
  ? 'Facebook no longer accepts the Page token; paste a fresh one in Settings → API → Channel keys'
  : refusedWords('Facebook', res));

// pure — one Page post as the read shows it.
const postView = (p) => ({
  id: String(p.id),
  postedAt: p.created_time || null,
  url: p.permalink_url || null,
  facts: [],
  counts: [
    ['reactions', countOf(p.reactions?.summary?.total_count)],
    ['comments', countOf(p.comments?.summary?.total_count)],
    ['shares', countOf(p.shares?.count ?? 0)],
  ],
  text: String(p.message || ''),
});

/**
 * Read one Facebook Page of the house. impure — credential store + network.
 * @param {string} house
 * @param {{accountId: string, signal?: AbortSignal}} opts
 */
export const readFacebookAccount = async (house, { accountId, signal }) => {
  const credentials = await resolveAccountCredential(house, accountId);
  if (!credentials) return { ok: false, detail: `${accountId} has no Page id and token — add them in Settings → API → Channel keys` };
  const auth = { headers: { Authorization: `Bearer ${credentials.accessToken}` }, signal };
  const pageUrl = `${facebookApiRoot()}/${encodeURIComponent(credentials.pageId)}`;
  const page = await getJson(`${pageUrl}?fields=${encodeURIComponent(PAGE_FIELDS)}`, auth);
  if (!page.ok) return { ok: false, detail: readRefusal(page) };
  const account = {
    name: String(page.body?.name || ''),
    handle: null,
    url: page.body?.link || `https://www.facebook.com/${credentials.pageId}`,
    bio: String(page.body?.about || ''),
    counts: [['followers', countOf(page.body?.followers_count)], ['likes', countOf(page.body?.fan_count)]],
  };
  const posts = await getJson(`${pageUrl}/posts?fields=${encodeURIComponent(POST_FIELDS)}&limit=${POSTS_PER_READ}`, auth);
  return {
    ok: true,
    account,
    posts: posts.ok ? (posts.body?.data || []).map(postView) : null,
    postsError: posts.ok ? null : readRefusal(posts),
    hasMore: Boolean(posts.ok && posts.body?.paging?.next),
    noun: 'post',
    readAt: new Date().toISOString(),
  };
};
