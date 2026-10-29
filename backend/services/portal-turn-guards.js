// portal-turn-guards.js — what the neuma seat checks at the very top of a
// turn, before anything is resolved, persisted or asked: a bound being, the
// one-shot origin a watch set, and a retry asking to carry new attachments.
// A refusal is spoken OUT LOUD (portal-turn-input.js's refusal frames),
// never a silent drop.
//
// A leaf of the turn orchestrator (portal-stream.js), never importing it.
import { rejectRefusedTurn, rejectImageTurn } from './portal-turn-input.js';

export const UNBOUND_TURN_REASON = 'No being is bound to this portal — its bind was refused, so nothing may be spoken in its name. '
  + 'Choose a being you keep, then send again.';

/**
 * impure (sends the refusal) — a turn speaks for a bound being or not at all.
 * A refused bind leaves only the name the client sent, and the bare model
 * must never answer under it. A harness lane is bound like any other lane.
 * @param {Object} ws
 * @param {Object|null} companion the connection's companion
 * @param {string} companionName
 * @returns {boolean} true when the turn was refused
 */
export const refuseUnboundTurn = (ws, companion, companionName) => {
  if (companion?.neumaId) return false;
  rejectRefusedTurn(ws, companionName, UNBOUND_TURN_REASON);
  return true;
};

export const RETRY_ATTACHMENTS_REASON = 'A retry answers the point as it was recorded, so attachments cannot be added to it — '
  + 'send them as a new message.';

/**
 * impure (sends the refusal) — a retry runs against the RECORD (its words and
 * attachments come from the point on disk), so attachments riding a retry
 * frame would be silently dropped: the turn is refused instead.
 * @param {Object} ws
 * @param {string} companionName
 * @param {*} message the turn's frame
 * @returns {boolean} true when the turn was refused
 */
export const refuseRetryAttachments = (ws, companionName, message) => {
  if (typeof message === 'string' || !message?.retry) return false;
  if (!Array.isArray(message.attachments) || message.attachments.length === 0) return false;
  rejectImageTurn(ws, companionName, RETRY_ATTACHMENTS_REASON);
  return true;
};

/**
 * impure (clears it) — the origin a watch set for this turn, read once at the
 * turn's entry: a turn refused before its point lands must not leave it for
 * the operator's next message. A turn with no origin is the operator speaking,
 * which opens the chat to a new run of chat links (chat-link.js loop guard).
 * @param {Object} connection
 * @returns {string|null}
 */
export const takeTurnOrigin = (connection) => {
  const origin = connection._turnOrigin || null;
  connection._turnOrigin = null;
  if (!origin) connection._linkRun = 0;
  return origin;
};
