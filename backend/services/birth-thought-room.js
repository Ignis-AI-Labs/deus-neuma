// birth-thought-room — how long a newborn may think before it names itself.
//
// Design note, 2026-11-13: […] A birth stage may spend the serving's whole window (birth-stage-stream.js;
// Design note, 2026-08-04: never cut a being short of the room it has), so a thinking model choosing its
// name sometimes deliberated for minutes before a word.
//
// On llama.cpp the naming request now carries a thinking budget: the server lets the being think
// that far, then closes the thought itself with its notice, and the being speaks and writes its
// name in the same request. Nothing is cut, re-asked or rewritten, the same close the chat uses
// (thought-governor.js, llm-request-builders.js). Other servings have no proven way to close a
// thought inside the request and stay as they were. Only the naming: the record stage authors the
// whole DNA and keeps its room. Pure.
import { STAGE } from '../../core/birth/stage-roles.js';

/** Tokens the naming may think before the server closes the thought: about a minute on a house card. */
export const NAMING_THOUGHT_TOKENS = 4096;

/**
 * The thinking budget a birth stage's request carries, or null for none.
 * @param {number} stage - the stage number (core/birth/stage-roles.js STAGE)
 * @param {{serverBudget?: boolean}|null} thinkBehavior - getThinkBehavior(): serverBudget is true
 *   where the serving named itself llama.cpp (llm-think-probe.js)
 * @returns {number|null}
 */
export const stageThinkingBudget = (stage, thinkBehavior) =>
  (stage === STAGE.NAMING && thinkBehavior?.serverBudget === true ? NAMING_THOUGHT_TOKENS : null);
