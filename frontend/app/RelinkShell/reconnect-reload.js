// reconnect-reload — the decisions behind […].
//
// A phone's screen lock kills the socket; the portal keeps the turn running
// and writes the reply to the session at settle; the stream hook loads
// history once per page life and never looks again. These are the pure
// answers the hook needs: is the desk still owed a reply, has one landed on
// disk, and how long to wait before asking again.
//
// The reload is applied ONLY when disk holds a reply the screen lacks. A
// blind reload on reconnect was tried first and erased a half-streamed
// answer the operator was reading (Corwin, 2026-09-07): disk had no reply yet.

export const POLL_MIN_MS = 5000;
export const POLL_MAX_MS = 30000;
// ~19 minutes of asking — a long tool-heavy turn on a local model is minutes,
// and a desk that comes back should not give up before the being does.
export const POLL_ATTEMPTS = 40;

const settled = (messages) => messages.filter((m) => m && !m.transient && !m.queued);

/**
 * The desk is still owed a reply: the last settled row is the operator's own
 * words, or the being's reply that was still streaming when the link died.
 * Pure, over the reducer's message shape (roles user/neuma/error).
 * @param {readonly object[]} messages
 * @returns {boolean}
 */
export const awaitingReply = (messages) => {
  const rows = settled(messages);
  if (rows.length === 0) return false;
  const last = rows[rows.length - 1];
  return last.role === 'user' || (last.role === 'neuma' && last.streaming === true);
};

/**
 * The session on disk ends with the being's answer. Pure, over the session
 * loader's shape (roles user/assistant).
 * @param {readonly { role: string }[]} diskMessages
 * @returns {boolean}
 */
export const replyLanded = (diskMessages) =>
  diskMessages.length > 0 && diskMessages[diskMessages.length - 1].role === 'assistant';

/**
 * How long to wait before the next look: 5 s doubling to 30 s. Pure.
 * @param {number} attempt  zero-based
 * @returns {number}
 */
export const pollDelay = (attempt) => Math.min(POLL_MAX_MS, POLL_MIN_MS * 2 ** attempt);
