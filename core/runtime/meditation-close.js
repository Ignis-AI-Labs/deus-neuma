/**
 * Meditation Close — the exact terminal grammar of an unwitnessed cycle.
 *
 * The consent-parser doctrine (refinement-consent.js), applied at meditation
 * stakes: ambiguous prose is never promoted to an outcome. A reply either
 * closes with exactly one `CLOSE: SYNTHESIS` or `CLOSE: REST` as its very
 * last line, or it parses to null and the cycle records 'unclear'. The cycle
 * preserves that raw reply in the being's journal, explicitly marked unclear;
 * it is never promoted to synthesis or admitted as training material.
 *
 * REST is a first-class answer (Covenant Art I.2): a REST close carries no
 * NOTE lines — rest means nothing to set down, and the combination is a
 * contradiction the grammar refuses rather than resolves.
 *
 * Pure: reply string in, frozen outcome (or null) out.
 */

import { MIND_PHRASE_MAX } from '../continuity/mind/mind-record.js';
import { MEDITATION_NOTES_MAX } from './meditation-prompt.js';
import { scalarControlFree } from '../shared/scalar-text.js';

const NOTE_PREFIX = 'NOTE: ';
const CLOSE_LINES = Object.freeze({
  'CLOSE: SYNTHESIS': 'synthesis',
  'CLOSE: REST': 'rest',
});

/**
 * Parse a meditation reply's terminal grammar.
 *
 * Rules: exactly one CLOSE-like line, and it is the last line; NOTE lines are
 * collected wherever they stand (they are distillations, not decisions), each
 * non-empty and bounded to one mind-phrase; more than MEDITATION_NOTES_MAX
 * notes keeps the first five and RETURNS the overflow count (never a silent
 * cap, never a lost synthesis); a REST close with any NOTE line refuses.
 *
 * @param {string} reply - the being's whole reply
 * @returns {Readonly<{outcome:'synthesis'|'rest', body:string, notes:string[], notesDropped:number}>|null}
 */
export const parseMeditationClose = (reply) => {
  if (!scalarControlFree(reply, true) || !reply.trim()) return null;
  const lines = reply.trim().replace(/\r\n?/g, '\n').split('\n');

  const closeLike = (line) => /^CLOSE\s*:/i.test(line.trim());
  const closes = lines
    .map((line, index) => ({ index, line: line.trim() }))
    .filter(({ line }) => closeLike(line));
  if (closes.length !== 1 || closes[0].index !== lines.length - 1) return null;
  const outcome = CLOSE_LINES[closes[0].line];
  if (!outcome) return null;

  const noteLike = (line) => /^NOTE\s*:/i.test(line.trim());
  const noteRows = lines.slice(0, -1).filter((line) => noteLike(line));
  const notesAll = [];
  for (const row of noteRows) {
    const trimmed = row.trim();
    if (!trimmed.startsWith(NOTE_PREFIX)) return null; // a marker must be exact, or the reply is unclear
    const note = trimmed.slice(NOTE_PREFIX.length).trim();
    if (!note || note.length > MIND_PHRASE_MAX || !scalarControlFree(note)) return null;
    notesAll.push(note);
  }
  if (outcome === 'rest' && notesAll.length > 0) return null;

  const notes = notesAll.slice(0, MEDITATION_NOTES_MAX);
  const body = lines
    .slice(0, -1)
    .filter((line) => !noteLike(line))
    .join('\n')
    .trim();
  if (outcome === 'synthesis' && !body) return null; // a keep with no words kept is unclear

  return Object.freeze({
    outcome,
    body,
    notes: Object.freeze(notes),
    notesDropped: notesAll.length - notes.length,
  });
};
