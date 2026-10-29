// Dictionary — what a word means, read from WordNet 3.1 on this machine.
//
// Design note, 2026-10-28: […].
// Offline by design: no network call, no model — the WordNet database ships
// as a dependency (wordnet-db, MIT; WordNet License, Princeton University).
// WordNet's own layout does the work: each index.<pos> file is sorted, so a
// lemma is a binary search away, and each sense in it is a byte offset into
// data.<pos>, read in one positioned read.
//
// The parsing below is pure (unit-tested on the real files); `define` is the
// one impure entry (file reads, cached per part of speech).

const fs = require('node:fs');
const path = require('node:path');

const POS = Object.freeze([
  { key: 'noun', label: 'noun' },
  { key: 'verb', label: 'verb' },
  { key: 'adj', label: 'adjective' },
  { key: 'adv', label: 'adverb' },
]);

// WordNet's detachment rules (morph.c), per part of speech: [suffix, ending].
// The package carries no irregular-form lists (*.exc), so the one regular
// pattern WordNet leaves to them — happier, tidiest — is a rule here.
const RULES = Object.freeze({
  noun: [['s', ''], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y']],
  verb: [['s', ''], ['ies', 'y'], ['es', 'e'], ['es', ''], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', '']],
  adj: [['er', ''], ['est', ''], ['er', 'e'], ['est', 'e'], ['ier', 'y'], ['iest', 'y']],
  adv: [],
});

const MAX_SENSES = 4;
const MAX_SYNONYMS = 3;
const MAX_WORD = 40;
const WORD_RE = /^[a-z][a-z'. -]*$/;

/** A selection as WordNet spells a lemma: lower case, accents let go (naïve → naive), underscores for spaces; null if it is no word. Pure. */
const lemmaKeyOf = (word) => {
  const key = String(word || '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key || key.length > MAX_WORD || !WORD_RE.test(key)) return null;
  return key.replace(/ /g, '_');
};

/**
 * Every base form a surface form could have in one part of speech, the form
 * itself first: WordNet's suffix rules, plus the doubled consonant English
 * drops ("running" → "runn" → "run"). Pure.
 * @param {string} key a lemma key
 * @param {'noun'|'verb'|'adj'|'adv'} pos
 */
const baseFormsOf = (key, pos) => {
  const out = [key];
  for (const [suffix, ending] of RULES[pos]) {
    if (!key.endsWith(suffix) || key.length <= suffix.length + 1) continue;
    const stem = key.slice(0, -suffix.length);
    out.push(stem + ending);
    if (!ending && /([b-df-hj-np-tv-z])\1$/.test(stem)) out.push(stem.slice(0, -1));
  }
  return [...new Set(out)];
};

/**
 * The index line for a lemma, by binary search over a whole sorted index
 * file (its licence header — lines opening with two spaces — sorts first).
 * Pure.
 * @param {string} text an index.<pos> file
 * @param {string} key
 * @returns {string|null}
 */
const findIndexLine = (text, key) => {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const start = text.lastIndexOf('\n', mid - 1) + 1;
    const nl = text.indexOf('\n', start);
    const end = nl < 0 ? text.length : nl;
    const line = text.slice(start, end);
    const lemma = line.startsWith('  ') ? null : line.slice(0, line.indexOf(' '));
    if (lemma === key) return line;
    if (lemma === null || lemma < key) lo = end + 1;
    else hi = start;
  }
  return null;
};

/** The synset offsets an index line points at, most common sense first. Pure. */
const offsetsOf = (indexLine) => {
  const f = indexLine.trim().split(' ');
  const count = Number(f[2]);
  return f.slice(-count);
};

/**
 * One data.<pos> line as a sense: its definition, its quoted examples, and
 * the other words for it. Pure.
 * @param {string} line
 * @param {string} key the lemma looked up, left out of its own synonyms
 */
const senseOf = (line, key) => {
  const f = line.split(' ');
  const count = parseInt(f[3], 16);
  const words = Array.from({ length: count }, (_, i) => f[4 + i * 2].replace(/\([a-z]+\)$/, ''));
  const bar = line.indexOf(' | ');
  const gloss = bar < 0 ? '' : line.slice(bar + 3).trim();
  const [definition, ...rest] = gloss.split(/;\s*(?=")/);
  return {
    definition: definition.trim(),
    examples: rest.map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean),
    synonyms: words.filter((w) => w.toLowerCase() !== key).slice(0, MAX_SYNONYMS).map((w) => w.replace(/_/g, ' ')),
  };
};

// impure — the database's files, each read once
const DICT = require('wordnet-db').path;
const indexes = new Map();
const indexText = (pos) => {
  if (!indexes.has(pos)) indexes.set(pos, fs.readFileSync(path.join(DICT, `index.${pos}`), 'latin1'));
  return indexes.get(pos);
};

// impure — one data line, read at its byte offset, chunk by chunk until it
// ends (most are short; a synset like "city", with thousands of links,
// runs past 12 KB)
const CHUNK = 8192;
const readDataLine = (pos, offset) => {
  const fd = fs.openSync(path.join(DICT, `data.${pos}`), 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    let text = '';
    for (let at = Number(offset); ; at += CHUNK) {
      const n = fs.readSync(fd, buf, 0, CHUNK, at);
      const chunk = buf.toString('latin1', 0, n);
      const nl = chunk.indexOf('\n');
      if (nl >= 0 || n < CHUNK) return text + (nl >= 0 ? chunk.slice(0, nl) : chunk);
      text += chunk;
    }
  } finally {
    fs.closeSync(fd);
  }
};

/**
 * What a word means: its entries per part of speech, each with up to four
 * senses. An unknown word answers with no entries, never an error. Impure
 * (reads the database files).
 * @param {string} word as selected
 * @returns {{ word: string, entries: Array<{ pos: string, lemma: string,
 *   senses: Array<{ definition: string, examples: string[], synonyms: string[] }> }> }}
 */
const define = (word) => {
  const key = lemmaKeyOf(word);
  const shown = String(word || '').trim();
  if (!key) return { word: shown, entries: [] };
  const entries = [];
  for (const { key: pos, label } of POS) {
    const text = indexText(pos);
    const lemma = baseFormsOf(key, pos).find((form) => findIndexLine(text, form));
    if (!lemma) continue;
    const senses = offsetsOf(findIndexLine(text, lemma)).slice(0, MAX_SENSES)
      .map((offset) => senseOf(readDataLine(pos, offset), lemma));
    entries.push({ pos: label, lemma: lemma.replace(/_/g, ' '), senses });
  }
  return { word: shown, entries };
};

module.exports = { define, lemmaKeyOf, baseFormsOf, findIndexLine, offsetsOf, senseOf, MAX_SENSES };
