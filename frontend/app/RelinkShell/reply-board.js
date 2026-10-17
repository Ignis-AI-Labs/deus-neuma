// reply-board — the REPLIES section's one strip, as data (pure).
//
// Design note, 2026-10-13: […] The desk once stacked two strips here — the
// answers' own standing (QUEUED/SENT/WITHDRAWN) above the knocks' inbox — saying the same
// thing twice. One strip now: the being's own buckets (core/social/reply-inbox.js), each
// meaning one thing for both halves of the record:
//
//   unanswered — the knocks nobody has answered or set aside
//   staged     — the house's answers that have not gone out (queued lane)
//   answered   — the answers that went out, and any that tried and failed (sent lane)
//   bin        — knocks set aside, and answers pulled back or declined (withdrawn lane)

/** Each bucket's outbound lane; UNANSWERED holds knocks only. */
export const REPLY_BUCKET_LANE = Object.freeze({ staged: 'queued', answered: 'sent', bin: 'withdrawn' });

/** One line per bucket — what is in it, said once. */
export const REPLY_BUCKET_NOTE = Object.freeze({
  unanswered: 'People who replied to the house and have no answer yet.',
  staged: 'The house\'s answers, waiting on you. APPROVE & SEND fires immediately — a reply rides no schedule, and a sent answer cannot be recalled.',
  answered: 'Answers that went out — any that tried and did not send stand first. This history is permanent.',
  bin: 'Replies the house chose not to engage, and answers pulled back or declined. RESTORE brings a reply back to UNANSWERED.',
});

/** When an answer last moved: sent, else decided, else staged; 0 when unknown. */
const replyAnswerTime = (e) => Date.parse(e?.sentAt || e?.decidedAt || e?.createdAt || '') || 0;

/**
 * The answers in one lane, searched and ordered the same way the knocks are: the words
 * match the answer itself, the knock it answers, or the @handle it answers.
 * @param {Array<object>} entries - queue entries of kind 'reply'
 * @param {{ q?: string, order?: 'newest'|'oldest' }} [ask]
 * @returns {Array<object>} a new array; the input is never mutated
 */
export const selectReplyAnswers = (entries, { q = '', order = 'newest' } = {}) => {
  const needle = String(q).trim().toLowerCase();
  const sign = order === 'oldest' ? 1 : -1;
  return (entries || [])
    .filter((e) => !needle || `${e?.text || ''} ${e?.reply?.toTextPreview || ''} @${e?.reply?.toUsername || ''}`
      .toLowerCase().includes(needle))
    .sort((a, b) => sign * (replyAnswerTime(a) - replyAnswerTime(b))
      || String(a?.id || '').localeCompare(String(b?.id || '')));
};

/**
 * How much stands in each bucket — the same rows each bucket shows.
 * @param {{queued: Array, sent: Array, withdrawn: Array}} lanes - the replies section's lanes
 * @param {{unanswered: number, bin: number}} inboxCounts - from selectReplyInbox
 */
export const replyBucketTotals = (lanes, inboxCounts) => ({
  unanswered: inboxCounts?.unanswered || 0,
  staged: lanes?.queued?.length || 0,
  answered: lanes?.sent?.length || 0,
  bin: (inboxCounts?.bin || 0) + (lanes?.withdrawn?.length || 0),
});

/** The answers owed a decision — drafts with real copy (a placeholder holds a slot, not words). */
export const awaitingReplies = (lanes) => (lanes?.queued || [])
  .filter((e) => e?.status === 'draft' && e?.placeholder !== true);

/** Where the strip opens: on the decisions when any are owed, else on the work. */
export const openingBucket = (lanes) => (awaitingReplies(lanes).length ? 'staged' : 'unanswered');
