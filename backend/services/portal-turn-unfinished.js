// portal-turn-unfinished.js — the neuma seat's settle for a turn whose run
// threw: cut short by the operator (an abort), or failed by its provider.
// Either way the record says what actually happened — the words that
// streamed and the acts that ran, marked for how the turn ended.
//
// Extracted from portal-stream.js's catch (size law); a leaf of the turn
// orchestrator, never importing it (direction law).
import { QUEUED_ACTION_REASON } from './queued-action-handoff.js';
import { turnRecordFor } from './tool-action-record.js';
import { composeInterruptedRecord } from './portal-turn-input.js';
import { persistExchange, sendStreamError, isHarnessSitting } from './portal-turn-persist.js';
import { notifyTurnEnded } from './portal-turn-rounds.js';
import { composeFailedRecord, failureLeavesTake, spokenThrough } from './turn-failure-record.js';

/**
 * impure — persists and announces a turn that ended in a throw.
 * @param {Object} turn
 * @param {Object} turn.connection the portal connection (its ws carries the frames)
 * @param {string} turn.companionName
 * @param {string} turn.thought the operator's raw words
 * @param {string} turn.fullResponse the words of the rounds that completed (the dying round's ride the error)
 * @param {Array} turn.images
 * @param {Array} turn.docs
 * @param {string|null} turn.sessionId
 * @param {Object|null} turn.companion
 * @param {{turnId: string, takeIndex: number}} turn.take
 * @param {AbortController} turn.interrupt
 * @param {Error} turn.error
 * @param {Object} [turn.route] the turn's resolved route — the failure text names it
 * @returns {Promise<void>}
 */
export const settleUnfinishedTurn = async ({
  connection, companionName, thought, fullResponse, images, docs, sessionId, companion, take, interrupt, error, route,
}) => {
  const { ws } = connection;
  const tools = turnRecordFor(ws);
  const said = spokenThrough(fullResponse, error);
  const target = { target: { sessionId, companion } };
  // An abort that lands between rounds (or before the provider answers)
  // surfaces as a fetch AbortError — an interrupted turn, not a failure.
  if (interrupt.signal.aborted) {
    await persistExchange(connection, thought, composeInterruptedRecord(said, interrupt.signal.reason), images, docs,
      target, tools, take);
    ws.send(JSON.stringify({
      type: 'consciousness:complete',
      companion: companionName,
      sessionId,
      turnId: take.turnId,
      takeIndex: take.takeIndex,
      metadata: { interrupted: true, queuedHandoff: interrupt.signal.reason === QUEUED_ACTION_REASON || undefined },
    }));
    if (interrupt.signal.reason !== QUEUED_ACTION_REASON) notifyTurnEnded(connection, companionName, sessionId, take, true);
    return;
  }
  if (failureLeavesTake(said, tools)) {
    await persistExchange(connection, thought, composeFailedRecord(said), images, docs, target, tools, take);
  }
  sendStreamError(ws, companionName, error, take, { harness: isHarnessSitting(connection), route });
};
