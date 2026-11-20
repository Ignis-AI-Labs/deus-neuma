// ReplyTierMark — why a waiting reply is the operator's to decide (Founder
// 2026-11-11, reply tiers): the AWARENESS reasons the backend's tier read
// put on it (marketing/mandate/reply-tier.js) as one chip, the words that
// set each reason off on hover. Silent for an easy reply — the ordinary case
// is never marked.

const MARKS = Object.freeze({
  raised: 'ASKED FOR YOU', money: 'MONEY', migration: 'MIGRATION', promise: 'PROMISE', claim: 'CLAIM',
});

/**
 * The chip's marks and its hover words, or null when nothing waits. Pure.
 * @param {?{tier: string, reasons: Array<{kind: string, words: string[]}>}} tier
 * @returns {?{marks: string, title: string}}
 */
export const tierMarks = (tier) => {
  if (tier?.tier !== 'awareness' || !tier.reasons?.length) return null;
  const markOf = (r) => (r.kind === 'category' ? String(r.words[0] || '').toUpperCase() : MARKS[r.kind] || r.kind.toUpperCase());
  return {
    marks: tier.reasons.map(markOf).join(' · '),
    title: tier.reasons.map((r) => (r.words.length ? `${markOf(r)}: ${r.words.join(', ')}` : markOf(r))).join('\n'),
  };
};

/** @param {{tier: ?object}} props */
export const ReplyTierMark = ({ tier }) => {
  const shown = tierMarks(tier);
  if (!shown) return null;
  return <span className="queue-preview-via is-alert" data-reply-tier="awareness" title={shown.title}>ASKS YOU · {shown.marks}</span>;
};
