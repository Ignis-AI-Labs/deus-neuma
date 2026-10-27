// mastodon-read.js — a Mastodon account of the house as an agent reads it:
// the profile, its counts and its newest posts (not replies) with their
// favourites, boosts and replies. Read fresh on every call with the
// account's own token, on its own instance.

import { resolveAccountCredential } from '../account-store.js';
import { normalizeInstanceUrl } from '../mastodon-poster.js';
import { getJson, countOf, refusedWords, POSTS_PER_READ } from './read-request.js';

/**
 * Mastodon's HTML (a bio, a post) as plain text: paragraphs and line breaks
 * kept, tags dropped, the common entities read. Pure.
 * @param {string} html
 * @returns {string}
 */
const plainText = (html) => String(html || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .trim();

// pure — one status as the read shows it; a boost says whose post it is.
const postView = (s) => {
  const shown = s.reblog || s;
  return {
    id: String(s.id),
    postedAt: s.created_at || null,
    url: shown.url || s.url || null,
    facts: s.reblog ? [`boost of @${s.reblog.account?.acct || 'someone'}`] : [],
    counts: [
      ['favourites', countOf(shown.favourites_count)], ['boosts', countOf(shown.reblogs_count)], ['replies', countOf(shown.replies_count)],
    ],
    text: plainText(shown.content),
  };
};

/**
 * Read one Mastodon account of the house. impure — credential store + network.
 * @param {string} house
 * @param {{accountId: string, signal?: AbortSignal}} opts
 */
export const readMastodonAccount = async (house, { accountId, signal }) => {
  const credentials = await resolveAccountCredential(house, accountId);
  const origin = process.env.NEUMA_MASTODON_API_ROOT || normalizeInstanceUrl(credentials?.instanceUrl);
  if (!credentials || !origin) return { ok: false, detail: `${accountId} has no Mastodon instance and token — add them in Settings → API → Channel keys` };
  const auth = { headers: { Authorization: `Bearer ${credentials.accessToken}` }, signal };
  const me = await getJson(`${origin}/api/v1/accounts/verify_credentials`, auth);
  if (!me.ok) return { ok: false, detail: refusedWords('Mastodon', me) };
  const a = me.body || {};
  const account = {
    name: String(a.display_name || ''),
    handle: a.acct ? `@${a.acct}` : null,
    url: a.url || null,
    bio: plainText(a.note),
    counts: [['followers', countOf(a.followers_count)], ['following', countOf(a.following_count)], ['posts', countOf(a.statuses_count)]],
  };
  const list = await getJson(`${origin}/api/v1/accounts/${encodeURIComponent(a.id)}/statuses?exclude_replies=true&limit=${POSTS_PER_READ}`, auth);
  const posts = list.ok && Array.isArray(list.body) ? list.body.map(postView) : null;
  return {
    ok: true,
    account,
    posts,
    postsError: posts ? null : refusedWords('Mastodon', list),
    // Mastodon pages by the Link header; a full page means there may be more.
    hasMore: Boolean(posts && posts.length >= POSTS_PER_READ),
    noun: 'post',
    readAt: new Date().toISOString(),
  };
};
