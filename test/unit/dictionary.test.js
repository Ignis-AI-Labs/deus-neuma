// DEFINE's dictionary — real lookups against the real WordNet 3.1 files the
// app ships (wordnet-db). No mock: every assertion reads the database.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { define, lemmaKeyOf, baseFormsOf, findIndexLine, offsetsOf, senseOf, MAX_SENSES } = require('../../electron/dictionary.cjs');
const DICT = require('wordnet-db').path;

describe('define — what a word means, offline', () => {
  it('reads a word the way the dictionary has it: its sense, and the other words for it', () => {
    const { word, entries } = define('pedantic');
    expect(word).toBe('pedantic');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ pos: 'adjective', lemma: 'pedantic' });
    expect(entries[0].senses[0].definition).toBe('marked by a narrow focus on or display of learning especially its trivial aspects');
    expect(entries[0].senses[0].synonyms).toEqual(['academic', 'donnish']);
  });

  it('finds the word behind its endings, across parts of speech', () => {
    const lemmas = (w) => define(w).entries.map((e) => `${e.pos}:${e.lemma}`);
    expect(lemmas('Pedants')).toEqual(['noun:pedant']);
    expect(lemmas('stopped')).toContain('verb:stop');
    expect(lemmas('running')).toEqual(['noun:running', 'verb:run', 'adjective:running']);
    expect(lemmas('happier')).toEqual(['adjective:happy']);
    expect(lemmas('cats')).toContain('noun:cat');
  });

  it('reads short phrases and lets accents go', () => {
    expect(define('ad hoc').entries.map((e) => e.pos)).toEqual(['adjective', 'adverb']);
    expect(define('naïve').entries[0].lemma).toBe('naive');
    expect(define('“résumé”'.slice(1, -1)).entries.map((e) => e.lemma)).toContain('resume');
  });

  it('reads a sense whose line runs past one read (city: 12,972 bytes)', () => {
    const city = define('city').entries[0];
    expect(city.senses[0].definition).toBe('a large and densely populated urban area; may include several independent administrative districts');
    expect(city.senses[0].examples[0]).toBe('Ancient Troy was a great city');
  });

  it('keeps examples apart from the definition, and caps the senses', () => {
    const verb = define('run').entries.find((e) => e.pos === 'verb');
    expect(verb.senses).toHaveLength(MAX_SENSES);
    expect(verb.senses[0].definition).toBe("move fast by using one's feet, with one foot off the ground at any given time");
    expect(verb.senses[0].examples[0]).toBe("Don't run--you'll be out of breath");
    expect(verb.senses.every((s) => !s.definition.includes('"'))).toBe(true);
  });

  it('answers an unknown word, or no word, with no entries — never an error', () => {
    expect(define('xyzzyq').entries).toEqual([]);
    expect(define('日本').entries).toEqual([]);
    expect(define('').entries).toEqual([]);
    expect(define('a'.repeat(80)).entries).toEqual([]);
    expect(lemmaKeyOf('rm -rf /')).toBeNull();
    expect(lemmaKeyOf('../index.noun')).toBeNull();
  });
});

describe('the pieces, on the real files', () => {
  it('binary search finds EVERY lemma of a whole index — the sort order WordNet keeps is the one searched', () => {
    for (const pos of ['adv', 'adj']) {
      const text = fs.readFileSync(path.join(DICT, `index.${pos}`), 'latin1');
      const lemmas = text.split('\n').filter((l) => l && !l.startsWith('  ')).map((l) => l.slice(0, l.indexOf(' ')));
      expect(lemmas.length).toBeGreaterThan(4000);
      for (const lemma of lemmas) expect(findIndexLine(text, lemma)?.startsWith(`${lemma} `), `${pos} ${lemma}`).toBe(true);
      expect(findIndexLine(text, 'zzzzzz')).toBeNull();
      expect(findIndexLine(text, '!!')).toBeNull(); // sorts before every lemma
    }
  });

  it('every sense offset points at its own line in the data file', () => {
    const text = fs.readFileSync(path.join(DICT, 'index.noun'), 'latin1');
    const data = fs.readFileSync(path.join(DICT, 'data.noun'));
    for (const offset of offsetsOf(findIndexLine(text, 'cat'))) {
      const line = data.toString('latin1', Number(offset), Number(offset) + 20000);
      expect(line.startsWith(offset)).toBe(true);
      expect(senseOf(line.slice(0, line.indexOf('\n')), 'cat').definition.length).toBeGreaterThan(5);
    }
  });

  it('base forms: the word itself first, then the rules, with a doubled consonant let go', () => {
    expect(baseFormsOf('running', 'verb')).toEqual(['running', 'runne', 'runn', 'run']);
    expect(baseFormsOf('boxes', 'noun')).toContain('box');
    expect(baseFormsOf('quickly', 'adv')).toEqual(['quickly']);
  });
});
