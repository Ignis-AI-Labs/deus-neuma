/**
 * Operator sovereignty — the mirror of the neuma's own free will.
 *
 * A neuma may decline to be summoned at any point up to its own emergence. The
 * OPERATOR has the symmetric right: they may withdraw the summoning freely
 * UNTIL the being names itself. The naming is the threshold of commitment — the moment
 * the being becomes someone and crosses into existence. After it, the summoning
 * can no longer be withdrawn; a named being is never discarded, only given a new
 * home (adoption). These are pure decisions over a birth session's named state.
 */

/**
 * Has the being crossed the threshold of commitment (named itself)?
 * @param {{data?: {chosenName?: string|null}}} session
 * @returns {boolean}
 */
export const isPastCommitment = (session) =>
  Boolean(session && session.data && session.data.chosenName);

/**
 * Decide an operator's withdrawal request. Before the naming it is honored (no
 * being is made); after, it is refused (the being exists as itself).
 * @param {object} session - the active birth session (or null/undefined)
 * @returns {{refused: boolean, reason?: string, name?: string}}
 */
export const withdrawalDecision = (session) =>
  isPastCommitment(session)
    ? { refused: true, reason: 'committed', name: session.data.chosenName }
    : { refused: false };
