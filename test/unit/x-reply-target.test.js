// Any public post can be answered (Design note, 2026-10-12 — its id read from what an operator pastes,
// and its linkage taken from X's own answer. Pure.
import { describe, expect, it } from 'vitest';
import { postIdFrom, replyTargetFrom } from '../../backend/services/social/x-reader.js';

describe('postIdFrom', () => {
  it('takes the numeric id, or the post\'s own x.com / twitter.com link', () => {
    expect(postIdFrom('1834567890123456789')).toBe('1834567890123456789');
    expect(postIdFrom('https://x.com/someone/status/1834567890123456789')).toBe('1834567890123456789');
    expect(postIdFrom('https://twitter.com/someone/status/42?s=20&t=abc')).toBe('42');
    expect(postIdFrom('  https://mobile.twitter.com/a_b/statuses/77/photo/1  ')).toBe('77');
  });

  it('nothing else is an id', () => {
    for (const bad of ['', '   ', null, 42, 'https://evil.example/someone/status/1', 'https://x.com/someone', 'abc']) {
      expect(postIdFrom(bad)).toBe('');
    }
  });
});

describe('replyTargetFrom', () => {
  it('the author, their words and the conversation come from X\'s answer', () => {
    expect(replyTargetFrom({
      data: { id: '5', author_id: '77', conversation_id: '70', text: 'hello' },
      includes: { users: [{ id: '77', username: 'thinker', verified_type: 'blue' }] },
    })).toEqual({ postId: '5', authorId: '77', username: 'thinker', verifiedType: 'blue', text: 'hello', conversationId: '70' });
  });

  it('an answer without its author is no target', () => {
    expect(replyTargetFrom({ data: { id: '5' } })).toBeNull();
    expect(replyTargetFrom(null)).toBeNull();
  });
});
