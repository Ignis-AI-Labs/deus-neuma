// refine.js — REFINE: dictated words shaped into readable text, every word kept.
//
// Design note, 2026-10-10: […]. His calls: a REFINE button (never automatic — the composer never
// silently rewrites the operator, 2026-07-31) and SHAPE ONLY: punctuation,
// sentence breaks, paragraphs, capitals; […]/[…] and stutters dropped; every
// other word his. A model does the shaping (a run-on has no punctuation to
// repair deterministically); this module holds its instruction and the guard
// that PROVES the words survived — a refinement that changed a word is refused.
//
// Pure throughout.

import { applyConfusions } from './repair.js';

export const REFINE_PROMPT = [
  'You format dictated speech. The user message is a raw transcript of someone talking.',
  'Return the SAME words with punctuation, capital letters, sentence breaks, and paragraph',
  'breaks (a blank line between paragraphs where the topic turns). Remove only the sounds',
  '"um", "uh", "erm", "hmm", and a word or short phrase repeated by accident right after',
  'itself ("I I need" becomes "I need"). Change nothing else: do not add, remove, reorder,',
  'or replace any other word, do not fix grammar, do not turn spoken numbers into digits,',
  'keep slang and swearing exactly. Output only the formatted text — no preface, no quotes.',
].join(' ');

// Sounds the shaping may strike (repair.js NON_WORD_FILLER's set).
const STRIKABLE = new Set(['uh', 'uhh', 'um', 'umm', 'erm', 'hmm', 'hm', 'mm', 'mmm']);

/** Lowercase word sequence; punctuation and apostrophes folded away. */
const wordsOf = (text) => String(text ?? '')
  .toLowerCase()
  .replace(/[’']/g, '')
  .split(/[^a-z0-9]+/)
  .filter(Boolean);

/** A sequence with strikable sounds dropped and adjacent repeats (1–3 words) collapsed. */
const essence = (words) => {
  const out = words.filter((w) => !STRIKABLE.has(w));
  let changed = true;
  while (changed) {
    changed = false;
    for (let n = 3; n >= 1; n -= 1) {
      for (let i = 0; i + 2 * n <= out.length; i += 1) {
        const a = out.slice(i, i + n).join(' ');
        const b = out.slice(i + n, i + 2 * n).join(' ');
        if (a === b) { out.splice(i + n, n); changed = true; }
      }
    }
  }
  return out;
};

/**
 * Did the refinement keep the speaker's words? Both sides reduce to their
 * essence (strikable sounds out, accidental repeats collapsed, the lexicon's
 * certain mis-hearings repaired); they must then be the same sequence.
 * @param {string} original
 * @param {string} refined
 * @returns {boolean}
 */
export const keptWords = (original, refined) => {
  const a = essence(wordsOf(applyConfusions(original)));
  const b = essence(wordsOf(refined));
  return a.length > 0 && a.length === b.length && a.every((w, i) => w === b[i]);
};

/** Model output → the text alone: a stray preface line or wrapping quotes dropped. */
export const cleanRefined = (raw) => String(raw ?? '')
  .replace(/^\s*(here is|here's)[^\n]*:\s*\n/i, '')
  .replace(/^\s*["“]([\s\S]*)["”]\s*$/, '$1')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
