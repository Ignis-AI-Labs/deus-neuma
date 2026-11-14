// The quote a queued X post carries (quote-post.js) and the link counter leaving it alone
// (link-codes.js planLinks). Pure functions on real values.
import { describe, expect, it } from 'vitest';
import { X_LINK_CHARS, isXPostLink, quoteFieldsOf, quoteOf, quoteRefusal } from '../../backend/services/social/quote-post.js';
import { planLinks } from '../../backend/services/marketing/link-codes.js';

describe('quoteOf', () => {
  it('reads an id or a post link on x.com or twitter.com, into the post id and an x.com link', () => {
    expect(quoteOf('1988776655443322110')).toEqual({ postId: '1988776655443322110', url: 'https://x.com/i/status/1988776655443322110' });
    expect(quoteOf('https://twitter.com/FameEX/status/1988776655443322110?s=20')).toEqual({ postId: '1988776655443322110', url: 'https://x.com/FameEX/status/1988776655443322110' });
    expect(quoteOf('https://x.com/i/web/status/42')).toEqual({ postId: '42', url: 'https://x.com/i/status/42' });
    for (const no of ['', 'abc', 'https://example.com/a/status/1', 'http://x.com/a/status/1', 'https://x.com/a/likes', '12345678901234567890']) expect(quoteOf(no)).toBeNull();
  });
});

describe('quoteRefusal', () => {
  const q = quoteOf('https://x.com/a/status/1');
  it('X only, never with a reply, the link counted as 23 characters', () => {
    expect(quoteRefusal({ channelId: 'x', text: 'hi' })).toBeNull();
    expect(quoteRefusal({ channelId: 'x', text: 'hi', quote: q })).toBeNull();
    expect(quoteRefusal({ channelId: 'bluesky', text: 'hi', quote: q })).toMatch(/X only/);
    expect(quoteRefusal({ channelId: 'x', text: 'hi', kind: 'reply', quote: q })).toMatch(/cannot also quote/);
    expect(quoteRefusal({ channelId: 'x', text: 'a'.repeat(280 - X_LINK_CHARS - 1), quote: q })).toBeNull();
    expect(quoteRefusal({ channelId: 'x', text: 'a'.repeat(280 - X_LINK_CHARS), quote: q })).toMatch(/281 characters/);
    expect(quoteRefusal({ channelId: 'x', text: 'hi', quote: { postId: '9', url: q.url } })).toMatch(/link or id/);
  });
  it('a queue entry keeps only the post id and link', () => {
    expect(quoteFieldsOf({ quote: { ...q, extra: 'x' } })).toEqual({ quote: { postId: '1', url: q.url } });
    expect(quoteFieldsOf({})).toEqual({});
  });
});

describe('the link counter', () => {
  const plan = (text, channelId) => planLinks(text, { channelId, base: 'https://deusneuma.ai', mint: () => 'abc123' });
  it('leaves an X post link in an X post as written, so X shows it as a quote', () => {
    expect(isXPostLink('https://x.com/fameex/status/1')).toBe(true);
    expect(plan('see https://x.com/fameex/status/1', 'x')).toEqual({ text: 'see https://x.com/fameex/status/1', links: [] });
    // other links still count, and on other channels an X post link counts like any link
    expect(plan('see https://x.com/fameex', 'x').links).toHaveLength(1);
    expect(plan('see https://x.com/fameex/status/1', 'linkedin').links).toHaveLength(1);
  });
});
