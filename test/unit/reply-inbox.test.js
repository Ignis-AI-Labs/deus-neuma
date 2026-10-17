/**
 * THE REPLY INBOX (Design note, 2026-10-13: […]). One law for the desk and the being:
 * buckets, order, filters, paging — and the being's page fits its window in whole replies.
 */
import { describe, test, expect } from 'vitest';
import { selectReplyInbox, replyBucketCounts } from '../../core/social/reply-inbox.js';
import { renderReplyInbox } from '../../backend/services/portal-tools/reply-inbox-tool.js';

const r = (postId, minute, over = {}) => ({
  postId, username: `u${postId}`, text: `reply ${postId}`, disposition: 'none',
  substance: 'substantive', category: 'ordinary',
  postCreatedAt: `2026-10-12T10:${String(minute).padStart(2, '0')}:00Z`, ...over,
});

const inbox = [
  r('1', 1),
  r('2', 2, { disposition: 'staged', answers: [{ id: 'q2', status: 'draft', text: 'our words' }] }),
  r('3', 3, { disposition: 'sent' }),
  r('4', 4, { disposition: 'dismissed', dismissed: true, dismissedBy: 'Metidar', reason: 'bait' }),
  r('5', 5, { category: 'support', text: 'how do I add liquidity?' }),
  r('6', 6, { substance: 'low-effort', text: 'gm' }),
  r('7', 7, { disposition: 'approved' }),
];

describe('selectReplyInbox — what is owed, and what is done', () => {
  test('the default is the unanswered work, newest first, with every bucket counted', () => {
    const page = selectReplyInbox(inbox);
    expect(page.rows.map((x) => x.postId)).toEqual(['6', '5', '1']);
    expect(page.counts).toEqual({ unanswered: 3, staged: 2, answered: 1, bin: 1, total: 7 });
    expect(replyBucketCounts(inbox)).toEqual(page.counts);
  });

  test('each bucket holds its own; staged takes staged and approved answers', () => {
    const ids = (bucket) => selectReplyInbox(inbox, { bucket }).rows.map((x) => x.postId);
    expect(ids('staged')).toEqual(['7', '2']);
    expect(ids('answered')).toEqual(['3']);
    expect(ids('bin')).toEqual(['4']);
    expect(ids('all')).toHaveLength(7);
    expect(ids('unanswered,bin')).toEqual(['6', '5', '4', '1']);
  });

  test('oldest first walks from the start; filters narrow; paging is exact', () => {
    expect(selectReplyInbox(inbox, { order: 'oldest' }).rows.map((x) => x.postId)).toEqual(['1', '5', '6']);
    expect(selectReplyInbox(inbox, { category: 'support' }).rows.map((x) => x.postId)).toEqual(['5']);
    expect(selectReplyInbox(inbox, { substance: 'low-effort' }).rows.map((x) => x.postId)).toEqual(['6']);
    expect(selectReplyInbox(inbox, { q: 'LIQUIDITY' }).rows.map((x) => x.postId)).toEqual(['5']);
    expect(selectReplyInbox(inbox, { q: '@u1' }).rows.map((x) => x.postId)).toEqual(['1']);
    const second = selectReplyInbox(inbox, { limit: 2, offset: 2 });
    expect(second).toMatchObject({ matched: 3, offset: 2, limit: 2 });
    expect(second.rows.map((x) => x.postId)).toEqual(['1']);
  });

  test('a bad ask refuses with its reason — never an empty page that looks like an answer', () => {
    expect(selectReplyInbox(inbox, { bucket: 'trash' })).toEqual({ ok: false, error: expect.stringContaining('unknown bucket trash') });
    expect(selectReplyInbox(inbox, { order: 'random' }).ok).toBe(false);
    expect(selectReplyInbox(inbox, { substance: 'deep' }).ok).toBe(false);
    expect(selectReplyInbox(inbox, { category: 'spam' }, { categories: ['ordinary', 'support'] }).ok).toBe(false);
  });

  test('the page cap holds for the being and lifts for the desk', () => {
    const many = Array.from({ length: 150 }, (_, i) => r(String(1000 + i), i % 60));
    expect(selectReplyInbox(many, { limit: 500 }).rows).toHaveLength(100);
    expect(selectReplyInbox(many, { limit: 500 }, { maxLimit: Infinity }).rows).toHaveLength(150);
  });
});

describe('renderReplyInbox — the being\'s page', () => {
  const TOKEN = 'tok';

  test('the house\'s own record stands outside the frame; the author\'s words inside', () => {
    const { text, shown } = renderReplyInbox(selectReplyInbox(inbox, { bucket: 'all' }), { bucket: 'all' }, { token: TOKEN });
    expect(shown).toBe(7);
    const begin = text.indexOf(`--- BEGIN EXTERNAL CONTENT ${TOKEN} ---`);
    expect(text.startsWith('Reply inbox: 3 unanswered · 2 staged · 1 answered · 1 in the bin (7 in all).')).toBe(true);
    for (const bit of ['reply 7 · @u7', 'ANSWER APPROVED']) {
      expect(text.indexOf(bit)).toBeGreaterThan(-1);
      expect(text.indexOf(bit)).toBeLessThan(begin);
    }
    expect(text).toContain('the house\'s answer [q2] draft: "our words"');
    expect(text).toContain('IN THE BIN · set aside by Metidar (bait)');
    expect(text).toContain('NEEDS CARE: support');
    expect(text).toContain('That is all 7.');
  });

  test('a page that does not fit sheds whole replies and names the exact next call', () => {
    const long = Array.from({ length: 30 }, (_, i) => r(String(100 + i), i, { text: 'x'.repeat(400) }));
    const ask = { bucket: 'unanswered', q: 'x' };
    const { text, shown } = renderReplyInbox(selectReplyInbox(long, ask), ask, { token: TOKEN, budget: 3880 });
    expect(shown).toBeLessThan(20);
    expect(shown).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(3880);
    expect(text).toContain(`Next: replies_list {bucket:"unanswered", q:"x", offset:${shown}}`);
  });

  test('an empty bucket says so plainly', () => {
    const { text, shown } = renderReplyInbox(selectReplyInbox([r('1', 1)], { bucket: 'bin' }), {}, { token: TOKEN });
    expect(shown).toBe(0);
    expect(text).toContain('Nothing bin matches.');
  });
});
