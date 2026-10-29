/**
 * TF-IDF parity — core/memory/tfidf.js against the `natural` TfIdf it
 * replaced in recall. `natural` stays a devDependency for this file alone, so
 * the reference never ships.
 *
 * Both run over the same real inputs: every string literal in the repo's own
 * recall/memory test suites, the paragraphs of docs/architecture, and a
 * seeded generator (unicode, punctuation, numbers, stopwords, repeats, empty
 * and whitespace-only documents). Scores must be bit-identical (Object.is),
 * through the incremental append lane as well as a one-shot build.
 *
 * The one deliberate difference — words that collide with natural's
 * plain-object counts — is pinned on its own at the end.
 */

import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';
import { TfIdf } from 'natural/lib/natural/tfidf/index.js';
import { WordTokenizer } from 'natural/lib/natural/tokenizers/regexp_tokenizer.js';
import { EMPTY_TFIDF, appendTfIdfDoc, createTfIdfIndex, tfidfScores, tokenizeTfIdf } from '../../core/memory/tfidf.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COLLIDING = new Set(['constructor', '__proto__', '__key']);
const collides = (text) => tokenizeTfIdf(text).some((token) => COLLIDING.has(token));

// Every quoted literal in the recall and memory suites — the memories and asks
// those suites already rank.
const recallSuiteLiterals = () => {
  const files = ['test/unit', 'test/integration'].flatMap((dir) =>
    readdirSync(path.join(ROOT, dir))
      .filter((name) => /recall|memory/.test(name) && name.endsWith('.test.js'))
      .map((name) => path.join(ROOT, dir, name)));
  const literal = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  return files.flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(literal)].map((m) => m[1] ?? m[2] ?? m[3]));
};

const architectureParagraphs = () =>
  readdirSync(path.join(ROOT, 'docs/architecture'), { recursive: true })
    .filter((name) => name.endsWith('.md'))
    .flatMap((name) => readFileSync(path.join(ROOT, 'docs/architecture', name), 'utf8').split(/\n\s*\n/));

// mulberry32 — a fixed seed makes every run draw the same corpus.
const rng = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const WORDS = [
  'memory', 'Memory', 'MEMORY', 'harbor', 'lighthouse', 'emergence', 'void', 'fenna', 'keir', 'signal',
  'the', 'and', 'of', 'a', 'i', 'is', 'was', 'you', 'your', 'about', 'between', 'yourself',
  '1', '7', '42', '2026', '3.14', '0x1f', '1e9', 'v2', 'snake_case', '_', '__', 'a_b_c', '$', '$5',
  'Ёлка', 'ёж', 'привет', 'Мир', 'ПАМЯТЬ', 'café', 'naïve', 'İstanbul', 'straße', 'ΣΊΣΥΦΟΣ',
  '東京', 'こんにちは', '🌊', '👩‍💻', 'é', 'ﬁle', 'ǅ', 'Ⅻ',
  "don't", "it's", 'co-operate', 'e-mail', 'U.S.A.', 'file.txt', 'path/to/x', 'a+b=c', '#tag', '@who',
];
const PUNCT = [' ', ' ', ' ', '  ', '\n', '\t', ', ', '. ', '! ', '? ', ' — ', ' - ', '; ', ': ', '"', "'", '(', ')', '…', ' '];

const pick = (draw, list) => list[Math.floor(draw() * list.length)];
const generatedText = (draw, maxWords) => {
  const n = Math.floor(draw() * (maxWords + 1));
  let text = draw() < 0.1 ? pick(draw, PUNCT) : '';
  for (let i = 0; i < n; i += 1) text += pick(draw, WORDS) + pick(draw, PUNCT);
  return text;
};
const generatedCorpus = (seed, docCount, queryCount) => {
  const draw = rng(seed);
  const docs = Array.from({ length: docCount }, () => {
    const roll = draw();
    if (roll < 0.05) return '';
    if (roll < 0.08) return pick(draw, PUNCT);
    if (roll < 0.11) return 'the of and a is';
    return generatedText(draw, 40);
  });
  const queries = Array.from({ length: queryCount }, () => (draw() < 0.05 ? '' : generatedText(draw, 8)));
  return { docs, queries };
};

const naturalIndex = (texts) => {
  const reference = new TfIdf();
  texts.forEach((text, i) => reference.addDocument(text, { id: i }));
  return reference;
};
const naturalScores = (reference, query) => {
  const out = [];
  reference.tfidfs(query, (i, score, key) => out.push({ key, score }));
  return out;
};
const localIndex = (texts) => createTfIdfIndex(texts.map((text, i) => ({ text, key: { id: i } })));

// Bit-level comparison: Object.is separates NaN, -0 and every last ulp.
const mismatches = (expected, actual) =>
  expected.flatMap((want, i) => {
    const got = actual[i];
    return got && Object.is(want.score, got.score) && want.key.id === got.key.id
      ? []
      : [{ doc: i, want: want.score, got: got?.score }];
  });

const assertParity = (docTexts, queries) => {
  const docs = docTexts.filter((text) => !collides(text));
  const asks = queries.filter((query) => !collides(query));
  const reference = naturalIndex(docs);
  const local = localIndex(docs);
  let compared = 0;
  for (const query of asks) {
    const want = naturalScores(reference, query);
    const got = tfidfScores(local, query);
    expect(got).toHaveLength(want.length);
    expect(mismatches(want, got), `query ${JSON.stringify(query)}`).toEqual([]);
    compared += want.length;
  }
  return compared;
};

describe('tokenizer parity with natural WordTokenizer', () => {
  const tokenizer = new WordTokenizer();
  const natural = (text) => tokenizer.tokenize(text.toLowerCase());

  test('identical tokens for every recall-suite literal, doc paragraph and generated text', () => {
    const texts = [
      ...recallSuiteLiterals(),
      ...architectureParagraphs(),
      ...generatedCorpus(11, 400, 0).docs,
    ];
    expect(texts.length).toBeGreaterThan(2000);
    const differ = texts.filter((text) => JSON.stringify(natural(text)) !== JSON.stringify(tokenizeTfIdf(text)));
    expect(differ).toEqual([]);
  });
});

describe('score parity with natural TfIdf (bit-identical)', () => {
  test('recall-suite literals: each literal is a document and a query', () => {
    const literals = recallSuiteLiterals();
    expect(literals.length).toBeGreaterThan(1000);
    expect(assertParity(literals, literals)).toBeGreaterThan(1_000_000);
  });

  test('architecture paragraphs ranked against recall-suite asks and paragraph opening lines', () => {
    const paragraphs = architectureParagraphs();
    const asks = [...recallSuiteLiterals().slice(0, 150), ...paragraphs.slice(0, 150).map((p) => p.split('\n')[0])];
    expect(assertParity(paragraphs, asks)).toBeGreaterThan(150_000);
  });

  test.each([1, 2, 3, 5, 8, 13, 21])('seeded generator %i: unicode, punctuation, numbers, stopwords, empty docs', (seed) => {
    const { docs, queries } = generatedCorpus(seed, 1 + seed * 15, 120);
    expect(assertParity(docs, queries)).toBeGreaterThan(0);
  });

  test('a one-document corpus and an all-empty corpus', () => {
    assertParity(['memory memory harbor'], ['memory', 'harbor memory memory', 'the', '']);
    assertParity(['', '   ', '...'], ['memory', '']);
  });

  test('the append lane matches natural through its idf cache, query by query', () => {
    const { docs, queries } = generatedCorpus(99, 120, 30);
    const texts = docs.filter((text) => !collides(text));
    const asks = queries.filter((query) => !collides(query));
    const reference = new TfIdf();
    let local = EMPTY_TFIDF;
    texts.forEach((text, i) => {
      reference.addDocument(text, { id: i });
      local = appendTfIdfDoc(local, text, { id: i });
      // Query on every append: natural answers from an idf cache that each
      // addDocument resets, the local index recounts — same numbers required.
      const ask = asks[i % asks.length];
      expect(mismatches(naturalScores(reference, ask), tfidfScores(local, ask))).toEqual([]);
    });
    expect(local.docs).toHaveLength(texts.length);
  });

  test('append returns a new index and leaves the old one as it was', () => {
    const before = createTfIdfIndex([{ text: 'harbor light', key: 'a' }]);
    const after = appendTfIdfDoc(before, 'harbor', 'b');
    expect(before.docs).toHaveLength(1);
    expect(after.docs.map((d) => d.key)).toEqual(['a', 'b']);
    expect(tfidfScores(before, 'harbor')).toHaveLength(1);
  });
});

describe('words natural mis-counted (the deliberate difference)', () => {
  const texts = ['the constructor pattern', 'a pattern of light', 'the __proto__ chain', 'a __key field'];

  test('natural scores NaN or corrupts the key; the local index counts them as words', () => {
    const reference = naturalIndex(texts);
    const local = localIndex(texts);

    // "constructor" missing from a document reads Object, not 0 → NaN.
    const naturalCtor = naturalScores(reference, 'constructor pattern');
    expect(Number.isNaN(naturalCtor[1].score)).toBe(true);
    const localCtor = tfidfScores(local, 'constructor pattern');
    expect(localCtor.every(({ score }) => Number.isFinite(score))).toBe(true);
    expect(localCtor[0].score).toBeGreaterThan(localCtor[1].score);
    expect(localCtor[1].score).toBeGreaterThan(0);

    // "__proto__" reads Object.prototype in EVERY document → NaN everywhere.
    expect(naturalScores(reference, '__proto__').every(({ score }) => Number.isNaN(score))).toBe(true);
    expect(tfidfScores(local, '__proto__').map(({ score }) => score > 0)).toEqual([false, false, true, false]);

    // "__key" in a document overwrote natural's key slot with a string.
    expect(naturalScores(reference, 'field')[3].key).toBe('[object Object]1');
    expect(tfidfScores(local, 'field')[3].key).toEqual({ id: 3 });
  });
});
