// stats-metrics — what each platform can report about the house's own posts
// with the access the house holds, and each platform's answer read into ONE
// shape (campaign plan §4.3). A metric a platform does not report is ABSENT
// from the record, never 0 — the desk shows "—" and says why.
//
// Pure.

/** The one shape: every metric a result may carry. */
export const METRICS = Object.freeze(['views', 'likes', 'replies', 'shares', 'saves', 'quotes', 'linkClicks', 'profileClicks']);

/**
 * Per platform: what its read reports, and — for what it cannot — why, in
 * the operator's words. `reads: false` means no stats read exists for it.
 */
export const CAPABILITY = Object.freeze({
  x: Object.freeze({
    reads: true, reports: ['views', 'likes', 'replies', 'shares', 'quotes', 'saves', 'linkClicks', 'profileClicks'],
    why: 'link and profile clicks only for the house\'s own posts under 30 days old; what the X plan allows is read at the call — a plan that does not include it shows —',
  }),
  youtube: Object.freeze({ reads: true, reports: ['views', 'likes', 'replies'], why: 'watch time, traffic and click-through need YouTube Analytics (yt-analytics.readonly), which the house does not ask for' }),
  tiktok: Object.freeze({ reads: true, reports: ['views', 'likes', 'replies', 'shares'], why: 'TikTok reports no link clicks or watch time to an app' }),
  mastodon: Object.freeze({ reads: true, reports: ['likes', 'replies', 'shares'], why: 'Mastodon counts no views' }),
  bluesky: Object.freeze({ reads: true, reports: ['likes', 'replies', 'shares', 'quotes'], why: 'Bluesky counts no views' }),
  facebook: Object.freeze({ reads: true, reports: ['likes', 'replies', 'shares'], why: 'reach and insights need Page insights permissions, which the house does not ask for' }),
  linkedin: Object.freeze({ reads: false, reports: [], why: 'LinkedIn reports post numbers only to partner apps (Community Management access); the house\'s tracked links count its clicks' }),
  telegram: Object.freeze({ reads: false, reports: [], why: 'a Telegram bot cannot read a channel post\'s views' }),
  discord: Object.freeze({ reads: false, reports: [], why: 'Discord reports no views; its reactions are not read' }),
});

// A count as a number, or undefined when the platform did not give one.
const n = (v) => {
  const x = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return Number.isFinite(x) && x >= 0 ? x : undefined;
};
const shaped = (pairs) => Object.fromEntries(Object.entries(pairs).filter(([, v]) => v !== undefined));

/** An X post (public_metrics, and non_public_metrics where X gave them). */
export const fromX = (tweet) => {
  const p = tweet?.public_metrics || {};
  const np = tweet?.non_public_metrics || {};
  return shaped({
    views: n(p.impression_count), likes: n(p.like_count), replies: n(p.reply_count), shares: n(p.retweet_count),
    quotes: n(p.quote_count), saves: n(p.bookmark_count), linkClicks: n(np.url_link_clicks), profileClicks: n(np.user_profile_clicks),
  });
};

/** A YouTube video's statistics (counts arrive as strings; a hidden like count is absent). */
export const fromYouTube = (item) => {
  const s = item?.statistics || {};
  return shaped({ views: n(s.viewCount), likes: n(s.likeCount), replies: n(s.commentCount) });
};

/** A TikTok video (video.query / video.list fields). */
export const fromTikTok = (video) => shaped({
  views: n(video?.view_count), likes: n(video?.like_count), replies: n(video?.comment_count), shares: n(video?.share_count),
});

/** A Mastodon status. */
export const fromMastodon = (status) => shaped({
  likes: n(status?.favourites_count), replies: n(status?.replies_count), shares: n(status?.reblogs_count),
});

/** A Bluesky post view. */
export const fromBluesky = (post) => shaped({
  likes: n(post?.likeCount), replies: n(post?.replyCount), shares: n(post?.repostCount), quotes: n(post?.quoteCount),
});

/** A Facebook Page post (reactions, comments, shares). */
export const fromFacebook = (post) => shaped({
  likes: n(post?.reactions?.summary?.total_count), replies: n(post?.comments?.summary?.total_count), shares: n(post?.shares?.count),
});
