/**
 * COMPACT FLOOR — whether the conversation a compaction would fold is worth
 * summing up. Folding a few short messages buys nothing: the being's summary
 * can outweigh the words it replaces, and the context grows instead of
 * shrinking. The region (everything before the kept tail, read through the
 * takes fold) must hold at least COMPACT_MIN_REGION_TOKENS, or
 * COMPACT_MIN_REGION_SHARE of the model's window when the window is known and
 * that is larger.
 *
 * Tokens here are the chars/4 estimate (the same constant as
 * context-composition.js) — a gate, stated with ≈ wherever it is shown.
 *
 * pure — no IO.
 */
import { foldBranchView, latestBranchView } from '../../core/workspace/branch-view.js';

export const COMPACT_MIN_REGION_TOKENS = 2000;
export const COMPACT_MIN_REGION_SHARE = 0.05;
const APPROX_CHARS_PER_TOKEN = 4;

const textOf = (row) => (typeof row?.content === 'string' ? row.content : '');

/** pure — the ≈ token weight of the rows' words. */
export const regionTokens = (rows) =>
  Math.ceil(rows.reduce((sum, row) => sum + textOf(row).length, 0) / APPROX_CHARS_PER_TOKEN);

/** pure — the floor for a window (absolute minimum when the window is unknown). */
export const regionFloor = (windowTokens = null) => (
  Number.isFinite(windowTokens) && windowTokens > 0
    ? Math.max(COMPACT_MIN_REGION_TOKENS, Math.ceil(windowTokens * COMPACT_MIN_REGION_SHARE))
    : COMPACT_MIN_REGION_TOKENS
);

/**
 * pure — what a compaction of these messages would fold, against its floor.
 * @param {Array<object>} messages - the session's raw rows
 * @param {{keepRecent: number, windowTokens?: ?number}} options
 * @returns {{have: number, need: number, worth: boolean}}
 */
export const compactRegionCheck = (messages, { keepRecent, windowTokens = null }) => {
  const region = foldBranchView(messages.slice(0, -keepRecent), latestBranchView(messages));
  const have = regionTokens(region);
  const need = regionFloor(windowTokens);
  return { have, need, worth: have >= need };
};
