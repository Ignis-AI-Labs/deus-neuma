// quote-post — a queued X post that quotes another post. Pure.
//
// X's own quote field (quote_tweet_id) is Enterprise-only since 2026-04-20, so a quote goes out the
// way X's own quote button builds one: the quoted post's link at the end of the words, which X shows
// as a quote. X counts any link as 23 characters, and bills a post with a link at its link rate.
// The link is added at send (x-poster.js), after the queue's link counting, so it is never turned
// into a counted /go/ link (which X could not show as a quote). X restricts quoting accounts that
// have not mentioned the house; the contract says so to the beings, and the operator approves each.

const STATUS_LINK = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(i\/web|i|[A-Za-z0-9_]{1,15})\/status\/(\d{1,19})(?:[/?#][^\s]*)?$/;

/** What X counts a link as, whatever its length. */
export const X_LINK_CHARS = 23;

/**
 * The post a draft quotes, from its id or its link on x.com or twitter.com, or null. Pure.
 * @param {unknown} value
 * @returns {?{postId: string, url: string}}
 */
export const quoteOf = (value) => {
  const v = typeof value === 'string' ? value.trim() : '';
  if (/^\d{1,19}$/.test(v)) return Object.freeze({ postId: v, url: `https://x.com/i/status/${v}` });
  const m = STATUS_LINK.exec(v);
  if (!m) return null;
  const who = m[1] === 'i/web' ? 'i' : m[1];
  return Object.freeze({ postId: m[2], url: `https://x.com/${who}/status/${m[2]}` });
};

/** Is this an X post's own link (a quote, never a counted link)? Pure. */
export const isXPostLink = (url) => STATUS_LINK.test(String(url || ''));

/**
 * Why a draft's quote cannot stand, or null. Pure.
 * @param {{channelId?: string, text?: string, kind?: string, quote?: unknown}} draft
 * @param {number} maxChars - the channel's ceiling
 */
export const quoteRefusal = ({ channelId, text, kind, quote } = {}, maxChars = 280) => {
  if (quote == null) return null;
  if (channelId !== 'x') return 'a quote post is for X only';
  const q = quoteOf(typeof quote === 'object' ? quote.url : quote);
  if (!q || (typeof quote === 'object' && String(quote.postId) !== q.postId)) return 'quote must be the quoted post\'s link or id';
  if (kind) return 'a reply or a thread follow-up cannot also quote a post';
  const length = String(text || '').trim().length + 1 + X_LINK_CHARS;
  return length > maxChars
    ? `the post with its quote is ${length} characters (the quoted link counts as ${X_LINK_CHARS}) — X allows at most ${maxChars}`
    : null;
};

/** The quote a queue entry keeps: its post id and link, copied only when set. Pure. */
export const quoteFieldsOf = (draft) => (draft?.quote
  ? { quote: { postId: String(draft.quote.postId), url: String(draft.quote.url) } }
  : {});
