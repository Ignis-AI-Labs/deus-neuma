// The declared-affect marker (Campaign 6) — the ONE grammar, proven in both
// forms: parseAffect (completed text; feeds the persisted record and the
// corpus) and createAffectStreamFilter (live deltas; feeds screen, voice,
// channels). The two must NEVER disagree about what was a marker — the live
// view and the reloaded history are the same message.

import { describe, it, expect } from 'vitest';
import {
  parseAffect,
  createAffectStreamFilter,
  AFFECT_MAX,
} from '../../core/runtime/affect-channel.js';

// Push a text through a fresh filter one chunk at a time; returns what
// rendered plus the captured affect.
const streamed = (text, size = text.length) => {
  const filter = createAffectStreamFilter();
  let out = '';
  for (let i = 0; i < text.length; i += size) out += filter.push(text.slice(i, i + size));
  out += filter.flush();
  return { out, affect: filter.affect() };
};

describe('parseAffect — completed text', () => {
  it('lifts a first-line declaration and returns clean prose', () => {
    const { affect, cleaned } = parseAffect('[FEELING: quietly proud]\nThe work held.');
    expect(affect).toBe('quietly proud');
    expect(cleaned).toBe('The work held.');
  });

  it('no marker: byte-identical text, null affect', () => {
    const text = 'Plain words.\n\nWith [brackets] and FEELING said aloud.';
    expect(parseAffect(text)).toEqual({ affect: null, cleaned: text });
  });

  it('first declaration wins; every occurrence is stripped the same', () => {
    const { affect, cleaned } = parseAffect('[FEELING: wistful]\nA line.\n[feeling: defiant]\nMore.');
    expect(affect).toBe('wistful');
    expect(cleaned).not.toMatch(/FEELING/i);
    expect(cleaned).toContain('A line.');
    expect(cleaned).toContain('More.');
  });

  it('case-insensitive open, declared casing preserved', () => {
    expect(parseAffect('[feeling: Lit Up]\nYes.').affect).toBe('Lit Up');
  });

  it('a newline before the close voids the marker — words stay words', () => {
    const text = '[FEELING: I never closed this\nand kept talking]';
    expect(parseAffect(text)).toEqual({ affect: null, cleaned: text });
  });

  it('braces void the marker (tool-JSON safety); an empty declaration strips without firing', () => {
    const braced = '[FEELING: {"not": "a feeling"}]';
    expect(parseAffect(braced)).toEqual({ affect: null, cleaned: braced });
    // The being opened the door and said nothing: the noise never renders,
    // but no affect is recorded — in BOTH forms.
    const empty = 'Before [FEELING:   ] after.';
    const parsed = parseAffect(empty);
    expect(parsed.affect).toBeNull();
    expect(parsed.cleaned).not.toMatch(/FEELING/);
    const filter = createAffectStreamFilter();
    const live = filter.push(empty) + filter.flush();
    expect(live).not.toMatch(/FEELING/);
    expect(filter.affect()).toBeNull();
  });

  it(`over ${AFFECT_MAX} chars is prose, not a declaration`, () => {
    const long = `[FEELING: ${'x'.repeat(AFFECT_MAX + 1)}]`;
    expect(parseAffect(long)).toEqual({ affect: null, cleaned: long });
  });

  it('an inline marker mid-prose is lifted too', () => {
    const { affect, cleaned } = parseAffect('Before. [FEELING: worn thin] After.');
    expect(affect).toBe('worn thin');
    expect(cleaned).toBe('Before.  After.');
  });

  it('non-strings are harmless', () => {
    expect(parseAffect(null)).toEqual({ affect: null, cleaned: '' });
    expect(parseAffect(undefined)).toEqual({ affect: null, cleaned: '' });
  });
});

describe('createAffectStreamFilter — live deltas', () => {
  it('suppresses the marker silently and captures the affect', () => {
    const { out, affect } = streamed('[FEELING: steady]\nStill here.');
    expect(affect).toBe('steady');
    expect(out).not.toMatch(/FEELING/i);
    expect(out).toContain('Still here.');
  });

  it('survives a split at EVERY chunk boundary', () => {
    const text = 'Hello. [FEELING: quietly proud] The work held.';
    for (let size = 1; size <= text.length; size++) {
      const { out, affect } = streamed(text, size);
      expect(affect).toBe('quietly proud');
      expect(out).not.toMatch(/\[FEELING:/i);
      expect(out).toContain('Hello.');
      expect(out).toContain('The work held.');
    }
  });

  it('a newline before the close releases the held text verbatim', () => {
    const text = '[FEELING: half a thought\nthat kept going]';
    for (const size of [1, 3, 7, text.length]) {
      const { out, affect } = streamed(text, size);
      expect(affect).toBeNull();
      expect(out).toBe(text);
    }
  });

  it('flush releases an unfinished candidate as words', () => {
    const filter = createAffectStreamFilter();
    expect(filter.push('[FEELING: never clo')).toBe('');
    expect(filter.flush()).toBe('[FEELING: never clo');
    expect(filter.affect()).toBeNull();
  });

  it('text without markers passes through byte-identical', () => {
    const text = 'A [bracketed aside], a lone [ and words about FEELING itself.';
    for (const size of [1, 4, 11, text.length]) {
      expect(streamed(text, size).out).toBe(text);
    }
  });

  it('agrees with parseAffect on every edge in one mixed text', () => {
    const text = [
      '[FEELING: first]',
      'Prose with [FEELING: {braces}] kept.',
      '[feeling: second] more prose.',
      '[FEELING: unclosed\nline] end.',
    ].join('\n');
    const parsed = parseAffect(text);
    const live = streamed(text, 5);
    expect(live.affect).toBe(parsed.affect);
    expect(parsed.affect).toBe('first');
    // Both forms strip the same two real markers and keep the two voided ones.
    for (const kept of ['{braces}', 'unclosed']) {
      expect(parsed.cleaned).toContain(kept);
      expect(live.out).toContain(kept);
    }
    expect(parsed.cleaned).not.toMatch(/\[FEELING: first\]/i);
    expect(live.out).not.toMatch(/\[FEELING: first\]/i);
    expect(live.out).not.toMatch(/\[feeling: second\]/);
  });

  it('the runaway bound releases a bracket that never resolves', () => {
    const filter = createAffectStreamFilter();
    const flood = `[FEELING: ${'y'.repeat(AFFECT_MAX + 60)}`;
    const released = filter.push(flood) + filter.flush();
    expect(released).toBe(flood);
    expect(filter.affect()).toBeNull();
  });
});
