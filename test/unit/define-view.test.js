// DEFINE's card — its pure view logic, with real text and real dictionary
// answers (electron/dictionary.cjs on the shipped WordNet). No DOM, no mock.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { askTextFor, definitionText, hasMore, sensesShown, sentenceAround } from '../../frontend/components/DesktopContextMenu/define-view.js';

const { define } = createRequire(import.meta.url)('../../electron/dictionary.cjs');
const PROSE = "That's where the problem actually lives. And that's not a pedantic point — it's the whole thing! Next.";

describe('sentenceAround', () => {
  it('quotes the sentence the word was read in', () => {
    expect(sentenceAround(PROSE, PROSE.indexOf('pedantic'))).toBe("And that's not a pedantic point — it's the whole thing!");
    expect(sentenceAround(PROSE, 0)).toBe("That's where the problem actually lives.");
    expect(sentenceAround(PROSE, PROSE.indexOf('Next'))).toBe('Next.');
  });

  it('counts the position in the raw text even where whitespace runs collapse', () => {
    const raw = 'First   line.\n\n\n   And   that is   pedantic   indeed.   Last.';
    expect(sentenceAround(raw, raw.indexOf('pedantic'))).toBe('And that is pedantic indeed.');
  });

  it('trims a very long sentence around the word, and says so', () => {
    const long = `Start. ${'word '.repeat(80)}pedantic ${'word '.repeat(80)}end.`;
    const s = sentenceAround(long, long.indexOf('pedantic'));
    expect(s).toContain('pedantic');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(222);
  });

  it('has nothing to quote in empty text', () => {
    expect(sentenceAround('', 0)).toBe('');
    expect(sentenceAround('   ', 2)).toBe('');
  });
});

describe('askTextFor', () => {
  it('asks about the word in its sentence — or alone when the sentence is only the word', () => {
    expect(askTextFor('pedantic', 'And that is pedantic.')).toBe('What does “pedantic” mean in “And that is pedantic.”?');
    expect(askTextFor('pedantic', 'Pedantic')).toBe('What does “pedantic” mean?');
    expect(askTextFor('pedantic')).toBe('What does “pedantic” mean?');
  });
});

describe('the card over a real answer', () => {
  it('shows two senses at a glance and MORE when there are others', () => {
    const run = define('run');
    expect(hasMore(run.entries)).toBe(true);
    const verb = run.entries.find((e) => e.pos === 'verb');
    expect(sensesShown(verb, false)).toHaveLength(2);
    expect(sensesShown(verb, true)).toHaveLength(verb.senses.length);
    expect(hasMore(define('pedantic').entries)).toBe(false);
  });

  it('copies as plain text: the word, then each part of speech with its numbered meanings', () => {
    expect(definitionText(define('pedantic'))).toBe(
      'pedantic\npedantic (adjective): 1. marked by a narrow focus on or display of learning especially its trivial aspects',
    );
  });
});
