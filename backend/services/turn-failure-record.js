// turn-failure-record.js — what a FAILED turn leaves in the session record.
//
// A turn can fail after the being has already spoken or acted: a provider
// that drops the stream on round two, a refusal after a tool ran. The words
// streamed to the operator and the acts are real, so the record keeps them —
// marked as failed, the same never-silently-erased law as the interrupt mark
// (portal-turn-input.js INTERRUPT_MARK). Without it the being's next turn sees
// an unanswered ask and has no memory of what it did. A failure that said
// nothing and did nothing leaves no take: the point stays a retryable ask.
//
// A leaf with no imports, shared by both seats (portal-stream.js via portal-turn-unfinished.js,
// witness-stream.js).

export const FAILED_MARK = '[this response failed before it finished — the turn ended in an error]';

/**
 * Pure — the session-record content for a turn that failed mid-answer.
 * @param {string} partial the words already streamed
 * @returns {string}
 */
export const composeFailedRecord = (partial) => (partial ? `${partial}\n\n${FAILED_MARK}` : FAILED_MARK);

/**
 * Pure — whether a failed turn has anything to record: words, or acts.
 * @param {string} fullResponse
 * @param {ReadonlyArray<Object>} tools the turn's act record
 * @returns {boolean}
 */
export const failureLeavesTake = (fullResponse, tools) => Boolean(fullResponse) || (tools?.length ?? 0) > 0;

/**
 * impure (mutates the error) — the words a dying stream already produced ride
 * its error, set once by the innermost attempt that knew them. Every caller
 * that accumulates a round's words only after the round completes would
 * otherwise lose exactly the words the operator just watched arrive.
 * @param {*} err
 * @param {string} said the attempt's streamed words
 * @returns {*} the same error
 */
export const withSpokenContent = (err, said) => {
  if (said && err && typeof err === 'object' && typeof err.spokenContent !== 'string') err.spokenContent = said;
  return err;
};

/**
 * Pure — the turn's settled words plus the dying round's, as the record keeps them.
 * @param {string} fullResponse words of the rounds that completed
 * @param {*} error the throw that ended the turn
 * @returns {string}
 */
export const spokenThrough = (fullResponse, error) => {
  const tail = typeof error?.spokenContent === 'string' ? error.spokenContent : '';
  if (!tail) return fullResponse;
  return fullResponse ? `${fullResponse}\n\n${tail}` : tail;
};
