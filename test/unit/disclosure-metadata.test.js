/**
 * THE AI DISCLOSURE LIVES IN A POST'S METADATA, NEVER ITS WORDS (2026-10-30).
 *
 * The house never hides that its work is AI-made. It used to say so with "Made with AI." at the end
 * of every post on the platforms with no AI-label field, taking the reader's space every time; the
 * operator ruled it into the metadata. Proven over the real rules with real entries: a being's words
 * are kept exactly as written; an AI-made post's images say it in their alt text, once; a post staged
 * before the ruling loses the old line once and is marked, so words written afterwards are never
 * touched; what already went out stays the record of what went out. Nothing to fake (RULE 0).
 */
import { describe, test, expect } from 'vitest';
import {
  ALT_MARK, LEGACY_LINE, IN_METADATA, NATIVE_LABEL_CHANNELS, disclosed, markedMedia, carriesDisclosure,
} from '../../backend/services/social/disclosure-line.js';

const being = { channelId: 'x', status: 'draft', authorNeumaId: 'core-cmo', disclosure: IN_METADATA };

describe('a post\'s AI disclosure, in its metadata', () => {
  test('a being\'s words are kept exactly as written, line breaks and all', () => {
    const words = 'Pool creation is open to everyone.\n\nOur standards hold.';
    expect(disclosed({ ...being, text: words }).text).toBe(words);
  });

  test('an AI-made post\'s images open their alt text with the marker, once', () => {
    const post = { ...being, text: 'Tonight.', media: [{ path: '/c.png', alt: 'The card.' }, { path: '/d.png', alt: '' }] };
    const once = { ...post, media: markedMedia(post) };
    expect(once.media.map((m) => m.alt)).toEqual([`${ALT_MARK} The card.`, ALT_MARK]);
    expect(markedMedia(once)).toEqual(once.media);
    expect(carriesDisclosure(once)).toBe(true);
    // an image staged before the ruling keeps its card's alt text until an edit marks it; the check names it
    expect(carriesDisclosure(post)).toBe(false);
    expect(disclosed({ ...post, disclosure: undefined }).media).toEqual(post.media);
  });

  test('a post staged before the ruling loses the old line once, and is marked', () => {
    const legacy = { channelId: 'x', status: 'approved', authorNeumaId: 'core-cmo', text: `Pool creation is open.\n\n${LEGACY_LINE}` };
    const read = disclosed(legacy);
    expect(read.text).toBe('Pool creation is open.');
    expect(read.disclosure).toBe(IN_METADATA);
    // once marked, an operator who ends a post with those words keeps them
    const theirs = disclosed({ ...read, text: `We said it ourselves. ${LEGACY_LINE}` });
    expect(theirs.text).toBe(`We said it ourselves. ${LEGACY_LINE}`);
  });

  test('what already went out stays the record of what went out', () => {
    const sent = { channelId: 'x', status: 'sent', authorNeumaId: 'core-cmo', text: `Posted.\n\n${LEGACY_LINE}`, media: [{ path: '/c.png', alt: 'card' }] };
    expect(disclosed(sent)).toBe(sent);
    for (const status of ['rejected', 'withdrawn', 'sending']) {
      const entry = { ...sent, status };
      expect(disclosed(entry)).toBe(entry);
    }
  });

  test('the operator\'s own text-only words carry nothing; YouTube and TikTok raise their own label', () => {
    const typed = { channelId: 'x', status: 'draft', authorNeumaId: null, text: 'Typed by me.', disclosure: IN_METADATA, media: [] };
    expect(disclosed(typed)).toEqual(typed);
    expect(NATIVE_LABEL_CHANNELS).toEqual(['youtube', 'tiktok']);
    expect(carriesDisclosure({ ...being, channelId: 'youtube', media: [{ path: '/v.mp4', alt: '' }] })).toBe(true);
  });
});
