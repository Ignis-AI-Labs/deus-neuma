/** Sequential witness dedup over REAL outcomes, with independent receipts. */
import { yieldForQueuedThought } from './queued-action-handoff.js';
import { processWitnessToolCalls } from './witness-tools.js';
import { heldRepeatResult } from './witness-tool-epochs.js';
import { heldCallResult, recordCallOutcome, recordIntentReceipts } from './portal-tool-epochs.js';
import { beginTurnOperation, finishTurnOperation } from './turn-operation-checkpoint.js';
import { scopeRecoveryCall } from './coding-recovery-repeat.js';
import { toolRepeatEvent } from './tool-repeat-event.js';
import { sendToolEvent } from './witness-tool-events.js';

/** impure - run fresh calls through the unchanged witness gates, in issue order. */
export const processWitnessToolBatch = async ({ ws, connection, calls, runtime, turn }) => {
  const results = [];
  const receipts = [];
  const signal = connection.activeTurn?.signal;
  for (const rawCall of calls) {
    if (signal?.aborted) {
      results.push(heldRepeatResult(rawCall));
      continue;
    }
    const call = await scopeRecoveryCall(rawCall, connection);
    const epoch = turn.epoch;
    const held = heldCallResult(turn, call, epoch);
    if (held) {
      results.push(held);
      sendToolEvent(ws, connection.companion, toolRepeatEvent(held));
      yieldForQueuedThought(connection, results);
      continue;
    }
    const operation = await beginTurnOperation(turn, call, epoch);
    let batch;
    try { batch = await processWitnessToolCalls(ws, connection, [call], runtime.tools, runtime.sandbox); }
    catch (error) {
      // Missing results leave durable uncertainty and stop turn-end settlement.
      await finishTurnOperation(turn, operation, null);
      throw error;
    }
    const result = batch[0] || heldRepeatResult(call);
    results.push(result);
    recordCallOutcome(turn, call, epoch, result);
    const settled = batch.slice(1);
    receipts.push(...settled);
    recordIntentReceipts(turn, settled);
    await finishTurnOperation(turn, operation, result);
    yieldForQueuedThought(connection, results);
  }
  return [...results, ...receipts];
};
