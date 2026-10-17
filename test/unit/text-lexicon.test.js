/**
 * The domain lexicon (core/text/lexicon.js) — the vocabulary a general speech
 * model has never heard, in one place, for three consumers (decode bias,
 * spellcheck seed, repair map).
 *
 * The load-bearing property proven here is the SAFETY INVARIANT: no key in
 * ALWAYS_CONFUSED may be a word the operator could plausibly have meant,
 * because that map is applied automatically with no diff and no asking. The
 * test enforces it structurally — a future contributor adding "canary" or
 * "pneuma" to the auto map breaks the suite instead of silently rewriting
 * Founder's drafts.
 *
 * Pure module: real inputs, real outputs, no mock (RULE 0).
 */
import { describe, test, expect } from 'vitest';
import {
  DOMAIN_TERMS, ALWAYS_CONFUSED, SUGGESTED_CONFUSIONS,
  hotwordsPhrase, dictionaryWords, HOTWORDS_PREFIX,
} from '../../core/text/lexicon.js';
import { applyConfusions } from '../../core/text/repair.js';

describe('the safety invariant', () => {
  test('no auto-applied key is also offered as a suggestion', () => {
    // A word cannot be both "certainly wrong" and "maybe meant".
    const overlap = Object.keys(ALWAYS_CONFUSED)
      .filter((k) => k in SUGGESTED_CONFUSIONS);
    expect(overlap).toEqual([]);
  });

  test('no auto-applied key is itself a canonical domain term', () => {
    // Auto-correcting a real term into another term would be self-defeating.
    const canonical = new Set(DOMAIN_TERMS.map((t) => t.toLowerCase()));
    const collisions = Object.keys(ALWAYS_CONFUSED).filter((k) => canonical.has(k));
    expect(collisions).toEqual([]);
  });

  test('every auto-applied key resolves to a canonical domain term', () => {
    // A target may be a PHRASE ("anuma" → "a neuma") where the speech model
    // fused a preceding article into the word. Every word of such a target
    // must be either a canonical term or a bare article — an auto-applied
    // replacement may restore structure the audio contained, never invent
    // vocabulary of its own.
    const canonical = new Set(DOMAIN_TERMS.map((t) => t.toLowerCase()));
    const articles = new Set(['a', 'an', 'the']);
    for (const target of Object.values(ALWAYS_CONFUSED)) {
      const words = target.toLowerCase().split(' ');
      expect(words.some((w) => canonical.has(w))).toBe(true);
      for (const w of words) {
        expect(canonical.has(w) || articles.has(w)).toBe(true);
      }
    }
  });

  test('the real English words stay OUT of the auto map', () => {
    // Each of these is a word someone could mean: the Greek the project's
    // vocabulary descends from, a deploy strategy, a person's name. ("numa"
    // left this tier 2026-08-10 — witnessed daily as "NUMA" in Founder's
    // dictation; in this house's mouth it is always […].)
    for (const realWord of ['pneuma', 'canary', 'laura', 'gemini']) {
      expect(ALWAYS_CONFUSED).not.toHaveProperty(realWord);
      expect(SUGGESTED_CONFUSIONS).toHaveProperty(realWord);
    }
  });

  test('"numa" is auto-repaired — the witnessed-daily leak (Design note, 2026-08-10', () => {
    expect(ALWAYS_CONFUSED.numa).toBe('neuma');
    expect(SUGGESTED_CONFUSIONS).not.toHaveProperty('numa');
    // Case follows sentence position, the platform/being distinction held:
    // sentence-initial becomes "Neuma", mid-sentence becomes "neuma" — even
    // when whisper shouted it in all caps.
    expect(applyConfusions('Numa is the platform')).toBe('Neuma is the platform');
    expect(applyConfusions('I opened NUMA again')).toBe('I opened neuma again');
  });

  test('auto-map keys are lowercase — matching lowercases before lookup', () => {
    for (const key of Object.keys(ALWAYS_CONFUSED)) {
      expect(key).toBe(key.toLowerCase());
    }
  });
});

describe('the sources of truth are immutable', () => {
  test('the exported structures are frozen', () => {
    expect(Object.isFrozen(DOMAIN_TERMS)).toBe(true);
    expect(Object.isFrozen(ALWAYS_CONFUSED)).toBe(true);
    expect(Object.isFrozen(SUGGESTED_CONFUSIONS)).toBe(true);
  });

  test('dictionaryWords hands back the frozen source, not a mutable copy', () => {
    expect(Object.isFrozen(dictionaryWords())).toBe(true);
  });
});

// The glossary's terms, without its sentence frame.
const glossaryTerms = () => hotwordsPhrase().slice(HOTWORDS_PREFIX.length, -1).split(', ');

describe('hotwordsPhrase — the decode bias', () => {
  test('reads as a punctuated sentence — whisper copies its prompt\'s style', () => {
    const phrase = hotwordsPhrase();
    expect(phrase.startsWith(HOTWORDS_PREFIX)).toBe(true);
    expect(phrase).toMatch(/^[A-Z]/);
    expect(phrase.endsWith('.')).toBe(true);
  });

  test('carries the canon a speech model cannot know', () => {
    const phrase = hotwordsPhrase();
    for (const term of ['neuma', 'Kenorie', 'kotodama', 'Natalis', 'Aldmere', 'LoRA']) {
      expect(phrase).toContain(term);
    }
  });

  test('deduplicates case-insensitively — the model does not care about case', () => {
    // DOMAIN_TERMS carries both "neuma" (beings) and "Neuma" (platform); the
    // distinction is meaningful in prose and meaningless to the decoder.
    const words = glossaryTerms();
    const lowered = words.map((w) => w.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });

  test('is a plain comma-joined phrase list, no empties', () => {
    const words = glossaryTerms();
    expect(words.length).toBeGreaterThan(20);
    for (const w of words) expect(w.trim()).toBe(w);
    expect(words).not.toContain('');
  });
});
