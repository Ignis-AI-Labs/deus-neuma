/**
 * Witness desk notices — the operator-facing records of a witness turn's end.
 * Extracted from witness-stream.js under the size law (the stream file is at
 * its frozen baseline): the stream owns the turn; this module owns the notice.
 */
import { notifyOperator } from './notification-bus.js';
import { KIND, STANDING } from '../../core/runtime/notification-record.js';

/**
 * THE DESK'S ACCOUNT of a witness turn ending. impure, fire-and-forget.
 *
 * `standing: witness` is stamped unconditionally here, and that is the point:
 * this lane serves sealed third-party models, which stand BESIDE the house and
 * are never housemates. The record carries the distinction so the tray cannot
 * lose it, and so a record written today is still classifiable years from now.
 */
export const notifyWitnessTurnEnded = (connection, laneId, companionName, sessionId, take, interrupted) => {
  try {
    if (!connection?.walletAddress || !laneId) return;
    notifyOperator({
      wallet: connection.walletAddress,
      kind: interrupted ? KIND.turnInterrupted : KIND.turnDone,
      standing: STANDING.witness,
      title: interrupted
        ? `${companionName} was interrupted`
        : `${companionName} finished a turn`,
      actor: { id: laneId, name: companionName },
      ref: { sessionId: sessionId ?? null, turnId: take?.turnId ?? null },
    });
  } catch { /* a card must never cost a turn */ }
};
