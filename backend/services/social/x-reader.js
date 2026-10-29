// x-reader.js — read from the house's X account through the official v2 API:
// who the account is, who is speaking to it, and what it has said.
//
// Read is RESEARCH, not speech — the no-auto-engagement doctrine stands: this
// lane observes the field and feeds the marketing team; it never replies,
// likes, or follows. What it surfaces is for the CMO's office to work.
//
// Same signing core as the poster (uniform-architecture law: one OAuth 1.0a
// path, proven in scripts/x-post-verify.mjs, trusted everywhere) and the same
// credential door as posting — the HOUSE's own keys for ONE of its X
// accounts (resolveAccountCredential(wallet, accountId), store > env; the
// house's first X account when no account is named). Every read names the
// house it reads for; a read with no house has no keys.
// Never throws: every failure returns {ok:false, detail} so the consciousness
// reads a real outcome, and the operator's barge-in signal cuts an in-flight
// read off.

import crypto from 'crypto';
import { buildOAuth1Header } from './x-poster.js';
import { resolveAccountCredential } from './account-store.js';
import { firstAccountId } from './account-shape.js';

// impure — the keys one X account of the house reads with (the first when unnamed).
const xKeys = (wallet, accountId) => resolveAccountCredential(wallet, accountId || firstAccountId('x')).catch(() => null);
import { frameUntrustedSections } from '../untrusted-content.js';

// The API root rides an env override read PER CALL — same doctrine as the
// social store paths: a test points the REAL signed-read code at a real
// loopback X-shaped server (RULE 0), and production never sets it.
const apiRoot = () => process.env.NEUMA_X_API_ROOT || 'https://api.x.com/2';
const meEndpoint = () => `${apiRoot()}/users/me`;

// X paginates user timelines in [5, 100] — the tool schema caps the ask at
// 25; this clamp only keeps a direct call inside the API's own bounds.
const clampResults = (limit) => Math.min(100, Math.max(5, Math.floor(limit) || 10));

// impure — one signed GET. Query params ride the signature per OAuth 1.0a.
// Never throws.
const _xGet = async (credentials, url, params, { signal } = {}) => {
  const header = buildOAuth1Header(credentials, {
    method: 'GET',
    url,
    params,
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: crypto.randomBytes(16).toString('hex'),
  });
  const query = new URLSearchParams(params).toString();
  try {
    const res = await fetch(query ? `${url}?${query}` : url, {
      headers: { Authorization: header },
      signal,
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: body };
    const detail = body?.detail || body?.errors?.[0]?.message || body?.title || `HTTP ${res.status}`;
    return { ok: false, status: res.status, detail };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, detail: 'interrupted by your operator mid-read' };
    }
    return { ok: false, detail: err.message };
  }
};

/**
 * Does one post still stand on X? The send-time re-check for a staged
 * reply: a target that vanished between approval and send fails the send
 * honestly — a reply never falls back to being a bare post. Never throws.
 * @param {string} postId
 * @param {{signal?: AbortSignal, wallet: string, accountId?: string}} opts - wallet: the house whose keys read; accountId: which of its X accounts
 * @returns {Promise<{ok: true, data: object}|{ok: false, status?: number, detail: string}>}
 */
// impure — disk (credential store) + network + clock + entropy
export const readXPost = async (postId, { signal, wallet, accountId } = {}) => {
  const credentials = await xKeys(wallet, accountId);
  if (!credentials) return { ok: false, detail: 'X credentials are not configured' };
  const res = await _xGet(credentials, `${apiRoot()}/tweets/${encodeURIComponent(String(postId))}`, { 'tweet.fields': 'author_id' }, { signal });
  if (!res.ok) return res;
  const tweet = res.data?.data;
  if (!tweet?.id) return { ok: false, detail: 'the post lookup returned nothing' };
  return { ok: true, data: tweet };
};

/**
 * A post's id from what an operator or a being has to hand: the numeric id, or the post's own
 * x.com / twitter.com link. Pure.
 * @param {unknown} input
 * @returns {string} the numeric id, or '' when there is none
 */
export const postIdFrom = (input) => {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (/^\d{1,40}$/.test(raw)) return raw;
  const m = raw.match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d{1,40})(?:[/?#].*)?$/i);
  return m ? m[1] : '';
};

/**
 * The reply linkage for a post, from X's own answer — never from anyone's say-so. Pure.
 * @param {object} body - the GET /2/tweets/:id response (author expanded)
 * @returns {?{postId: string, authorId: string, username: string, verifiedType: string,
 *   text: string, conversationId: ?string}}
 */
export const replyTargetFrom = (body) => {
  const tweet = body?.data;
  if (!tweet?.id || !tweet?.author_id) return null;
  const author = (body?.includes?.users || []).find((u) => String(u?.id) === String(tweet.author_id)) || {};
  return {
    postId: String(tweet.id),
    authorId: String(tweet.author_id),
    username: String(author.username || ''),
    verifiedType: String(author.verified_type || 'none'),
    text: String(tweet.text || ''),
    conversationId: tweet.conversation_id ? String(tweet.conversation_id) : null,
  };
};

/**
 * Any public post, read live for an answer to it (Design note, 2026-10-12: […]): who wrote it and what it says, from X itself.
 * Never throws.
 * @param {string} postId
 * @param {{signal?: AbortSignal, wallet: string, accountId?: string}} opts - wallet: the house whose keys read; accountId: which of its X accounts
 * @returns {Promise<{ok: true, target: object}|{ok: false, status?: number, detail: string}>}
 */
// impure — disk (credential store) + network
export const readXReplyTarget = async (postId, { signal, wallet, accountId } = {}) => {
  const credentials = await xKeys(wallet, accountId);
  if (!credentials) return { ok: false, detail: 'X credentials are not configured' };
  const res = await _xGet(credentials, `${apiRoot()}/tweets/${encodeURIComponent(String(postId))}`, {
    'tweet.fields': 'author_id,conversation_id', expansions: 'author_id', 'user.fields': 'username,verified_type',
  }, { signal });
  if (!res.ok) return res;
  const target = replyTargetFrom(res.data);
  return target ? { ok: true, target } : { ok: false, detail: 'X did not return that post with its author' };
};

/**
 * Who does the house speak as on X? The me-read is also the credential
 * proof — a working lane answers with the account, a broken one with the
 * honest reason. Never throws.
 * @param {{signal?: AbortSignal, wallet: string, accountId?: string}} opts - wallet: the house whose keys read; accountId: which of its X accounts
 * @returns {Promise<{ok: true, data: object}|{ok: false, status?: number, detail: string}>}
 */
// impure — disk (credential store) + network + clock + entropy
export const readXMe = async ({ signal, wallet, accountId } = {}) => {
  const credentials = await xKeys(wallet, accountId);
  if (!credentials) return { ok: false, detail: 'X credentials are not configured' };
  const res = await _xGet(credentials, meEndpoint(), {}, { signal });
  if (!res.ok) return res;
  return { ok: true, data: res.data?.data || null };
};

// The account the house's X lane speaks AS, cached — the board and the
// scheduler both want it, and /2/users/me is not free (Design note, 2026-07-28:
// […]). Five
// minutes of trust; a key rotation is rarer than that and surfaces at the
// next read. Null means unconfigured or unanswered — never invented. One
// entry per house account: each account speaks as itself.
const accountCache = new Map(); // `${wallet}|${accountId}` -> { at, account: {id, username}|null }
// impure — cached disk + network
export const readXAccount = async ({ ttlMs = 5 * 60 * 1000, wallet, accountId = firstAccountId('x') } = {}) => {
  const key = `${String(wallet || '').toLowerCase()}|${accountId}`;
  const cached = accountCache.get(key);
  if (cached && Date.now() - cached.at < ttlMs) return cached.account;
  const me = await readXMe({ wallet, accountId });
  const account = me.ok && me.data?.id
    ? { id: String(me.data.id), username: String(me.data.username || '') }
    : null;
  accountCache.set(key, { at: Date.now(), account });
  return account;
};

/**
 * Read the house's X lane: `mentions` (who is speaking to the house) or
 * `recent` (what the house has said). Two-step by API shape — the me-read
 * yields the account id the listing endpoints hang off. Never throws.
 * @param {{kind: 'mentions'|'recent', limit?: number, signal?: AbortSignal, wallet: string, accountId?: string}} opts - accountId: which of the house's X accounts (its first when unnamed)
 * @returns {Promise<{ok: true, data: {tweets: Array, users: Array}}
 *   |{ok: false, status?: number, detail: string}>}
 */
// impure — disk (credential store) + network + clock + entropy
export const readXListings = async ({ kind, limit = 10, signal, wallet, accountId } = {}) => {
  const credentials = await xKeys(wallet, accountId);
  if (!credentials) return { ok: false, detail: 'X credentials are not configured' };
  const me = await _xGet(credentials, meEndpoint(), {}, { signal });
  if (!me.ok) return me;
  const id = me.data?.data?.id;
  if (!id) return { ok: false, detail: 'the account lookup returned no id' };
  // Mentions ask for the fields the reply lane READS: referenced_tweets +
  // in_reply_to_user_id recognise […], and
  // verified_type recognises who may be answered (x-reader.js:86-99 was
  // blind to both until the reply lane grew eyes).
  const params = kind === 'mentions'
    ? {
      max_results: String(clampResults(limit)),
      'tweet.fields': 'created_at,author_id,conversation_id,referenced_tweets,in_reply_to_user_id',
      expansions: 'author_id',
      'user.fields': 'username,verified,verified_type',
    }
    : {
      max_results: String(clampResults(limit)),
      'tweet.fields': 'created_at',
    };
  const res = await _xGet(credentials, `${apiRoot()}/users/${id}/${kind === 'mentions' ? 'mentions' : 'tweets'}`, params, { signal });
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      tweets: res.data?.data || [],
      users: res.data?.includes?.users || [],
      // The account the listing hung off — the reply lane filters
      // replied-to-us against this id without a second me-read.
      me: me.data?.data || null,
    },
  };
};

// The verification badges the house recognises. Design note, 2026-07-28 (second
// call): verification is a DISPLAYED risk signal, never a gate — the lane
// answers anyone, and the standing rides beside their words so the being
// and the operator see who they are talking to. A legacy `verified` tick
// counts as blue — X folded it into the same standing when verified_type
// arrived.
const VERIFIED_TYPES = Object.freeze(['blue', 'business', 'government']);

/**
 * Is this author verified in a standing the house recognises? (pure)
 * @param {{verified?: boolean, verified_type?: string}|null|undefined} user
 */
export const isVerifiedAuthor = (user) =>
  VERIFIED_TYPES.includes(user?.verified_type) || user?.verified === true;

/**
 * The author's verification standing as one honest word (pure): blue,
 * business, government — or 'none'. Displayed, never gated.
 * @param {{verified?: boolean, verified_type?: string}|null|undefined} user
 */
export const verifiedStanding = (user) => {
  if (user?.verified_type && VERIFIED_TYPES.includes(user.verified_type)) return user.verified_type;
  if (user?.verified === true) return 'blue';
  return 'none';
};

/**
 * Is this mention a reply to one of the house's OWN posts? (pure) Both
 * halves are required: `replied_to` says the post IS a reply,
 * `in_reply_to_user_id` says the reply is to US — an @mention alone is
 * neither, and a reply to someone else that names us is not ours to answer.
 * @param {object} mention one tweet from the mentions read
 * @param {string|number} myId the house account's id
 */
export const isReplyToUs = (mention, myId) =>
  Array.isArray(mention?.referenced_tweets)
  && mention.referenced_tweets.some((r) => r?.type === 'replied_to')
  && String(mention?.in_reply_to_user_id ?? '') === String(myId ?? '');

// The FULL text, generously bounded: a being answering a reply must read
// what was actually said, not a 120-char snippet (Kagipem's live audit,
// 2026-07-28: […]). The bound
// only keeps a pasted essay from eating a whole turn.
const X_TEXT_BOUND = 1000;

// pure — one post's IDENTIFIERS, the trusted metadata line that rides
// OUTSIDE the frame: these come from the API envelope (ids, timestamps, the
// expansion block), never from the author's keyboard, so they may stand at
// the instrument's altitude. The author's TEXT may not.
// The house's own copy, on one line — ours, so it stands outside the frame like
// every queue read does.
const _copyLine = (text) => String(text || '').replace(/\s+/g, ' ').trim();

const _postMetaLine = (t, user, {
  housePostIds = null, dispositions = null, answers = null, queueIds = null,
} = {}) => {
  const postId = String(t?.id || '');
  const parent = (t?.referenced_tweets || []).find((r) => r?.type === 'replied_to')?.id || null;
  const bits = [
    `post ${postId || 'unknown'}`,
    user?.username ? `@${user.username}` : null,
    t?.author_id ? `author ${t.author_id}` : null,
    user ? `verified ${verifiedStanding(user)}` : null,
    t?.created_at || 'no-time',
    `https://x.com/i/status/${postId}`,
    // The house's own post, linked to the queue entry it went out as — so the being
    // reads its record with queue_get instead of hunting for it.
    queueIds?.[postId] ? `queue entry ${queueIds[postId]}` : null,
    t?.conversation_id ? `conversation ${t.conversation_id}` : null,
    parent ? `answering post ${parent}${housePostIds?.has(String(parent)) ? ' — a HOUSE post' : ''}` : null,
    dispositions && postId ? `disposition: ${dispositions[postId] || 'none'}` : null,
    // The house's answer to this post, by its queue id and in its own words —
    // "staged" alone sent a being in circles looking for what it had said.
    ...(answers?.[postId] || []).map((a) => `the house's answer [${a.id}] ${a.status}: "${_copyLine(a.text)}"`),
  ];
  return bits.filter(Boolean).join(' · ');
};

/**
 * Render an X read for a being's context window: per post, a TRUSTED
 * metadata line outside the frame (ids, handle, verification standing,
 * linkage, the reply's current disposition) and the author's FULL text
 * inside it — capped so a busy lane never floods a turn.
 *
 * THE FRAME. A mention's text is attacker-AUTHORED, and until the reply lane
 * grew eyes it reached the being RAW — at the same altitude as the operator's
 * own voice, a live injection hole from the day read_x shipped. Every word
 * the author wrote still rides inside the untrusted frame (the same doctrine
 * as web search rows, web-being-tools.js:108-117). What changed for the
 * reply lane (2026-07-28): the identifiers the being must NAME a target with
 * — postId, canonical URL, author, conversation, parent, disposition — are
 * the API's envelope, not the author's text, so they stand OUTSIDE the frame
 * where the being can act on them; the header (the count, the retrieval
 * instant) is likewise ours. Verbatim inside, never stripped: an operator
 * checking a source needs to see what actually arrived.
 *
 * THE WINDOW (2026-08-28). The frame is paid ONCE for the whole read rather
 * than once per post, the being's `max` is honored against what the API's
 * five-post floor actually returned, and an over-budget listing sheds whole
 * posts from the OLDEST end rather than being folded mid-post by the portal's
 * compressor. Every one of those three is reported in the text: the header
 * says N of M, and a tail line names each reason a post is missing.
 * Pure given `token`; impure by default, as the frame is.
 *
 * @param {'mentions'|'recent'} what
 * @param {object} data — the reader's payload for that read
 * @param {{max?: number, budget?: number|null, retrievedAt?: string|null,
 *   token?: string, housePostIds?: Set<string>|null,
 *   dispositions?: Object<string, string>|null,
 *   answers?: Object<string, Array<{id: string, status: string, text: string}>>|null,
 *   queueIds?: Object<string, string>|null}} [opts]
 *   max is the being's ask; budget is the caller's char window (the tool-result
 *   cap, less what the exchange's own wrapper spends) — omitted, nothing is
 *   held back. housePostIds/dispositions annotate mentions (house linkage,
 *   reply standing); answers names the house's own answer to a mention (queue id,
 *   standing, copy) and queueIds the queue entry each house post went out as. All
 *   are computed by the caller from the real stores.
 * @returns {{text: string, shown: number, fetched: number}} shown is what the
 *   being actually RECEIVED — the journal and the chip count that, never the
 *   fetch.
 */
export const renderXListing = (what, data, {
  max = 10, budget = null, retrievedAt = null, token, housePostIds = null, dispositions = null,
  answers = null, queueIds = null,
} = {}) => {
  const tweets = data?.tweets || [];
  const heading = what === 'mentions' ? 'speaking to the house' : 'from the house account';
  const stamp = retrievedAt ? `, retrieved ${retrievedAt}` : '';
  if (!tweets.length) {
    return { text: `Nothing ${heading} right now${stamp}.`, shown: 0, fetched: 0 };
  }
  const userById = Object.fromEntries((data?.users || []).map((u) => [u.id, u]));

  // THE ASK IS HONORED HERE. X pages a timeline in fives (clampResults), so a
  // being asking for 3 is handed 5 by the API — and until 2026-08-28 all five
  // reached the window, because the caller never passed the ask down and this
  // renderer fell back to its own default of 10.
  const asked = Math.max(1, Math.min(Math.floor(max) || 10, tweets.length));
  const beyondAsk = tweets.length - asked;
  const source = what === 'mentions'
    ? 'posts mentioning the house on X, returned by the X API'
    : 'the house account\'s own posts on X, returned by the X API';
  const sections = tweets.slice(0, asked).map((t) => {
    const raw = String(t?.text || '');
    return {
      lead: _postMetaLine(t, userById[t.author_id] || null, { housePostIds, dispositions, answers, queueIds }),
      text: raw.length > X_TEXT_BOUND ? `${raw.slice(0, X_TEXT_BOUND)} …[truncated]` : raw,
    };
  });

  const draw = (n) => {
    const heldBack = asked - n;
    return [
      n === tweets.length
        ? `${n} post(s) ${heading}${stamp}:`
        : `${n} of ${tweets.length} post(s) ${heading}${stamp}:`,
      frameUntrustedSections(source, sections.slice(0, n), token),
      ...(beyondAsk > 0
        ? [`…and ${beyondAsk} more the API returned past your ask of ${asked} — X pages a timeline in fives, so a smaller ask still fetches five.`]
        : []),
      ...(heldBack > 0
        ? [`…and ${heldBack} older post(s) held back so this read fits your window WHOLE — the newest are above, and nothing here is a fragment.`]
        : []),
    ].join('\n\n');
  };

  // THE CUT IS AT THE TAIL, IN WHOLE POSTS. Over the tool-result cap the
  // portal's compressor folds the middle out of a result and stamps the gap
  // (`[… N chars omitted @ offset M]`) — right for a file read, wrong for a
  // listing, where it strands half a post with no way to tell which half is
  // missing. So the listing fits ITSELF: drop the oldest posts (X returns
  // newest-first) until the whole thing is inside the window. One post always
  // survives — a read that hands back nothing is worse than a read that is
  // honestly compressed downstream.
  let shown = asked;
  if (Number.isFinite(budget) && budget > 0) {
    while (shown > 1 && draw(shown).length > budget) shown -= 1;
  }
  return { text: draw(shown), shown, fetched: tweets.length };
};

/**
 * The listing as one string — `renderXListing`'s text, for callers that do not
 * need the counts (the live verification script, the tests). Same signature as
 * it always had.
 */
export const formatXReadForBeing = (what, data, opts = {}) => {
  if (what === 'me') {
    if (!data) return 'The account lookup returned nothing.';
    return `The house speaks on X as @${data.username} (${data.name}).`;
  }
  return renderXListing(what, data, opts).text;
};
