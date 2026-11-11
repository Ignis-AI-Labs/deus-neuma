/**
 * THE REPLY TIERS (Design note, 2026-11-11 — the pure law, real inputs and real
 * outputs: easy answers go out under a mandate, awareness ones wait on the
 * operator with their reasons. Money on either side is awareness; a promise
 * is read on the answer alone; the claims check's open hits count and its
 * approved ones do not; the seat may raise an answer, never lower one. The
 * desk's chip is rendered for real (renderToStaticMarkup).
 */
import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { replyTier, tierWords, withReplyTier } from '../../backend/services/marketing/mandate/reply-tier.js';
import { claimHits } from '../../backend/services/marketing/claims-check.js';
import { tierMarks, ReplyTierMark } from '../../frontend/app/RelinkShell/ReplyTierMark.jsx';

const tierOf = (answering, text, extra = {}) => replyTier({ answering, text, hits: claimHits(text), ...extra });
const kinds = (t) => t.reasons.map((r) => r.kind);

describe('easy', () => {
  test('thanks, warm words and a plain answer go out on their own', () => {
    expect(tierOf('Thanks for sharing this information with us.', 'Appreciate you. That\'s the idea, keep it in the open.'))
      .toEqual({ tier: 'easy', reasons: [] });
    expect(tierOf('this moved me — thank you for building in the open', 'Thank you for reading it.').tier).toBe('easy');
    expect(tierOf('how do I connect my folder?', 'OPEN FOLDER in the desk, then pick it.', { category: 'support' }).tier).toBe('easy');
  });

  test('tokens per second is a speed, not money', () => {
    expect(tierOf('how fast is it?', 'About 120 tokens per second on one card.').reasons.map((r) => r.kind)).not.toContain('money');
  });
});

describe('awareness', () => {
  test('money on EITHER side waits — even when the answer is only a pointer', () => {
    const asked = tierOf('if a mint costs $100, one referral generates $10?', 'Good question — the docs have it.');
    expect(asked.tier).toBe('awareness');
    expect(asked.reasons).toEqual([{ kind: 'money', words: ['mint', '$100', 'referral', '$10'] }]);
    expect(kinds(tierOf('nice', 'The 10% referral share is live.'))).toEqual(['money', 'claim']);
    expect(tierOf('love it', 'Fees go to the LPs.').reasons[0]).toEqual({ kind: 'money', words: ['fees', 'lps'] });
  });

  test('a migration on either side waits', () => {
    expect(tierOf('when is the v2 migration?', 'Read the pinned post.').reasons[0]).toEqual({ kind: 'migration', words: ['v2', 'migration'] });
  });

  test('a promise is read on the answer alone', () => {
    expect(tierOf('will you add Solana pairs?', 'Good thought — noted.').tier).toBe('easy');
    expect(tierOf('any news?', 'We\'ll share more soon.').reasons).toEqual([{ kind: 'promise', words: ['we\'ll', 'soon'] }]);
    expect(tierOf('any news?', 'We’ll ship it next week.').reasons[0].words).toEqual(['we’ll', 'next week']);
    expect(tierOf('is it safe?', 'Your funds are safe.').reasons.map((r) => r.kind)).toContain('promise');
  });

  test('an argument, legal talk, a threat or a stranger\'s post waits, named in plain words', () => {
    expect(tierOf('overhyped', 'Fair. Try it and tell us.', { category: 'criticism' }).reasons).toEqual([{ kind: 'category', words: ['an argument'] }]);
    expect(tierOf('x', 'y', { category: 'outreach' }).reasons[0].words).toEqual(['a post that is not a reply to the house']);
    for (const category of ['threat', 'legal', 'financial', 'abuse']) expect(tierOf('x', 'y', { category }).tier).toBe('awareness');
  });

  test('the claims check counts its open hits, never the ones the kit approves', () => {
    const text = 'The fastest way in is the walkthrough.';
    expect(kinds(tierOf('video is easy to follow!', text))).toEqual(['claim']);
    const approved = claimHits(text, { approved: ['fastest'], forbidden: [] });
    expect(replyTier({ answering: 'video is easy to follow!', text, hits: approved }).tier).toBe('easy');
  });

  test('the seat may raise an answer itself', () => {
    expect(tierOf('great', 'Thank you.', { raised: true }).reasons).toEqual([{ kind: 'raised', words: [] }]);
  });

  test('why it waits, in one line', () => {
    const t = tierOf('what is the APR?', 'It will be in the docs.');
    expect(tierWords(t)).toBe('money (apr); a promise (it will)');
  });
});

describe('the desk', () => {
  const draft = { kind: 'reply', status: 'draft', text: 'The 10% is live.', reply: { toTextPreview: 'how much?', category: 'ordinary' } };

  test('a waiting reply carries its tier; anything else is untouched', () => {
    expect(withReplyTier({ ...draft, legal: { hits: claimHits(draft.text) } }).tier.reasons.map((r) => r.kind)).toEqual(['money', 'claim']);
    const sent = { ...draft, status: 'sent' };
    expect(withReplyTier(sent)).toBe(sent);
    const post = { kind: undefined, status: 'draft', text: 'hello' };
    expect(withReplyTier(post)).toBe(post);
  });

  test('the chip: ASKS YOU with its marks, each reason\'s words on hover; silent when easy', () => {
    const t = tierOf('so I get 10% forever?', 'We\'ll see.', { category: 'criticism' });
    expect(tierMarks(t)).toEqual({ marks: 'AN ARGUMENT · MONEY · PROMISE', title: 'AN ARGUMENT: an argument\nMONEY: 10%\nPROMISE: we\'ll' });
    const html = renderToStaticMarkup(createElement(ReplyTierMark, { tier: t }));
    expect(html).toContain('data-reply-tier="awareness"');
    expect(html).toContain('ASKS YOU · AN ARGUMENT · MONEY · PROMISE');
    expect(renderToStaticMarkup(createElement(ReplyTierMark, { tier: { tier: 'easy', reasons: [] } }))).toBe('');
    expect(renderToStaticMarkup(createElement(ReplyTierMark, { tier: undefined }))).toBe('');
  });
});
