/**
 * The ACCOUNT legs of the social stand-in (social-stats-stand-ins.js): what
 * the read_<platform> tools ask each platform, answered in its documented
 * shape from `state.accounts`. Modes on `state.accounts.<platform>.mode`:
 *   youtube  ok | scope (403 insufficientPermissions)
 *   facebook ok | expired (190, a dead Page token) | posts (the Page reads, its posts are refused)
 * They are NOT the platforms: whether the real ones answer is proven against
 * the owner's own accounts (scripts/platform-read-verify.mjs).
 */

/** The accounts the stand-in serves; each test run gets its own copy. */
export const ACCOUNTS = Object.freeze({
  youtube: {
    mode: 'ok',
    channel: {
      id: 'UCnorthwind',
      snippet: { title: 'Northwind', description: 'Films about the north wind.', customUrl: '@northwind' },
      statistics: { viewCount: '5400', subscriberCount: '321', hiddenSubscriberCount: false, videoCount: '2' },
      contentDetails: { relatedPlaylists: { uploads: 'UUnorthwind' } },
    },
    uploads: [
      { id: 'vid-new', title: 'Wind over water', description: 'A short about the sea.', publishedAt: '2026-10-20T10:00:00Z', duration: 'PT58S', privacy: 'public', views: '1200', likes: '88', comments: '7' },
      // A video that hides its likes has no likeCount at all.
      { id: 'vid-old', title: 'First light', description: '', publishedAt: '2026-10-01T10:00:00Z', duration: 'PT2M5S', privacy: 'unlisted', views: '40', comments: '0' },
    ],
  },
  facebook: {
    mode: 'ok',
    page: { id: '555', name: 'Northwind Studio', link: 'https://www.facebook.com/northwind', about: 'We make films.', fan_count: 900, followers_count: 1000 },
    posts: [{ id: '555_1', message: 'Out now: Wind over water', created_time: '2026-10-21T08:00:00+0000', permalink_url: 'https://www.facebook.com/northwind/posts/1', reactions: 31, comments: 4, shares: 2 }],
  },
  mastodon: {
    me: { id: '77', acct: 'northwind', display_name: 'Northwind', note: '<p>Films &amp; wind.</p>', url: 'https://social.example/@northwind', followers_count: 50, following_count: 10, statuses_count: 3 },
    statuses: [{ id: '109', created_at: '2026-10-22T09:00:00.000Z', content: '<p>Wind over water is out.<br>Watch it.</p>', url: 'https://social.example/@northwind/109', replies_count: 1, reblogs_count: 2, favourites_count: 9 }],
  },
  bluesky: {
    profile: { handle: 'northwind.bsky.social', displayName: 'Northwind', description: 'Films.', followersCount: 70, followsCount: 5, postsCount: 4 },
    feed: [{ post: { uri: 'at://did:plc:north/app.bsky.feed.post/3kabc', author: { handle: 'northwind.bsky.social' }, record: { text: 'Wind over water, out now', createdAt: '2026-10-22T10:00:00Z' }, likeCount: 12, repostCount: 3, replyCount: 1, quoteCount: 0 } }],
  },
});

const ok = (body) => ({ status: 200, body });
const youtubeRefusal = (reason) => ({ status: 403, body: { error: { code: 403, message: reason, errors: [{ reason }] } } });

const youtube = (yt, path, q) => {
  const parts = q.get('part') || '';
  if (path === '/youtube/v3/channels' && q.get('mine') === 'true' && parts.includes('statistics')) {
    return yt.mode === 'scope' ? youtubeRefusal('insufficientPermissions') : ok({ items: [yt.channel] });
  }
  if (path === '/youtube/v3/playlistItems' && q.get('playlistId') === yt.channel.contentDetails.relatedPlaylists.uploads) {
    return ok({
      items: yt.uploads.map((u) => ({
        snippet: { title: u.title, description: u.description, publishedAt: u.publishedAt, resourceId: { videoId: u.id } },
        contentDetails: { videoId: u.id, videoPublishedAt: u.publishedAt },
      })),
    });
  }
  // The stats sweep asks part=statistics alone; the account read asks for the length and privacy too.
  if (path === '/youtube/v3/videos' && parts.includes('contentDetails')) {
    const ids = (q.get('id') || '').split(',');
    return ok({
      items: yt.uploads.filter((u) => ids.includes(u.id)).map((u) => ({
        id: u.id,
        statistics: { viewCount: u.views, ...(u.likes === undefined ? {} : { likeCount: u.likes }), commentCount: u.comments },
        contentDetails: { duration: u.duration },
        status: { privacyStatus: u.privacy },
      })),
    });
  }
  return null;
};

const facebook = (fb, path) => {
  const base = `/${fb.page.id}`;
  if (path !== base && path !== `${base}/posts`) return null;
  if (fb.mode === 'expired') return { status: 400, body: { error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } } };
  if (path === base) return ok(fb.page);
  if (fb.mode === 'posts') return { status: 403, body: { error: { message: 'pages_read_engagement is required', code: 10 } } };
  return ok({
    data: fb.posts.map((p) => ({
      id: p.id, message: p.message, created_time: p.created_time, permalink_url: p.permalink_url,
      reactions: { data: [], summary: { total_count: p.reactions } },
      comments: { data: [], summary: { total_count: p.comments } },
      shares: { count: p.shares },
    })),
  });
};

const mastodon = (md, path) => {
  if (path === '/api/v1/accounts/verify_credentials') return ok(md.me);
  if (path === `/api/v1/accounts/${md.me.id}/statuses`) return ok(md.statuses);
  return null;
};

const bluesky = (bs, path, q) => {
  if (q.get('actor') !== bs.profile.handle) return null;
  if (path === '/xrpc/app.bsky.actor.getProfile') return ok(bs.profile);
  if (path === '/xrpc/app.bsky.feed.getAuthorFeed') return ok({ feed: bs.feed });
  return null;
};

/**
 * The account leg this request is, answered; null when it is not one.
 * @param {{accounts: object}} state
 * @param {string} method
 * @param {URL} url
 * @returns {{status: number, body: object}|null}
 */
export const accountRoute = (state, method, url) => {
  if (method !== 'GET') return null;
  const { accounts: a } = state;
  const q = url.searchParams;
  return youtube(a.youtube, url.pathname, q) || facebook(a.facebook, url.pathname)
    || mastodon(a.mastodon, url.pathname) || bluesky(a.bluesky, url.pathname, q);
};
