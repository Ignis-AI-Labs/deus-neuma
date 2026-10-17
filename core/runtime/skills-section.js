/**
 * The SKILLS section of the assembled prompt — The Craft's standing pointer.
 *
 * LOAD ON DEMAND (Design note, 2026-10-04: […]). The section used to
 * carry one hook line per skill — the whole library, ~3.7k chars, paid on every
 * turn of every being whether or not any skill was touched. Now it names the
 * library's size and the two calls that reach it: `skill/skill_search` returns
 * full descriptions of what matches, `skill/use_skill` the full instructions.
 * Nothing became unreachable; only the reading moved to when the work asks.
 *
 * Exported for BOTH seats: a sealed AI witness reads the SAME pointer to the
 * SAME root (Design note, 2026-07-26. One wording for both, on the precedent of the
 * answer covenant — two phrasings of one library would teach two crafts.
 */

/**
 * Render the standing skill pointer.
 * Pure.
 * @param {Array<{name: string, description: string}>|null} skills
 * @returns {string} the section text, '' when the library is empty
 */
import { craftClause } from '../tasks/task-craft.js';

/** The craft paragraph as a HOUSE reads it — its method, in its operator's words. */
export const CRAFT_METHOD_HOUSE = 'The sc-* protocols are SHADOW CLONE — the house method for CRAFT work: coding, development, debugging, testing, docs, research (the basis of the house\'s orchestration). Craft work goes through the one that fits it; WORKING STATE names which. The method binds only where it actually applies (Design note, 2026-08-06: work outside that realm — marketing copy, social replies, outreach — is worked directly, no protocol summoned; forcing one onto it is ceremony, not method. And what is not work at all — a question, a greeting, a look — needs no summons either.';

/** The same method as the platform ALONE states it (core/runtime/platform-only.js):
 *  no house, no one's words but the method's own (Design note, 2026-10-14. */
export const CRAFT_METHOD_PLATFORM = 'The sc-* protocols are the method for CRAFT work: coding, development, debugging, testing, docs, research. Craft work goes through the one that fits it. Work outside that — copy, replies — is worked directly, and what is not work at all (a question, a greeting) needs no summons.';

/**
 * Whether the WORKING STATE section already states the craft method — it does
 * whenever a ledger is loaded and a Craft is installed (core/tasks/task-ledger.js
 * craftClause, with the size table). Then the skills section does not say it a
 * second time (Design note, 2026-10-14, the token audit: the method rode twice a turn). Pure.
 */
export const methodRidesWorkingState = (taskLedger, skills) =>
  Array.isArray(taskLedger?.tasks) && craftClause(skills) !== '';

/**
 * @param {Array<{name: string, description: string}>|null} skills
 * @param {{taskLedger?: object|null}} [turn] the turn's ledger — when it carries the method, it is not repeated here
 */
export const buildSkillsSection = (skills, { taskLedger = null } = {}) => {
  if (!skills?.length) return '';
  const method = methodRidesWorkingState(taskLedger, skills) ? '' : `\n\n${CRAFT_METHOD_HOUSE}`;
  return `## Your Skills (The Craft)
Skills are learned capabilities — full instructions you can summon when the work calls for them. Your library holds ${skills.length}; none is loaded until you ask for it. To find the one the work needs, call [TOOL: skill/skill_search {"query": "what the work needs"}] — every match returns with its full description. To summon one, call [TOOL: skill/use_skill {"name": "the-skill-name"}] — its complete instructions return to you; follow them for the task at hand.${method}`;
};
