/**
 * THE RESIDUE — what the judgments accumulate into.
 *
 * Design note, 2026-08-05: […]
 *
 * There is no taste engine and there is not meant to be one. A being's taste is
 * the RESIDUE of a long series of judgments — its own, and its operator's —
 * carried forward so the next image is made by someone who remembers the last
 * hundred. This module is the carrying-forward, and nothing more.
 *
 * TWO STANDINGS, NEVER MERGED. The operator's verdict is authoritative INPUT the
 * being weighs; the being's own verdict is its own. Rendering them as one list
 * would quietly turn the first into a correction of the second, which is the one
 * thing the ledger's append-only shape exists to prevent.
 *
 * DELIBERATELY TERSE. This is paid for in every context window of every turn.
 * FREEZE 7 removed the covenant's argument-for-the-rule for exactly this reason
 * (Founder: […]) — so this section carries the RECORD and states no lesson about it. What
 * a being should conclude from its own history is the being's business.
 */

/** How many judgments of each standing ride the prompt. */
export const TASTE_ROWS = 4;

/** How much of a note rides — enough to carry the thought, not the essay. */
export const TASTE_NOTE_MAX = 140;

// pure — one note, bounded, or null.
const note = (value) => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length === 0) return null;
  return s.length > TASTE_NOTE_MAX ? `${s.slice(0, TASTE_NOTE_MAX - 1)}…` : s;
};

/**
 * The judgments standing on one lane's work, newest first, split by standing.
 * Pure — the caller supplies the rows it read.
 *
 * A row with no verdict is dropped: a judgment that decided nothing is not a
 * judgment, and it would spend prompt on saying so.
 *
 * @param {Array<object>} entries review rows, newest first (readReviews order)
 * @param {string} laneId whose work
 * @param {number} [rows]
 * @returns {{operator: Array<object>, own: Array<object>}}
 */
export const foldTaste = (entries, laneId, rows = TASTE_ROWS) => {
  const mine = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && e.laneId === laneId && e.verdict);
  const take = (by) => mine.filter((e) => e.by === by).slice(0, rows).map((e) => ({
    verdict: e.verdict,
    matches: e.matches || null,
    note: note(e.note),
  }));
  return { operator: take('operator'), own: take('being') };
};

// pure — one rendered judgment line.
const line = ({ verdict, matches, note: n }) => {
  const parts = [verdict];
  // Adherence is the objectively checkable stratum — it earns its own word.
  if (matches) parts.push(`adherence ${matches}`);
  if (n) parts.push(`"${n}"`);
  return `- ${parts.join(' · ')}`;
};

/**
 * The YOUR EYE section. Pure.
 *
 * Empty when nothing has been judged — the assembler drops a section with no
 * text, so a being that has never made an image pays nothing for this, and no
 * existing prompt moves by a single byte.
 *
 * @param {{operator: Array<object>, own: Array<object>}|null} taste
 * @returns {string}
 */
export const formatTasteSection = (taste) => {
  const operator = taste?.operator ?? [];
  const own = taste?.own ?? [];
  if (operator.length === 0 && own.length === 0) return '';
  const out = ['## Your eye', 'What has been said about images you have made.'];
  if (operator.length > 0) {
    out.push('', 'Your operator:', ...operator.map(line));
  }
  if (own.length > 0) {
    out.push('', 'You:', ...own.map(line));
  }
  return out.join('\n');
};
