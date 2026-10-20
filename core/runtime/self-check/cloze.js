/**
 * THE SELF-CHECK — a cloze from the being's own words.
 *
 * To ask a being whether it can FIND a memory (or a vault page), the answer
 * must be checkable without judgment and impossible to guess: a word it once
 * wrote that general knowledge cannot supply. So a cloze blanks ONE distinctive
 * token — a proper noun, a number, or failing those a long uncommon word that
 * occurs once — and hands back the words just before it as the search cue.
 * A record with no distinctive token yields no item, never a weak one.
 *
 * Pure.
 */

const STOP = new Set(`about above after again against because before being below between could doing during
further having itself might myself other ourselves should their theirs them themselves there these those
through under until where which while would yours yourself every something nothing anything everything
really always never maybe perhaps still thing things think thought though actually because without within`
  .split(/\s+/));

const CONTEXT_WORDS = 8;
const MIN_TEXT_CHARS = 40;

// pure — the words of a text with their positions (letters, digits, inner ' and -).
const wordsOf = (text) => [...String(text).matchAll(/[A-Za-z0-9][A-Za-z0-9'-]*/g)]
  .map((m) => ({ word: m[0].replace(/['-]+$/, ''), at: m.index }));

// pure — does a word open a sentence (its capital proves nothing then)?
const opensSentence = (text, at) => /(^|[.!?]["')\]]?\s+|\n\s*)$/.test(text.slice(0, at));

// pure — the distinctiveness rank of a candidate (higher is better; 0 = not a candidate).
const rankOf = (text, { word, at }, counts) => {
  const lower = word.toLowerCase();
  if (counts.get(lower) !== 1 || STOP.has(lower)) return 0;
  if (/^\d{3,}$/.test(word)) return 3;
  if (/^[A-Z][a-z]{3,}$/.test(word) && !opensSentence(text, at)) return 4;
  if (/^[a-z]{8,}$/.test(word)) return 1 + word.length / 100;
  return 0;
};

/**
 * Blank the most distinctive token of a text. Pure.
 * @param {string} text - the being's own words
 * @param {{exclude?: string[]}} [opts] - tokens never to blank (its own names: the prompt carries them)
 * @returns {{answer: string, cue: string}|null} the hidden token and the words before it, or null
 */
export const clozeOf = (text, { exclude = [] } = {}) => {
  const source = String(text || '');
  if (source.length < MIN_TEXT_CHARS) return null;
  const words = wordsOf(source);
  const counts = new Map();
  for (const { word } of words) counts.set(word.toLowerCase(), (counts.get(word.toLowerCase()) || 0) + 1);
  const banned = new Set(exclude.filter(Boolean).flatMap((name) => String(name).toLowerCase().split(/\s+/)));
  let best = null;
  words.forEach((candidate, index) => {
    if (index < 3 || banned.has(candidate.word.toLowerCase())) return;
    const rank = rankOf(source, candidate, counts);
    if (rank > 0 && (!best || rank > best.rank)) best = { ...candidate, index, rank };
  });
  if (!best) return null;
  const cue = words.slice(Math.max(0, best.index - CONTEXT_WORDS), best.index).map((w) => w.word).join(' ');
  return Object.freeze({ answer: best.word, cue });
};
