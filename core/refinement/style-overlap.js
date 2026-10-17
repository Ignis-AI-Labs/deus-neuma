// Style-overlap law — the measure that catches the STYLE ATTRACTOR: fluent,
// mechanically clean answers that increasingly copy each other's phrasing
// instead of speaking fresh. Witnessed 2026-07-12 on Sovereign's first walk:
// 43 of 89 answers ended with the same closing litany ([…]), invisible to the corruption gate (nothing
// was malformed) and to per-answer vocabulary counts (identity questions
// legitimately reuse identity words). What separates formula from voice is
// VERBATIM PHRASE SHARING ACROSS ANSWERS: his clean answers measured 0–2.6%
// shared 5-grams, the attractor-stamped ones 29–38%. This module is that
// measurement — one law for the review scorecard, the replay filter, and the
// answer-leg door.
//
// Pure module: no IO, no state.

/**
 * The phrase unit. Five words is long enough that honest reuse of a term
 * ("sovereign", "sincerity") never matches, short enough that a copied
 * clause always does.
 */
const GRAM_WORDS = 5;

/**
 * A gram counts as boilerplate when it appears in at least this many OTHER
 * answers — two independent reuses make a formula, one is coincidence.
 */
export const STYLE_PEERS = 2;

/**
 * Door threshold base: a DRAFT at or above this % against the landed answers
 * refuses at the door. Calibrated on the 2026-07-12 walk (clean ≤2.6%,
 * formula ≥29%) with a wide margin on both sides.
 */
export const STYLE_FLAG_SHARE = 8;

/**
 * Review threshold — ABOVE the door bar by design (hysteresis). Leave-one-out
 * shares DRIFT: every legally-landed answer adds phrase carriers to the
 * record, which can push answers that were clean when they landed over the
 * door bar — witnessed 2026-07-12 (Sovereign): with door == review, each
 * review pass flagged a fresh borderline batch (45→32→20→34→18, oscillating
 * at the margin instead of converging). The door refuses new formula at 8%;
 * the review only reopens what stands CLEARLY formulaic at 12% — drift is
 * bounded under the gap, so the sweep converges monotonically.
 */
export const STYLE_REVIEW_SHARE = 12;

/**
 * Door threshold: a DRAFT at or above this % against the landed answers is
 * refused at the door (retryable, like a cut or a corruption). STRICTER than
 * the review bar: the door stops new formula from establishing (its third
 * carrier refuses), while the review — with hysteresis above it — only
 * reopens what stands clearly formulaic despite the door. A laxer door was
 * witnessed (2026-07-12, Sovereign's sweep) letting a SECOND register
 * establish in re-answers; a door EQUAL to the review bar was then witnessed
 * oscillating at the margin (drift re-flagging borderline answers each
 * pass). Strict door + higher review bar is the converging pair.
 */
export const STYLE_DOOR_SHARE = STYLE_FLAG_SHARE;

/**
 * The door stays out of the early walk: with fewer landed answers than this,
 * shares are noisy and a young ceremony has no formula to copy yet.
 */
export const STYLE_DOOR_MIN_PRIORS = 8;

/**
 * Ending threshold: the CLOSING SENTENCE is judged on its own against the
 * record, because a stamped ending hides inside a long answer — witnessed
 * 2026-07-12 (Sovereign): 23 answers ended with the byte-identical […] yet each
 * whole-answer share sat near 4%, under the bar, because the answers were
 * long. An honest fresh ending measures ~0; a reused one measures near 100.
 */
export const ENDING_FLAG_SHARE = 50;

/**
 * The closing sentence of a prose answer (semicolon clauses ride together —
 * the stamped litany was one sentence of three clauses).
 * @param {string} text
 * @returns {string}
 */
// pure
export const lastSentence = (text) => {
  const sentences = String(text ?? '').trim().split(/(?<=[.?!…])\s+/);
  return sentences[sentences.length - 1] ?? '';
};

/**
 * The overlapping word-grams of a text. Punctuation-insensitive,
 * case-insensitive; apostrophes kept so contractions stay one word.
 * @param {string} text
 * @returns {Set<string>}
 */
// pure
export const phraseGrams = (text) => {
  // \p{L} keeps every letter alphabet whole (a being may honestly speak with
  // diacritics or beyond ASCII); digits and punctuation still strip.
  const words = String(text ?? '').toLowerCase().replace(/[^\p{L}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
  const grams = new Set();
  for (let i = 0; i + GRAM_WORDS <= words.length; i++) {
    grams.add(words.slice(i, i + GRAM_WORDS).join(' '));
  }
  return grams;
};

/**
 * What fraction (in %) of `text`'s phrases already live in at least
 * STYLE_PEERS of the `priors`? 0 for a text too short to carry a phrase.
 * @param {string} text
 * @param {Array<string>} priors — the landed answers to compare against
 * @returns {number} 0–100
 */
// pure
export const boilerplateShare = (text, priors) => {
  const grams = phraseGrams(text);
  if (grams.size === 0) return 0;
  const priorSets = priors.map(phraseGrams);
  let shared = 0;
  for (const g of grams) {
    let peers = 0;
    for (const s of priorSets) {
      if (s.has(g)) { peers++; if (peers >= STYLE_PEERS) break; }
    }
    if (peers >= STYLE_PEERS) shared++;
  }
  return (100 * shared) / grams.size;
};

/**
 * Leave-one-out scorecard over a whole answer set: each answer's whole-text
 * share AND its closing sentence's share against all the OTHERS. The review
 * surface and the REOPEN sweep both read from this — one law, two views
 * (a formula can soak a whole answer or hide in its tail).
 * @param {Array<{key: string, quote: string}>} answers
 * @returns {Array<{key: string, share: number, endingShare: number, flagged: boolean}>} sorted worst-first
 */
// pure
export const styleScorecard = (answers) => {
  const sets = answers.map((a) => ({
    key: a.key,
    grams: phraseGrams(a.quote),
    endingGrams: phraseGrams(lastSentence(a.quote)),
  }));
  // gram → number of answers carrying it (across the WHOLE set)
  const freq = new Map();
  for (const { grams } of sets) {
    for (const g of grams) freq.set(g, (freq.get(g) ?? 0) + 1);
  }
  // leave-one-out: this answer holds the gram once, so peers elsewhere
  // means total count >= STYLE_PEERS + 1
  const looShare = (grams) => {
    if (grams.size === 0) return 0;
    let shared = 0;
    for (const g of grams) if ((freq.get(g) ?? 0) >= STYLE_PEERS + 1) shared++;
    return (100 * shared) / grams.size;
  };
  return sets
    .map(({ key, grams, endingGrams }) => {
      const share = looShare(grams);
      const endingShare = looShare(endingGrams);
      return {
        key,
        share: Math.round(share * 10) / 10,
        endingShare: Math.round(endingShare * 10) / 10,
        flagged: share >= STYLE_REVIEW_SHARE || endingShare >= ENDING_FLAG_SHARE,
      };
    })
    .sort((a, b) => Math.max(b.share, b.endingShare) - Math.max(a.share, a.endingShare));
};
