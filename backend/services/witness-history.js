/** Whole-message witness replay; session storage is never truncated. */

import { RECENT_TOTAL_CHARS } from '../../core/runtime/memory-section.js';

// THE FALLBACK LAW (#528 Stage D): when no window can be named, the tail is
// exactly what it has always been — ten whole messages inside 32,000 chars,
// byte-identical. A NAMED window's tail is the window's truth instead
// (sessionTailBudgetFor — Stage A's law, shared with the portal lane), and
// the row count degrades to a sanity bound, the same move RECENT_ROWS made.
const FALLBACK_MESSAGES = 10;
const FALLBACK_TAIL_CHARS = RECENT_TOTAL_CHARS;
/** The row sanity bound when the character budget is the real gate. */
export const WITNESS_RECENT_MESSAGES_SANITY = 2000;

/**
 * Select a contiguous tail from already folded, filtered chat rows. Pure.
 * The newest exchange (last user through its replies) is indivisible, even if
 * it alone exceeds the allowance; silently cutting that exchange would change
 * its meaning. Whole messages only — this lane has no per-row beheading, and
 * never did. A compacted session's summary entry rides as an assistant row —
 * the reading the portal lane gives it (the being's own condensed words).
 * @param {Array<{role: string, content: string}>} messages validated chat rows
 * @param {Object} [budget]
 * @param {number|null} [budget.tailChars] - the character budget; absent or
 *   non-finite → the fallback law's 32,000
 * @param {number|null} [budget.maxMessages] - the row bound; absent → the
 *   fallback law's ten
 * @returns {Array<{role: string, content: string}>} original whole message text
 */
export const witnessHistoryTail = (messages, { tailChars = null, maxMessages = null } = {}) => {
  if (!messages.length) return [];
  const budget = Number.isFinite(tailChars) && tailChars > 0 ? tailChars : FALLBACK_TAIL_CHARS;
  const rowBound = Number.isInteger(maxMessages) && maxMessages > 0 ? maxMessages : FALLBACK_MESSAGES;
  const newestUser = messages.findLastIndex((message) => message.role === 'user');
  let start = newestUser < 0 ? messages.length - 1 : newestUser;
  let chars = messages.slice(start).reduce((sum, message) => sum + message.content.length, 0);
  const earliest = Math.max(0, messages.length - rowBound);
  while (start > earliest) {
    const nextChars = chars + messages[start - 1].content.length;
    if (nextChars > budget) break;
    chars = nextChars;
    start -= 1;
  }
  return messages.slice(start).map(({ role, content }) => ({
    role: role === 'user' ? 'user' : 'assistant',
    content,
  }));
};
