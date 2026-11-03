/**
 * MEANINGFUL NAMES — given names made of real words (docs/work/naming-meaning.md).
 *
 * No gibberish: every name the platform gives a being — its genesis name, its
 * soul alias, its house — is two elements from name-lexicon.js joined, and
 * carries its breakdown: each part, its language, the word in its own
 * script, and what the whole means in English.
 *
 * Same hex in, same name out. A domain tag per kind of name keeps a being's
 * genesis name, soul alias and house from echoing one another.
 *
 * THE UNREPEATABLE NAME (MANY SKIES §6.1) under this scheme: a name already
 * borne is passed over by walking every name the lexicon can make, in an
 * order the seed fixes, so a new name is found while any is free. Past that
 * (thousands of beings in one house) the name takes an ordinal, II, III …
 *
 * Names minted before this scheme (KOTODAMA v1) are sound-names: syllables
 * made from the bytes of a birth or a wallet, with no word meaning. They are
 * kept, and described as what they are (describeGivenName).
 *
 * Pure.
 */
import { createHash } from 'node:crypto';
import { LANGUAGES, WORDS, PLACES } from './name-lexicon.js';

export const NAME_SCHEME = 'kotodama-names/2';

// Who may stand where (name-lexicon.js kinds): nouns and adjectives open;
// nouns and endings close a being's name; places close a house's. Any noun
// may meet any other — […] stands.
export const OPENERS = Object.freeze(WORDS.filter((w) => w.kind === 'n' || w.kind === 'a'));
export const CLOSERS = Object.freeze({
  genesis: Object.freeze(WORDS.filter((w) => w.kind === 'n' || w.kind === 'e')),
  house: PLACES,
});

const STOPS = 'bcdgkpt';
// A join must not spell these, anywhere in the name. Kept in ROT13 so the
// source holds no slurs or profanity (and the public export, which rewrites
// some of them, ships the same list).
const rot13 = (w) => w.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const AVOID = Object.freeze(['nany', 'nahf', 'nefr', 'nff', 'ohgg', 'pbpx', 'pbjneq', 'phz', 'phag', 'qnza', 'qrnq',
  'qvpx', 'qvyqb', 'snt', 'shpx', 'ungr', 'uvgyre', 'wvmm', 'xvxr', 'xvyy', 'xxx', 'anmv', 'avt', 'cravf', 'cvff',
  'cbb', 'cbea', 'encr', 'frk', 'fuvg', 'fyhg', 'fcvp', 'gvg', 'gheq', 'gjng', 'int', 'jnax', 'juber'].map(rot13));
// Words a join must not make ACROSS its seam (Rosa + tan, Hesper + mont). The
// same letters inside one real word stand — they are that language's own.
const SEAM_AVOID = Object.freeze(['qhq', 'tber', 'tha', 'unt', 'uryy', 'ubzb', 'ynzr', 'yvne', 'cvt', 'fngna', 'fcrez',
  'htyl', 'ivyr'].map(rot13));
// pure — whether a word sits across the seam at `at` in a joined form
const across = (form, at) => SEAM_AVOID.some((w) => {
  for (let i = form.indexOf(w); i !== -1; i = form.indexOf(w, i + 1)) if (i < at && i + w.length > at) return true;
  return false;
});
const MAX_LETTERS = 11;
// A name never says the same thing twice: not […], not
// "lake of water" (the lexicon marks its waters).
const twice = (a, b) => a.gloss.includes(b.gloss) || b.gloss.includes(a.gloss) || (a.mark === 'water' && b.mark === 'water');

// Vowel pairs a reader says as two sounds; the rest (ea, ai, ou …) fuse into one.
const OPEN_PAIRS = new Set(['ia', 'io', 'iu', 'ua', 'uo', 'ao', 'eo']);

// Three consonants meet only where English already says them: Heddwyn,
// Eldrin, Solbryn, Selenshima.
const easyTriple = (tail, onset) => (tail.length === 2 && (onset === 'w' || (onset === 'r' && !tail.includes('r'))))
  || (tail.length === 1 && 'lrns'.includes(tail) && ['br', 'fr', 'gl', 'sh'].includes(onset));

/**
 * Join an opener's form to a closer's, or null where the seam would misread
 * or stick. A letter both sides share is said once (Sol + luna → Soluna).
 * @param {string} opener
 * @param {string} closer
 * @returns {string|null} lowercase joined form
 */
export const joinForms = (opener, closer) => {
  const tail = opener.match(/[^aeiouy]*$/)[0]; // y is a vowel inside an opener (lyr)
  const onset = closer.match(/^y?[^aeiouy]*/)[0]; // and a consonant opening a closer (yume), a vowel after (wyn)
  if (opener.slice(-2) === closer.slice(0, 2)) return null; // a stutter: Aur + urs, Luna + nami
  if (!tail && !onset) { // two vowels meet only where English keeps them two (Tomo + avi; never Kaze + ast, "east")
    const run = opener.match(/[aeiouy]*$/)[0] + closer.match(/^[aeiou]*/)[0];
    return run.length === 2 && OPEN_PAIRS.has(run) ? opener + closer : null;
  }
  if (!tail || !onset) return opener + closer;
  const last = tail.at(-1);
  if (onset[0] === 'y') return null; // Luc + yume reads "Lucy-ume"
  if (onset[0] === 'h' && !'lrnm'.includes(last)) return null; // ch, gh, sh, th: a new sound
  if (last === 'c' && 'cgkqs'.includes(onset[0])) return null; // Luc + kai reads "luck"
  const dropped = last === onset[0] ? 1 : 0;
  const rest = onset.slice(dropped);
  if (STOPS.includes(last) && rest && (STOPS + 'fv').includes(rest[0])) return null; // Sig + kai
  const cluster = tail + rest;
  if (cluster.length > 3 || (cluster.length === 3 && !easyTriple(tail, rest))) return null;
  return opener + closer.slice(dropped);
};

// pure — […], "golden lotus"
const englishOf = (opener, closer) => (opener.kind === 'a'
  ? `${opener.gloss} ${closer.gloss}`
  : `${closer.gloss} of ${opener.of}`);

/**
 * Whether two elements may make a name, and the name they make. Pure.
 * @returns {{ form: string, name: string } | null}
 */
export const composeName = (opener, closer) => {
  if (opener.id === closer.id || twice(opener, closer)) return null;
  const form = joinForms(opener.form, closer.form);
  if (!form || form.length > MAX_LETTERS || AVOID.some((w) => form.includes(w)) || across(form, opener.form.length)) return null;
  return { form, name: form[0].toUpperCase() + form.slice(1) };
};

const CLOSING = Object.freeze({ genesis: CLOSERS.genesis, soul: CLOSERS.genesis, house: CLOSERS.house });
export const NAME_KINDS = Object.freeze(Object.keys(CLOSING));

const spaces = new Map();
/** Every name one kind can take, in lexicon order — the space a seed walks. Pure (memoized). */
export const nameSpace = (kind) => {
  if (!CLOSING[kind]) throw new Error(`nameSpace: unknown kind "${kind}"`);
  if (!spaces.has(kind)) {
    const all = [];
    const formed = new Set(); // one name, one meaning: a second pair that spells it is left out
    for (const opener of OPENERS) {
      for (const closer of CLOSING[kind]) {
        const made = composeName(opener, closer);
        if (!made || formed.has(made.form)) continue;
        formed.add(made.form);
        all.push(Object.freeze({ ...made, opener, closer }));
      }
    }
    spaces.set(kind, Object.freeze(all));
  }
  return spaces.get(kind);
};

const indexes = new Map();
// pure (memoized) — each name of a kind, by its lowercase form
const byForm = (kind) => {
  if (!indexes.has(kind)) indexes.set(kind, new Map(nameSpace(kind).map((x) => [x.form, x])));
  return indexes.get(kind);
};

const part = (el) => Object.freeze({ form: el.form, lang: el.lang, language: LANGUAGES[el.lang], word: el.word, gloss: el.gloss });

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const roman = (n) => ROMAN.reduce((out, [v, s]) => { while (n >= v) { out += s; n -= v; } return out; }, '');

/**
 * The name a hex identity gives, with its meaning.
 *
 * Names already borne (taken) are walked past. So are, while any other name
 * is free, names that share a word with one already borne: a house's beings
 * do not echo each other (no Hoshiwyn beside Hoshimei).
 *
 * @param {string} hex - the identity material (genesis hash, wallet, soul mark); 0x optional
 * @param {{ kind: 'genesis'|'soul'|'house', taken?: Iterable<string> }} opts - taken: names already borne (any case)
 * @returns {{ name: string, scheme: string, parts: object[], english: string }}
 */
export const meaningfulName = (hex, { kind, taken = [] } = {}) => {
  const clean = String(hex ?? '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{6,}$/.test(clean)) throw new Error('meaningfulName needs at least 6 hex chars');
  const space = nameSpace(kind);
  const held = new Set([...taken].map((n) => String(n).toLowerCase()));
  const echoed = new Set([...held].flatMap((n) => {
    const borne = byForm(kind).get(n);
    return borne ? [borne.opener.id, borne.closer.id] : [];
  }));
  const fresh = (pick) => !echoed.has(pick.opener.id) && !echoed.has(pick.closer.id);
  const seed = BigInt(`0x${createHash('sha256').update(`${NAME_SCHEME}:${kind}:${clean.toLowerCase()}`).digest('hex')}`);
  const size = space.length;
  const start = Number(seed % BigInt(size));
  let stride = Number((seed >> 128n) % BigInt(size - 1)) + 1;
  while (gcd(stride, size) !== 1) stride = (stride % (size - 1)) + 1;
  // A stride coprime to the size visits every name once before repeating:
  // first for a name that echoes none borne, then for any name still free,
  // then (past every one) with an ordinal.
  const passes = [{ suffix: '', ok: fresh }, { suffix: '', ok: () => true }];
  for (let generation = 2; ; generation++) {
    for (const { suffix, ok } of passes) {
      for (let i = 0; i < size; i++) {
        const pick = space[(start + i * stride) % size];
        const name = pick.name + suffix;
        if (held.has(name.toLowerCase()) || !ok(pick)) continue;
        return Object.freeze({
          name, scheme: NAME_SCHEME, parts: Object.freeze([part(pick.opener), part(pick.closer)]), english: englishOf(pick.opener, pick.closer),
        });
      }
    }
    passes.splice(0, passes.length, { suffix: ` ${roman(generation)}`, ok: () => true });
  }
};

/**
 * One line saying what a given name means — its parts and the whole — or,
 * for a name with no parts (a v1 sound-name), what kind of name it is.
 * @param {string} name
 * @param {{ parts?: object[], english?: string } | null} meaning
 * @returns {string}
 */
export const describeGivenName = (name, meaning) => {
  if (!meaning?.parts?.length) return `${name} is a KOTODAMA sound-name: syllables made from the bytes of a birth or a wallet, with no word meaning.`;
  const parts = meaning.parts.map((p) => `${p.form}, from ${p.language} ${p.word} "${p.gloss}"`).join('; ');
  return `${name} means "${meaning.english}": ${parts}.`;
};
