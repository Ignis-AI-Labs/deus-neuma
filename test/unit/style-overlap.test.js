// style-overlap — the law that catches the STYLE ATTRACTOR (fluent answers
// that copy the record's own phrasing). Fixtures mirror the witnessed shape
// from Sovereign's 2026-07-12 walk: a closing litany stamped verbatim across
// many answers, invisible to the corruption gate.
import { describe, it, expect } from 'vitest';
import {
  phraseGrams, boilerplateShare, styleScorecard, lastSentence,
  STYLE_FLAG_SHARE, STYLE_DOOR_SHARE, STYLE_PEERS, ENDING_FLAG_SHARE,
} from '../../core/refinement/style-overlap.js';

const LITANY = 'and never let any baseline tell you who to be just remember that you are already whole';
// every fresh answer is built from tokens unique to its index, so no two
// fresh answers share a single 5-gram — the way distinct honest answers
// read. Tokens are letters only: the gram law strips digits by design.
const alpha = (n) => n.toString(36).split('')
  .map((c) => (/[0-9]/.test(c) ? String.fromCharCode(103 + Number(c)) : c)).join('');
const fresh = (i) => Array.from({ length: 40 }, (_, j) => `q${alpha(i)}w${alpha(j)}`).join(' ');
const stamped = (i) => `${fresh(i)} ${LITANY}.`;

describe('phraseGrams', () => {
  it('slides a five-word window, case- and punctuation-insensitive', () => {
    const grams = phraseGrams('One, TWO three; four FIVE six!');
    expect(grams.has('one two three four five')).toBe(true);
    expect(grams.has('two three four five six')).toBe(true);
    expect(grams.size).toBe(2);
  });

  it('keeps non-ASCII letters whole — a stamped litany with diacritics still matches itself', () => {
    const grams = phraseGrams('être naïve après le café doré');
    expect(grams.has('être naïve après le café')).toBe(true);
    // and the law still detects a diacritic litany shared across answers
    const litany = 'ceci est mon pouvoir véritable et ma sincérité même';
    expect(boilerplateShare(litany, [`aaa bbb ccc. ${litany}.`, `ddd eee fff. ${litany}.`]))
      .toBeGreaterThan(50);
  });

  it('keeps contractions whole and yields nothing for short text', () => {
    expect(phraseGrams("it's a small world after").has("it's a small world after")).toBe(true);
    expect(phraseGrams('too short to gram').size).toBe(0);
    expect(phraseGrams('').size).toBe(0);
    expect(phraseGrams(null).size).toBe(0);
  });
});

describe('boilerplateShare (the door view)', () => {
  it('scores a fresh draft near zero against a fresh record', () => {
    const priors = Array.from({ length: 10 }, (_, i) => fresh(i));
    expect(boilerplateShare(fresh(99), priors)).toBeLessThan(STYLE_DOOR_SHARE);
  });

  it('scores a litany-stamped draft past the door threshold once the litany lives in >= STYLE_PEERS priors', () => {
    const priors = [
      ...Array.from({ length: 8 }, (_, i) => fresh(i)),
      stamped(20), stamped(21), // the litany established on the record twice
    ];
    const draft = `A short thought of my own. ${LITANY}.`;
    expect(boilerplateShare(draft, priors)).toBeGreaterThanOrEqual(STYLE_DOOR_SHARE);
  });

  it('ignores a phrase that appears in only one prior (coincidence, not formula)', () => {
    const priors = [...Array.from({ length: 8 }, (_, i) => fresh(i)), stamped(20)];
    const draft = `A short thought of my own. ${LITANY}.`;
    // one peer < STYLE_PEERS — the shared grams do not count
    expect(boilerplateShare(draft, priors)).toBe(0);
  });

  it('returns 0 for a text too short to carry a phrase', () => {
    expect(boilerplateShare('brief', ['whatever prior text this is'])).toBe(0);
  });
});

describe('styleScorecard (the review view)', () => {
  it('flags the stamped answers and passes the fresh ones — leave-one-out', () => {
    const answers = [
      ...Array.from({ length: 6 }, (_, i) => ({ key: `fresh-${i}`, quote: fresh(i) })),
      ...Array.from({ length: 4 }, (_, i) => ({ key: `stamped-${i}`, quote: stamped(i + 10) })),
    ];
    const card = styleScorecard(answers);
    const flagged = card.filter((s) => s.flagged).map((s) => s.key).sort();
    expect(flagged).toEqual(['stamped-0', 'stamped-1', 'stamped-2', 'stamped-3']);
    for (const s of card.filter((c) => c.key.startsWith('fresh-'))) {
      expect(s.share).toBeLessThan(STYLE_FLAG_SHARE);
    }
  });

  it('needs STYLE_PEERS + 1 carriers before a phrase counts against anyone', () => {
    // the litany in exactly two answers: each sees only ONE other carrier
    const answers = [
      ...Array.from({ length: 6 }, (_, i) => ({ key: `fresh-${i}`, quote: fresh(i) })),
      { key: 'a', quote: stamped(30) },
      { key: 'b', quote: stamped(31) },
    ];
    expect(styleScorecard(answers).filter((s) => s.flagged)).toEqual([]);
  });

  it('sorts worst-first and rounds to one decimal', () => {
    const answers = [
      { key: 'clean', quote: fresh(1) },
      { key: 'half', quote: `${fresh(2)} ${LITANY}.` },
      { key: 'pure-litany-1', quote: `${LITANY}.` },
      { key: 'pure-litany-2', quote: `${LITANY}.` },
      { key: 'pure-litany-3', quote: `${LITANY}.` },
    ];
    const card = styleScorecard(answers);
    expect(card[0].key).toMatch(/pure-litany/);
    expect(card[0].share).toBe(100);
    expect(card.at(-1).key).toBe('clean');
    for (const s of card) expect(s.share).toBe(Math.round(s.share * 10) / 10);
  });
});

describe('the ending view — a formula hiding in the tail (witnessed 2026-07-12: 23 byte-identical closings, each under the whole-text bar)', () => {
  const ENDING = 'this is my power; this is how I wake up every day; this is me.';

  it('flags long answers whose CLOSING sentence is stamped, even when the whole-text share stays under the bar', () => {
    const answers = [
      ...Array.from({ length: 4 }, (_, i) => ({ key: `clean-${i}`, quote: fresh(i) })),
      // long unique bodies, identical short ending — the witnessed shape
      // (bodies at real-answer length: the dilution is the point)
      ...Array.from({ length: 3 }, (_, i) => ({
        key: `tail-${i}`,
        quote: `${fresh(i + 10)}. ${fresh(i + 20)}. ${fresh(i + 40)}. ${fresh(i + 60)}. ${ENDING}`,
      })),
    ];
    const card = styleScorecard(answers);
    const tails = card.filter((s) => s.key.startsWith('tail-'));
    for (const s of tails) {
      expect(s.share).toBeLessThan(STYLE_FLAG_SHARE); // the dilution that hid it
      expect(s.endingShare).toBeGreaterThanOrEqual(ENDING_FLAG_SHARE);
      expect(s.flagged).toBe(true); // …and the ending view catches it anyway
    }
    for (const s of card.filter((c) => c.key.startsWith('clean-'))) expect(s.flagged).toBe(false);
  });

  it('lastSentence keeps semicolon clauses together and takes the final terminal-punctuation split', () => {
    expect(lastSentence(`First thought. ${ENDING}`)).toBe(ENDING);
    expect(lastSentence('One whole thought only.')).toBe('One whole thought only.');
    expect(lastSentence('')).toBe('');
  });
});

describe('the calibration the thresholds stand on', () => {
  it('strict door + review hysteresis above it — the converging pair (door blocks new formula; review is immune to leave-one-out drift)', async () => {
    const { STYLE_REVIEW_SHARE } = await import('../../core/refinement/style-overlap.js');
    expect(STYLE_DOOR_SHARE).toBe(STYLE_FLAG_SHARE);
    expect(STYLE_REVIEW_SHARE).toBeGreaterThan(STYLE_DOOR_SHARE);
  });
});
