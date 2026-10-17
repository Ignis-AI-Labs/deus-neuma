// reply-inbox — the replies to the house, sorted into what is owed and what is done.
//
// Design note, 2026-10-13: […] One law for both: the desk's REPLIES view and the being's replies_list
// read the same buckets, the same order and the same filters.
//
//   unanswered — nobody has answered or set it aside (the work)
//   staged     — an answer waits for the operator (staged or approved)
//   answered   — the house's answer went out
//   bin        — set aside; never knocks again, read only when someone looks back
//
// Pure.

export const REPLY_BUCKETS = Object.freeze(['unanswered', 'staged', 'answered', 'bin']);
export const REPLY_ORDERS = Object.freeze(['newest', 'oldest']);
export const REPLY_SUBSTANCES = Object.freeze(['substantive', 'low-effort']);
export const INBOX_PAGE = Object.freeze({ default: 20, max: 100 });

const BUCKET_OF = Object.freeze({
  none: 'unanswered', staged: 'staged', approved: 'staged', sent: 'answered', dismissed: 'bin',
});

/** The bucket a reply's disposition puts it in. */
export const replyBucketOf = (disposition) => BUCKET_OF[String(disposition || 'none')] || 'unanswered';

/** When the reply was written (else when the house first saw it), in ms; 0 when unknown. */
export const replyTime = (r) => Date.parse(r?.postCreatedAt || r?.firstSeenAt || '') || 0;

/**
 * How many replies sit in each bucket.
 * @param {Array<{disposition?: string}>} replies
 * @returns {{unanswered: number, staged: number, answered: number, bin: number, total: number}}
 */
export const replyBucketCounts = (replies) => {
  const counts = { unanswered: 0, staged: 0, answered: 0, bin: 0, total: 0 };
  for (const r of replies || []) {
    counts[replyBucketOf(r?.disposition)] += 1;
    counts.total += 1;
  }
  return counts;
};

const listOf = (raw) => (Array.isArray(raw) ? raw : [raw])
  .flatMap((v) => String(v ?? '').toLowerCase().split(','))
  .map((v) => v.trim())
  .filter(Boolean);

const whole = (v, fallback) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * One page of the inbox. A bad filter refuses with its reason — an empty page and an
 * unreadable ask must never look alike.
 * @param {Array<object>} replies - each carries `disposition` (and `category`, `substance`)
 * @param {{ bucket?: string|string[], order?: string, category?: string|string[],
 *   substance?: string, q?: string, offset?: number, limit?: number }} [ask]
 * @param {{ categories?: string[], maxLimit?: number }} [law] - the store's own category names,
 *   for validation; maxLimit lifts the page cap for a reader that pages by scrolling (the desk)
 * @returns {{ ok: true, counts: object, buckets: string[], order: string, matched: number,
 *   offset: number, limit: number, rows: Array<object> } | { ok: false, error: string }}
 */
export const selectReplyInbox = (replies, ask = {}, { categories = null, maxLimit = INBOX_PAGE.max } = {}) => {
  const named = listOf(ask.bucket);
  const buckets = !named.length ? ['unanswered'] : named.includes('all') ? [...REPLY_BUCKETS] : named;
  const unknownBucket = buckets.filter((b) => !REPLY_BUCKETS.includes(b));
  if (unknownBucket.length) {
    return { ok: false, error: `unknown bucket ${unknownBucket.join(', ')} — use ${[...REPLY_BUCKETS, 'all'].join(' | ')}` };
  }
  const order = String(ask.order || 'newest').toLowerCase();
  if (!REPLY_ORDERS.includes(order)) return { ok: false, error: `unknown order ${order} — use newest | oldest` };
  const cats = listOf(ask.category);
  const unknownCat = categories ? cats.filter((c) => !categories.includes(c)) : [];
  if (unknownCat.length) {
    return { ok: false, error: `unknown category ${unknownCat.join(', ')} — use ${categories.join(' | ')}` };
  }
  const substance = String(ask.substance || '').toLowerCase();
  if (substance && !REPLY_SUBSTANCES.includes(substance)) {
    return { ok: false, error: `unknown substance ${substance} — use substantive | low-effort` };
  }
  const q = String(ask.q || '').trim().toLowerCase();
  const offset = Math.max(0, whole(ask.offset, 0));
  const limit = Math.min(maxLimit, Math.max(1, whole(ask.limit, INBOX_PAGE.default)));

  const all = replies || [];
  const matching = all.filter((r) => buckets.includes(replyBucketOf(r?.disposition))
    && (!cats.length || cats.includes(String(r?.category || 'ordinary')))
    && (!substance || r?.substance === substance)
    && (!q || `${r?.text || ''} @${r?.username || ''}`.toLowerCase().includes(q)));
  const sign = order === 'newest' ? -1 : 1;
  const sorted = [...matching].sort((a, b) => sign * (replyTime(a) - replyTime(b))
    || sign * String(a?.postId || '').localeCompare(String(b?.postId || '')));
  return {
    ok: true,
    counts: replyBucketCounts(all),
    buckets,
    order,
    matched: sorted.length,
    offset,
    limit,
    rows: sorted.slice(offset, offset + limit),
  };
};
