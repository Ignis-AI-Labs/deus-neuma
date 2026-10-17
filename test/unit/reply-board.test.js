// reply-board — the REPLIES section's one strip (Design note, 2026-10-13: […]). Pure: real inputs, real outputs.

import { describe, it, expect } from 'vitest';
import {
  REPLY_BUCKET_LANE, REPLY_BUCKET_NOTE, awaitingReplies, openingBucket, replyBucketTotals, selectReplyAnswers,
} from '../../frontend/app/RelinkShell/reply-board.js';
import { REPLY_BUCKETS } from '../../core/social/reply-inbox.js';

const at = (min) => new Date(Date.UTC(2026, 9, 13, 0, min)).toISOString();
const answer = (id, status, extra = {}) => ({
  id, status, kind: 'reply', text: `answer ${id}`, createdAt: at(1),
  reply: { toPostId: `k-${id}`, toUsername: `user${id}`, toTextPreview: `knock ${id}` }, ...extra,
});

describe('the strip — one bucket per question, each said once', () => {
  it('every bucket the being reads has a note, and the answer lanes are the queue\'s own', () => {
    for (const b of REPLY_BUCKETS) expect(REPLY_BUCKET_NOTE[b]).toBeTruthy();
    expect(REPLY_BUCKET_LANE).toEqual({ staged: 'queued', answered: 'sent', bin: 'withdrawn' });
  });

  it('STAGED says the approval law out loud: approval sends immediately', () => {
    expect(REPLY_BUCKET_NOTE.staged).toMatch(/APPROVE & SEND/);
    expect(REPLY_BUCKET_NOTE.staged).toMatch(/immediately/i);
    expect(REPLY_BUCKET_NOTE.staged).toMatch(/no schedule/i);
  });

  it('counts each bucket by the rows it shows — the bin holds set-aside knocks AND pulled answers', () => {
    const lanes = { queued: [answer('1', 'draft')], sent: [answer('2', 'sent'), answer('3', 'failed')], withdrawn: [answer('4', 'rejected')] };
    expect(replyBucketTotals(lanes, { unanswered: 7, bin: 2 })).toEqual({ unanswered: 7, staged: 1, answered: 2, bin: 3 });
    expect(replyBucketTotals(null, null)).toEqual({ unanswered: 0, staged: 0, answered: 0, bin: 0 });
  });
});

describe('where the strip opens', () => {
  it('opens on STAGED while a real draft is owed, else on UNANSWERED', () => {
    expect(openingBucket({ queued: [answer('1', 'draft')] })).toBe('staged');
    // In flight is decided; a placeholder holds a slot, not words — neither is owed.
    expect(openingBucket({ queued: [answer('1', 'approved'), answer('2', 'draft', { placeholder: true })] })).toBe('unanswered');
    expect(awaitingReplies({ queued: [answer('1', 'draft'), answer('2', 'sending')] }).map((e) => e.id)).toEqual(['1']);
  });
});

describe('selectReplyAnswers — the same search and order the knocks get', () => {
  const pile = [
    answer('a', 'sent', { sentAt: at(30), text: 'Liquidity follows volume.' }),
    answer('b', 'sent', { sentAt: at(10) }),
    answer('c', 'draft', { createdAt: at(20) }),
  ];

  it('newest first by when the answer last moved, oldest on ask', () => {
    expect(selectReplyAnswers(pile).map((e) => e.id)).toEqual(['a', 'c', 'b']);
    expect(selectReplyAnswers(pile, { order: 'oldest' }).map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('matches the answer, the knock it answers, or the @handle — case-blind', () => {
    expect(selectReplyAnswers(pile, { q: 'LIQUIDITY' }).map((e) => e.id)).toEqual(['a']);
    expect(selectReplyAnswers(pile, { q: 'knock b' }).map((e) => e.id)).toEqual(['b']);
    expect(selectReplyAnswers(pile, { q: '@userc' }).map((e) => e.id)).toEqual(['c']);
    expect(selectReplyAnswers(pile, { q: 'nobody' })).toEqual([]);
  });

  it('never mutates the caller\'s lane and survives junk', () => {
    const before = pile.map((e) => e.id);
    selectReplyAnswers(pile, { order: 'oldest' });
    expect(pile.map((e) => e.id)).toEqual(before);
    expect(selectReplyAnswers(null)).toEqual([]);
  });
});
