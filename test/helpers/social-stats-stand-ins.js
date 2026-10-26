/**
 * LOCAL STAND-INS FOR THE STATS READS (campaign plan slice 9): one real HTTP
 * server on 127.0.0.1 answering in each platform's documented shape for the
 * read the stats sweep makes — and misbehaving the ways those platforms do:
 *   X        GET  /2/tweets?ids=&tweet.fields=          public_metrics (+ non_public_metrics)
 *            GET  /2/users/me                           who the keys speak as (`state.me`)
 *            modes: ok | slow (429 + x-rate-limit-reset) | plan (403, the plan does not allow it)
 *                   | private (non_public_metrics refused with 403; public still answers)
 *   YouTube  POST /token (refresh) · GET /youtube/v3/videos?part=statistics&id=
 *            modes: ok | quota (403 quotaExceeded) | scope (403 insufficientPermissions)
 *   Mastodon GET  /api/v1/statuses/:id
 *   Bluesky  GET  /xrpc/app.bsky.feed.getPosts?uris=
 * Counts are whatever `state.counts[postId]` holds. They are NOT the platforms:
 * whether the real ones answer is proven by scripts/stats-verify.mjs on the
 * owner's own accounts.
 */
import http from 'http';

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

/** @returns {Promise<{root: string, state: object, close: () => Promise<void>}>} */
export const startStatsStandIns = async () => {
  const state = { x: 'ok', youtube: 'ok', counts: {}, hits: [], me: { id: '101', username: 'northwind_x' } };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://stand-in');
    state.hits.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/2/users/me') return json(res, 200, { data: state.me });
    if (url.pathname === '/2/tweets') {
      const fields = url.searchParams.get('tweet.fields') || '';
      if (state.x === 'slow') return json(res, 429, { title: 'Too Many Requests' }, { 'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 600) });
      if (state.x === 'plan') return json(res, 403, { title: 'Client Forbidden', detail: 'This endpoint is not included in your plan' });
      if (state.x === 'private' && fields.includes('non_public_metrics')) return json(res, 403, { title: 'Forbidden' });
      const ids = (url.searchParams.get('ids') || '').split(',');
      const data = ids.filter((id) => state.counts[id]).map((id) => {
        const c = state.counts[id];
        return {
          id,
          public_metrics: { impression_count: c.views, like_count: c.likes, reply_count: c.replies, retweet_count: c.shares, quote_count: c.quotes, bookmark_count: c.saves },
          ...(fields.includes('non_public_metrics') ? { non_public_metrics: { url_link_clicks: c.linkClicks, user_profile_clicks: c.profileClicks } } : {}),
        };
      });
      return json(res, 200, { data });
    }
    if (url.pathname === '/token' && req.method === 'POST') return json(res, 200, { access_token: 'ph-google-access', expires_in: 3599, token_type: 'Bearer' });
    if (url.pathname === '/youtube/v3/videos') {
      if (state.youtube === 'quota') return json(res, 403, { error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } });
      if (state.youtube === 'scope') return json(res, 403, { error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } });
      const ids = (url.searchParams.get('id') || '').split(',');
      const items = ids.filter((id) => state.counts[id]).map((id) => {
        const c = state.counts[id];
        // A channel that hides its likes has no likeCount at all.
        return { id, statistics: { viewCount: String(c.views), ...(c.likes === undefined ? {} : { likeCount: String(c.likes) }), commentCount: String(c.replies) } };
      });
      return json(res, 200, { items });
    }
    const status = /^\/api\/v1\/statuses\/([^/]+)$/.exec(url.pathname);
    if (status) {
      const c = state.counts[status[1]];
      return c ? json(res, 200, { id: status[1], favourites_count: c.likes, reblogs_count: c.shares, replies_count: c.replies }) : json(res, 404, { error: 'Record not found' });
    }
    if (url.pathname === '/xrpc/app.bsky.feed.getPosts') {
      const posts = url.searchParams.getAll('uris').filter((u) => state.counts[u]).map((uri) => {
        const c = state.counts[uri];
        return { uri, likeCount: c.likes, repostCount: c.shares, replyCount: c.replies, quoteCount: c.quotes };
      });
      return json(res, 200, { posts });
    }
    return json(res, 404, { error: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { root: `http://127.0.0.1:${server.address().port}`, state, close: () => new Promise((r) => server.close(r)) };
};
