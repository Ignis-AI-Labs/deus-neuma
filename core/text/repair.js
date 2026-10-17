// repair.js — the deterministic repair grammar for dictated text.
//
// What a speech model hands back is a transcript, not prose: it has no
// sentence case (the operator's own screenshot, 2026-07-31, carries […] and […]), no closing
// punctuation, and every disfluency the mouth made ([…]).
//
// TWO TIERS, because they carry different risk (Founder's call, 2026-07-31):
//
//   autoRepair  — lexicon only. Fires the instant a transcript lands, with no
//                 asking, because a hit in ALWAYS_CONFUSED is by construction
//                 not a word the operator could have meant.
//   cleanUp     — the full pass. Runs ONLY on an explicit act (right-click →
//                 CLEAN UP), because sentence case, spacing, and filler
//                 removal all restructure words the operator really said.
//
// The composer must never silently rewrite the operator. That is the whole
// reason the tiers are split rather than fused behind one flag.
//
// SELECTIVITY OVER SENSITIVITY, inherited from text-integrity.js: every rule
// here is scoped to a shape that disfluency produces and prose does not.
// "uh"/"um" are not English and are struck anywhere; "like" and "you know"
// are struck ONLY comma-bounded, so […] survives untouched.
// Repeated words ("very, very") are LEFT ALONE — the corruption gate already
// established that emphatic repetition is real speech.
//
// Pure throughout — every function is inputs to outputs, no IO, no clock.

import { ALWAYS_CONFUSED, SUGGESTED_CONFUSIONS } from './lexicon.js';

// Disfluencies that are not English words: struck wherever they appear.
// Nothing legitimate collides with these, so the only care needed is the
// PUNCTUATION they leave behind. Commas on either side are eaten with the
// word, because in speech they only ever bracketed the disfluency itself —
// […] is […], not […]. A trailing PERIOD is
// deliberately spared: […] ends a sentence that still needs to end.
const NON_WORD_FILLER = /\s*,?\s*\b(?:uh+|um+|erm|mm+|hmm+)\b\s*,?\s*/gi;

// Disfluencies that ARE English: struck only in the comma-bounded interjection
// shape that speech produces and writing does not. `, like,` goes; `like a
// bridge` stays. The leading boundary is a comma or the start of the text.
const BOUNDED_FILLER = /(^|,)\s*(?:like|you know|i mean|sort of|kind of|right|so yeah|and stuff like that)\s*,/gi;

// Sentence-initial interjections: […] → […]. Only at a
// true sentence start (text start or after terminal punctuation).
//
// The opener may be TWO tokens before the comma — […], witnessed 2026-07-31. A single-token rule leaves the pair
// stranded, because neither half is comma-bounded on its own.
const LEADING_FILLER = /(^|[.!?]\s+)(?:like|so|and|but|well|yeah|okay|now)(?:\s+(?:like|so|yeah|well|uh|um))?\s*,\s*/gi;

// THE STAGGER (Design note, 2026-07-31: […]).
// Two shapes, both verbatim from that same message.
//
// SINGLE_LETTER_STUTTER — a one-letter word said twice ([…]). Deliberately the SAME regex text-integrity.js uses as
// DOUBLE_SINGLE_STUTTER (:97): that module DETECTS this shape and refuses the
// sample; this one REPAIRS it. Sharing the shape keeps the two from disagreeing
// about what a stutter is. No English repeats a one-letter word.
const SINGLE_LETTER_STUTTER = /\b([a-z])\s+\1\b/gi;

// PHRASE_RESTART — a 2-3 word phrase abandoned and begun again ([…]). Three guards keep it off real prose:
//   · 2-3 words, so legitimate single-word doubling ("had had", "that that")
//     is out of range;
//   · the repeat must be ADJACENT, separated by nothing but optional comma;
//   · the phrase must start LOWERCASE, which spares proper-noun repetition
//     ([…]) — a restart happens mid-flow, not at a name.
const PHRASE_RESTART = /\b([a-z][\w'’]*(?:\s+[\w'’]+){1,2})\s*,?\s+\1\b/g;

// A letter that should be capitalized: text start, or the first letter after
// terminal punctuation and whitespace. The witnessed defect is exactly this.
//
// AN ELLIPSIS IS NOT A SENTENCE BOUNDARY (fixed 2026-07-31). Dictation ends a
// clause in "..." when the speaker trails off and starts over — […]. Capitalizing there manufactures a sentence the operator
// never spoke ([…]) and reads as a new
// assertion, which is worse than the disfluency it replaced. The lookbehind
// spares the final dot of a run: a lone "." is preceded by a letter, the last
// dot of "..." is preceded by a dot.
const SENTENCE_START = /(^\s*|(?<!\.)[.!?]["'”’)\]]*\s+)([a-z])/g;

// The standalone first-person pronoun, which dictation routinely lowercases.
const LONE_I = /\b i \b/g;

// Is the token at `index` the first word of a sentence? Text start (ignoring
// leading whitespace) or anything following terminal punctuation. Pure.
const atSentenceStart = (text, index) => {
  const before = text.slice(0, index).replace(/\s+$/, '');
  return !before || /[.!?…]["'”’)\]]*$/.test(before);
};

/**
 * Replace every mis-heard domain word with its canonical spelling.
 *
 * CASE FOLLOWS SENTENCE POSITION, NOT THE HEARD TOKEN (fixed 2026-07-31 after
 * a real transcription proved the naive rule wrong). A speech model
 * capitalizes an unknown word as a proper noun by reflex — large-v3 returned
 * "The Numer spoke", "Numa", "Pneuma" — so adopting the heard case would turn
 * a mid-sentence "neuma" (a BEING) into "Neuma" (the PLATFORM). GLOSSARY.md
 * calls that distinction load-bearing and […] is
 * AGENTS.md Domain Language 6; propagating a transcriber's guess into it is
 * exactly the corruption this module exists to prevent.
 *
 * A canonical form that is intrinsically capitalized (Unavis, Natalis, LoRA)
 * carries its own case everywhere — position cannot lowercase a proper noun.
 *
 * Pure.
 * @param {string} text
 * @param {Object<string, string>} [map] - heard → canonical, lowercase keys
 * @returns {string}
 */
export const applyConfusions = (text, map = ALWAYS_CONFUSED) => {
  if (typeof text !== 'string' || !text) return '';
  const keys = Object.keys(map);
  if (keys.length === 0) return text;
  // Longest-first so a longer key is never shadowed by a shorter prefix.
  const pattern = keys.sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return text.replace(new RegExp(`\\b(${pattern})\\b`, 'gi'), (heard, _group, index) => {
    const canonical = map[heard.toLowerCase()];
    if (!canonical) return heard;
    if (canonical[0] !== canonical[0].toLowerCase()) return canonical; // proper noun
    return atSentenceStart(text, index)
      ? canonical[0].toUpperCase() + canonical.slice(1)
      : canonical;
  });
};

/**
 * Restore sentence case: capitalize the first letter of the text and of every
 * sentence after terminal punctuation, and raise the lone pronoun "i". Pure.
 * @param {string} text
 * @returns {string}
 */
export const restoreSentenceCase = (text) => {
  if (typeof text !== 'string' || !text) return '';
  return text
    .replace(SENTENCE_START, (_m, lead, letter) => lead + letter.toUpperCase())
    .replace(LONE_I, ' I ');
};

/**
 * Normalize whitespace and punctuation spacing: collapse runs of spaces, pull
 * punctuation back against the word it follows, guarantee one space after it,
 * and cap blank-line runs at one. Never touches newlines the operator meant.
 * Pure.
 * @param {string} text
 * @returns {string}
 */
export const normalizeSpacing = (text) => {
  if (typeof text !== 'string' || !text) return '';
  return text
    .replace(/[^\S\n]+/g, ' ')          // runs of spaces/tabs → one space (newlines survive)
    .replace(/\s+([,.;:!?])/g, '$1')    // no space BEFORE punctuation
    .replace(/([,.;:!?])(?=[^\s\d.,;:!?'"”’)\]])/g, '$1 ') // one space AFTER (decimals spared)
    .replace(/\n{3,}/g, '\n\n')         // at most one blank line
    .replace(/[^\S\n]*\n[^\S\n]*/g, '\n') // no trailing/leading space around newlines
    .trim();
};

/**
 * Strike dictation filler. Non-word disfluencies go anywhere; real English
 * fillers go only in the comma-bounded or sentence-initial interjection shape.
 *
 * LEADING_FILLER runs to a FIXED POINT because speech stacks interjections:
 * […] needs two passes, and a single global replace
 * gives only one — the regex resumes AFTER the text it consumed, so the
 * newly-exposed "yeah," no longer has a sentence boundary in front of it and
 * would be left stranded mid-clause. The loop is bounded by the fact that
 * every iteration strictly shortens the text.
 *
 * Pure.
 * @param {string} text
 * @returns {string}
 */
export const stripFiller = (text) => {
  if (typeof text !== 'string' || !text) return '';
  // The whole parenthetical goes, BOTH commas included: […]
  // → "it is hard". Keeping the leading comma ("$1 ") would strand it against
  // the next word. A space, not '', so an unspaced transcript cannot fuse two
  // words together; normalizeSpacing collapses the slack afterward.
  let out = text.replace(BOUNDED_FILLER, ' ');
  for (;;) {
    const next = out.replace(LEADING_FILLER, '$1');
    if (next === out) break;
    out = next;
  }
  return out
    // A space, not '': the pattern eats the whitespace around the disfluency,
    // so an empty replacement would fuse the words on either side.
    // normalizeSpacing collects the slack (including a space left before a
    // sentence-ending period) in the composed cleanUp pass.
    .replace(NON_WORD_FILLER, ' ')
    .replace(/,\s*(?=,)/g, '')            // two struck fillers leave doubled commas
    .replace(/(^|[.!?]\s*)\s*,\s*/g, '$1'); // a struck opener leaves a stranded comma
};

/**
 * Collapse THE STAGGER — the speaker begins, abandons, and begins again. A
 * stutter keeps one copy; a restarted phrase keeps one copy.
 *
 * Run to a FIXED POINT: a triple ("a a a") needs two passes, and stripping
 * filler out of […] exposes a stutter that was
 * not adjacent in the original. Every iteration strictly shortens the text, so
 * the loop terminates.
 *
 * NOT emphasis. "very, very" is two words, not one letter, and is not an
 * identical adjacent multi-word phrase — it matches neither shape, which is
 * the same line text-integrity.js draws between stutter and real speech.
 *
 * Pure.
 * @param {string} text
 * @returns {string}
 */
export const collapseStagger = (text) => {
  if (typeof text !== 'string' || !text) return '';
  let out = text;
  for (;;) {
    const next = out
      .replace(PHRASE_RESTART, '$1')
      .replace(SINGLE_LETTER_STUTTER, '$1');
    if (next === out) return out;
    out = next;
  }
};

/**
 * Close an unterminated final sentence with a period. A transcript ends when
 * the operator stopped speaking, which is not the same as ending a sentence
 * (witnessed: […]). A text already ending in
 * terminal punctuation — or in a fenced block, list, or colon, where a period
 * would be wrong — is returned unchanged. Pure.
 * @param {string} text
 * @returns {string}
 */
export const closeSentence = (text) => {
  if (typeof text !== 'string') return '';
  const trimmed = text.trimEnd();
  if (!trimmed) return trimmed;
  // The terminal set matches text-integrity.js endsUnfinished (:176) — the
  // ellipsis included. Two modules disagreeing about what ends a sentence is
  // how one of them starts appending periods to the other's clean output.
  if (/[.!?…:;,\-—)\]}"'”’]$/.test(trimmed)) return trimmed;
  if (/```|~~~/.test(trimmed)) return trimmed;          // structured content, not prose
  if (/\n\s*[-*+]\s|\n\s*\d+[.)]\s/.test(trimmed)) return trimmed; // a list's last item
  return `${trimmed}.`;
};

/**
 * TIER 1 — the automatic pass. Lexicon only: the mis-heard domain words the
 * operator provably did not mean. Safe to run on every arriving transcript
 * without asking, and deliberately does nothing else. Pure.
 * @param {string} text
 * @returns {string}
 */
export const autoRepair = (text) => applyConfusions(text);

/**
 * TIER 2 — the full pass, run only on an explicit act.
 *
 * ORDER IS LOAD-BEARING:
 *   confusions → the lexicon first, while tokens are still intact
 *   filler     → before case, so a struck leading "Like," does not leave the
 *                next word lowercase
 *   stagger    → AFTER filler, because striking ", like," is what makes the
 *                stutter adjacent: […]
 *                becomes […] and only then collapses
 *   spacing    → before the close, so the terminal period lands against the
 *                last word rather than after the slack
 *
 * Pure.
 * @param {string} text
 * @returns {string}
 */
export const cleanUp = (text) => {
  if (typeof text !== 'string' || !text.trim()) return typeof text === 'string' ? text : '';
  return closeSentence(
    restoreSentenceCase(
      normalizeSpacing(
        collapseStagger(
          stripFiller(
            applyConfusions(text),
          ),
        ),
      ),
    ),
  );
};

/**
 * Words the operator may have meant, offered rather than applied — the real
 * English forms in SUGGESTED_CONFUSIONS. The composer shows these; nothing
 * here ever rewrites the draft on its own. Pure.
 * @param {string} text
 * @returns {Array<{heard: string, canonical: string, index: number}>}
 */
export const suggestions = (text) => {
  if (typeof text !== 'string' || !text) return Object.freeze([]);
  const keys = Object.keys(SUGGESTED_CONFUSIONS);
  const pattern = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const found = [];
  for (const m of text.matchAll(new RegExp(`\\b(${pattern})\\b`, 'gi'))) {
    found.push(Object.freeze({
      heard: m[0],
      canonical: SUGGESTED_CONFUSIONS[m[0].toLowerCase()],
      index: m.index,
    }));
  }
  return Object.freeze(found);
};
