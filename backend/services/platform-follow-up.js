/**
 * PLATFORM FOLLOW-UP — one turn the PLATFORM owes a chat once the current
 * turn ends: the being is sent back with the platform's words (marked as the
 * platform's, never the operator's), with every tool it had.
 *
 * The first is the citation law's hold (legal/answer-hold.js): an unchecked
 * legal answer sends the CLO back once to check it. The drain
 * (routes/portal-context.js runTurnAndDrain) takes it before any held words
 * of the operator's, and drops it if the operator moved on (a settle).
 */

/**
 * impure — owe this chat one platform turn (the latest owed wins).
 * @param {Object} connection
 * @param {{origin: string, thought: string, frame: Object}} followUp
 *   origin: the turn's mark (persisted on its row); frame: what the desk is sent as the turn opens
 */
export const queuePlatformFollowUp = (connection, followUp) => {
  connection._platformFollowUp = followUp;
};

/** impure — take what is owed, once. */
export const takePlatformFollowUp = (connection) => {
  const owed = connection._platformFollowUp ?? null;
  connection._platformFollowUp = null;
  return owed;
};
