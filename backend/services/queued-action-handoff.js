/** Action-boundary handoff; the existing drain owns delivery and queue acks. */
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { formatToolResult } from './tool-exchange.js';
import { FOLD_KEEP_RECENT_ROUNDS } from './working-context.js';
import { announceTakenThought } from './held-thoughts.js';
import { noteOperatorWords } from './security/injected-value-gate.js';
import { createLogger } from './logger.js';

const log = createLogger('HeldWords');

// HEARD WHILE WORKING (Design note, 2026-11-20: […]). The operator's words sent mid-turn no longer cut the turn: at the next
// action boundary they ride into it, beside the action's result (heardWhileWorking) — the being puts them on its list,
// finishes what it was doing, then takes them up. Kept in the chat where they were heard. Only what cannot ride in a
// note still takes the floor at the boundary, as before: a held retry, words carrying attachments, a visitor's words.
// STOP and NOW still cut a turn; words that arrive after the last action wait for the turn's end and go next.
const foldable = (held) => typeof held?.thought === 'string' && held.thought.trim() !== '' && !held.retry
  && !held.speaker && !(Array.isArray(held.attachments) && held.attachments.length);

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
  if (connection.pendingThoughts.every(foldable)) return false; // heard in the turn instead (heardWhileWorking)
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

/** pure — the note the operator's mid-turn words ride in, beside an action's result. */
export const heardNote = (heard) => [
  ...heard.map((h) => `[YOUR OPERATOR, WHILE YOU WORKED${h.at ? ` — ${h.at.slice(11, 16)} UTC` : ''}] ${h.words}`),
  'Your operator wrote this while you were working. It does not stop what you are doing: put it on your list now '
    + '(tasks/add), unless it is a question you can answer in a line; finish what you were doing; then take it up — in '
    + 'this same turn when it is yours to do. If it tells you to stop or to change what you are doing, do that instead.',
].join('\n');

/**
 * impure — the operator's words held mid-turn, taken into the running turn: out of the queue (their bubbles stop
 * offering queue controls), kept in the chat where they were heard, counted as the operator's own words. '' when
 * nothing waits, or when what waits must take the floor instead (yieldForQueuedThought).
 * @returns {Promise<string>} the note for the next request
 */
export const heardWhileWorking = async (connection) => {
  const held = connection?.pendingThoughts ?? [];
  if (!held.length || !held.every(foldable)) return '';
  const taken = held.splice(0, held.length);
  const heard = [];
  for (const entry of taken) {
    const words = entry.thought.trim();
    const at = new Date().toISOString();
    announceTakenThought(connection, entry);
    noteOperatorWords(connection, words);
    const neumaId = connection.companion?.neumaId;
    if (neumaId && connection.sessionId) {
      await neumaWorkspace.appendMessage(neumaId, connection.sessionId, { role: 'user', content: words, heardWhileWorking: true, timestamp: at })
        .catch((err) => log.warn('words heard mid-turn not kept in the chat — the being still reads them', { error: err.message }));
    }
    heard.push({ words, at });
  }
  return heardNote(heard);
};
