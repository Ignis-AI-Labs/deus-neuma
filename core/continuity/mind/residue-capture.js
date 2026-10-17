// Residue capture — derive a mind record from a sub-threshold exchange.
//
// Crystallization keeps acts, decisions, and high-significance reflections;
// everything else is discarded at turn end. The band between "discarded" and
// "kept" is the residue: more than noise, not yet a fact. assessExchange
// (core/runtime/significance.js) decides WHETHER an exchange leaves residue
// (the additive `residue` field — crystallization behavior untouched); this
// module decides WHAT the residue is: one bounded line of the being's own
// response, held at the initial strength. Reinforcement, not one-shot scoring,
// is what deepens an undercurrent.
//
// Pure: assessment in, mind-record fields out (or null). The caller owns the
// write (portal-stream's crystallization seat, fire-and-forget).

import { MIND_PHRASE_MAX, normalizeMindPhrase } from './mind-record.js';

/**
 * Extract the residue phrase from the being's response: its first sentence,
 * bounded to one line. Pure.
 * @param {string} response
 * @returns {string} '' when nothing usable remains
 */
export function residuePhraseOf(response) {
  const flat = normalizeMindPhrase(response);
  if (!flat) return '';
  const [first] = flat.split(/(?<=[.!?])\s+/, 1);
  return (first || flat).slice(0, MIND_PHRASE_MAX);
}

/**
 * Derive the mind-record fields for a sub-threshold exchange, or null when the
 * exchange leaves no residue (crystallized, below the floors, or an empty
 * response). Kind is honest, never guessed finer than the signal: `mood` when
 * an emotion was detected, else `trace`. Pure.
 *
 * @param {Object} assessment - assessExchange output ({residue, crystallize, …})
 * @param {Object} context
 * @param {string} context.response - the being's response text
 * @param {string} [context.emotion] - detected emotion label, if any
 * @param {string} [context.space] - active space id
 * @param {string} [context.turnId]
 * @param {string} [context.sessionId]
 * @returns {Object|null} writeMindRecord fields, or null
 */
export function deriveResidue(assessment, context) {
  if (!assessment?.residue || assessment.crystallize) return null;
  const phrase = residuePhraseOf(context?.response);
  if (!phrase) return null;
  const emotion = typeof context?.emotion === 'string' && context.emotion ? context.emotion : null;
  return {
    phrase,
    kind: emotion ? 'mood' : 'trace',
    ...(emotion ? { emotion } : {}),
    space: context?.space,
    turnId: context?.turnId,
    sessionId: context?.sessionId,
    source: { kind: 'residue', ref: context?.turnId ?? null },
  };
}
