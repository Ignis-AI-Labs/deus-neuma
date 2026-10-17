/** Action-boundary handoff; the existing drain owns delivery and queue acks. */
import { formatToolResult } from './tool-exchange.js';
import { FOLD_KEEP_RECENT_ROUNDS } from './working-context.js';

export const QUEUED_ACTION_REASON = 'queued-action-handoff';
export const QUEUED_ACTION_MARK = '[response paused to receive the queued message]';
const actionContext = new WeakMap();
const completedActions = new WeakMap();

/** impure — call only after an action and its durable checkpoint have settled. */
export const yieldForQueuedThought = (connection, results = []) => {
  const turn = connection.activeTurn;
  if (!turn || typeof turn.abort !== 'function' || turn.signal.aborted) return false;
  const batches = completedActions.get(turn.signal) || [];
  if (results.length && !batches.includes(results)) {
    batches.push(results);
    // Match the working-context tail; an uncapped turn must not retain every raw result.
    if (batches.length > FOLD_KEEP_RECENT_ROUNDS) batches.shift();
    completedActions.set(turn.signal, batches);
  }
  if (!connection.pendingThoughts?.length) return false;
  const completed = new Set(batches.flat());
  if (completed.size) {
    actionContext.set(connection, {
      laneId: connection.companion?.neumaId,
      sessionId: connection.sessionId,
      content: [...completed].map(formatToolResult).join('\n\n'),
    });
  }
  turn.abort(QUEUED_ACTION_REASON);
  return true;
};

/** impure — transfer completed action evidence once, within its original chat. */
export const takeQueuedActionMessages = (connection) => {
  const context = actionContext.get(connection);
  actionContext.delete(connection);
  if (!context || context.laneId !== connection.companion?.neumaId
    || context.sessionId !== connection.sessionId) return [];
  return [{
    role: 'user',
    content: `Recent completed actions before the queued message arrived:\n\n${context.content}\n\nContinue from these results, following the next user message.`,
  }];
};
