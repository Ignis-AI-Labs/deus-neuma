/**
 * THE TEST CONDITIONS (ruling, 2026-10-20). A test states its conditions before
 * it starts, the way a teacher says whether the calculator is allowed.
 *
 * On closed-book AA-Omniscience the HARNESS arm was never told the sitting was
 * closed-book: closed-book.js took the network tools out of its catalog and
 * refused them, but said nothing up front. So, unsure of an answer, the being
 * went looking: 185 tool searches for "web search" and 55 searches of an empty
 * ground over 155 questions, a round of prefill each, for nothing it could
 * reach. Founder: […]
 *
 * Only a benchmark sitting carries a line; every other prompt stays
 * byte-identical (''). Pure.
 */
import { isClosedBook } from './closed-book.js';

export const CLOSED_BOOK_CONDITIONS = 'TEST CONDITIONS: closed-book. Nothing in this sitting reaches the web or the network, so there is nothing to look up and no search tool to find: answer from what you know and what the task gives you.';

export const OPEN_BOOK_CONDITIONS = 'TEST CONDITIONS: open-book. The tools this sitting offers are yours to use, the ones that reach the network included.';

/** The sitting's test conditions: '' outside a benchmark sitting. Pure. */
export const testConditionsFor = (connection) => {
  if (!connection?._benchmarkControls) return '';
  return isClosedBook(connection) ? CLOSED_BOOK_CONDITIONS : OPEN_BOOK_CONDITIONS;
};
