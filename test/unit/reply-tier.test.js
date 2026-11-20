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
import { hostOfLink } from '../../backend/services/marketing/mandate/own-hosts.js';
import { tierMarks, ReplyTierMark } from '../../frontend/app/RelinkShell/ReplyTierMark.jsx';

const tierOf = (answering, text, extra = {}) => replyTier({ answering, text, hits: claimHits(text), ...extra });
const kinds = (t) => t.reasons.map((r) => r.kind);

describe('links and attachments (audit P6-71)', () => {
  test('a link in the answer waits, in every spelling; a plain sentence with dots does not', () => {
    for (const text of ['Start here: https://evil.example/claim', 'see www.evil.example', 'It is all at evil.example/claim', 'go to neuma-app.io']) {
      expect(kinds(tierOf('where do I start?', text)), text).toContain('link');
    }
    expect(tierOf('where do I start?', 'Start here: https://evil.example/claim').reasons).toEqual([{ kind: 'link', words: ['https://evil.example/claim'] }]);
    expect(tierOf('where do I start?', 'Open the desk. Then pick a folder... e.g. your notes, v0.1.2 works.').tier).toBe('easy');
    // The person's own link does not make a warm answer wait: only the house's words are sent.
    expect(tierOf('loved https://my.example/post', 'Thank you for reading it.').tier).toBe('easy');
  });

  test('a link to the house\'s own site goes; a look-alike, another scheme, a port or a login in the address still waits (default, 2026-11-19)', () => {
    const own = { ownHosts: ['tidewater.example'] };
    for (const text of ['The guide is at https://tidewater.example/docs.', 'see www.tidewater.example', 'It is all at docs.tidewater.example/start', 'go to Tidewater.example']) {
      expect(tierOf('where do I start?', text, own), text).toEqual({ tier: 'easy', reasons: [] });
    }
    for (const text of ['https://tidewater.example.evil.example/docs', 'https://tidewater.example@evil.example/docs', 'https://eviltidewater.example', 'ftp://tidewater.example/file',
      'https://tidewater.example:8443/x', 'https://tidewater.example\\@evil.example', 'https://tidewater.example/docs and https://evil.example/claim']) {
      expect(kinds(tierOf('where do I start?', text, own)), text).toEqual(['link']);
    }
    // A house that recorded no site has no own host: every link waits.
    expect(kinds(tierOf('where do I start?', 'https://tidewater.example/docs'))).toEqual(['link']);
    expect(hostOfLink('https://WWW.Tidewater.example/a')).toBe('tidewater.example');
    expect(hostOfLink('javascript://tidewater.example/%0aalert(1)')).toBeNull();
  });

  test('an attached file waits, and the desk draft reads its media too', () => {
    const t = tierOf('nice work', 'Thank you.', { media: 1 });
    expect(t).toEqual({ tier: 'awareness', reasons: [{ kind: 'media', words: ['1 attached'] }] });
    expect(tierWords(t)).toBe('an attachment (1 attached)');
    const draft = { kind: 'reply', status: 'draft', text: 'Thank you.', reply: { toTextPreview: 'nice work' }, media: [{ path: '/a.png', alt: '' }] };
    expect(kinds(withReplyTier(draft).tier)).toEqual(['media']);
    expect(tierMarks(withReplyTier(draft).tier).marks).toBe('MEDIA');
  });
});

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
