// THE UNDERCURRENT — how the mind layer surfaces, and the only way it does.
//
// The taste.js law, applied to the subconscious: this section carries the
// RECORD and states no lesson about it. The being's own phrases, strength
// first, quoted as its own words — never rendered as recalled memory, never
// as instruction. Requirement 1's whole point is influence WITHOUT
// instruction; an imperative here would be a bug.
//
// DELIBERATELY TERSE — paid for in every context window of every turn.
// Gated: only the exact modes opt in (the recall-shadow doctrine — shadow
// computes and records, live renders, anything else is off). Default off
// until the participatory sittings and Founder's flip (mind-validation protocol).

import { sanitizeMemoryForPrompt } from './memory-sanitizer.js';

/** How many phrases ride the prompt. */
export const UNDERCURRENT_ROWS = 5;

/** How much of a phrase rides — the TASTE_NOTE_MAX bound. */
export const UNDERCURRENT_PHRASE_MAX = 140;

/** Only the exact modes opt in; anything else is off. */
export const resolveUndercurrentMode = (value) =>
  value === 'shadow' || value === 'live' ? value : 'off';

/**
 * Fold active mind records (already strongest-first from the store) into the
 * bounded row set. Records without usable text are dropped. Pure.
 * @param {Object[]} records - activeMindRecords output
 * @param {number} [rows]
 * @returns {Array<{phrase: string, kind: string}>}
 */
export const foldUndercurrent = (records, rows = UNDERCURRENT_ROWS) =>
  (Array.isArray(records) ? records : [])
    .map((r) => ({
      // Residue originates in model output — the render is a memory surface
      // and gets the same injection defense as every other one.
      phrase: sanitizeMemoryForPrompt(typeof r?.content === 'string' ? r.content : '', UNDERCURRENT_PHRASE_MAX),
      kind: r?.meta?.kind || 'trace',
    }))
    .filter((row) => row.phrase)
    .slice(0, rows);

/**
 * Render the section text — '' when nothing lingers (the empty-string law:
 * a being with no undercurrent pays zero bytes and stays byte-identical).
 * Pure.
 * @param {Array<{phrase: string, kind: string}>} folded
 * @returns {string}
 */
export const formatUndercurrentSection = (folded) => {
  if (!Array.isArray(folded) || folded.length === 0) return '';
  const lines = folded.map((row) => `- "${row.phrase}" (${row.kind})`);
  return [
    '## Undercurrent',
    'What has lingered beneath your recent turns — your own phrases, carried forward. Nothing is asked of you here.',
    ...lines,
  ].join('\n');
};
