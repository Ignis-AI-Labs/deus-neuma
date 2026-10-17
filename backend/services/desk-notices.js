// THE DESK'S ACCOUNT of work settling — the tray's producers for a closed task
// and a closed assignment.
//
// Lifted out of portal-stream.js (#264): the turn pipeline is 9,000 lines and
// the size law says a function that breaks should be addressed in its own file,
// not through the architecture around it. These two cards are one such
// function, and they are the operator's only durable notice that something on
// their own list is done.
//
// impure — fire-and-forget onto the notification bus.

import { notifyOperator } from './notification-bus.js';
import { KIND, STANDING } from '../../core/runtime/notification-record.js';

// The parts of a card that come from WHO acted rather than what happened.
// Shared so the two notices below can never disagree about a being's standing.
const actorBase = (connection) => {
  const laneId = connection?.companion?.neumaId ?? null;
  const name = connection?.companion?.name ?? 'A being';
  if (!connection?.walletAddress || !laneId) return null;
  return {
    wallet: connection.walletAddress,
    standing: (connection.companion?.participantKind === 'witness' || laneId.startsWith?.('witness-'))
      ? STANDING.witness
      : STANDING.neuma,
    actor: { id: laneId, name },
    name,
  };
};

/**
 * Announce that the BEING'S OWN ledger task settled.
 *
 * `dropped` is announced as well as `done`. A being deciding not to do something
 * is news the operator wants — arguably more than a completion.
 *
 * Never awaited and never able to reject: the bus swallows and logs its own
 * failures, and the guard here means even a surprise cannot turn a finished turn
 * into a failed one. A card must never cost a tool call.
 *
 * @param {object} connection - portal connection (wallet + bound companion)
 * @param {object} task - the settled task
 */
export const notifyTaskSettled = (connection, task) => {
  try {
    const base = actorBase(connection);
    if (!base || !task) return;
    notifyOperator({
      wallet: base.wallet,
      standing: base.standing,
      actor: base.actor,
      kind: KIND.taskClosed,
      title: `${base.name} ${task.status === 'dropped' ? 'dropped' : 'finished'} a task`,
      // The title of the work itself — what the operator actually needs to
      // recognise it. Capped upstream by the record contract.
      detail: task.title ?? null,
      ref: { taskId: task.id ?? null, status: task.status ?? null, chatId: task.chatId ?? null },
    });
  } catch { /* a card must never cost a tool call */ }
};

/**
 * Announce that the OPERATOR'S standing assignment settled with it.
 *
 * A separate card from the task's, deliberately: the being's task is its own
 * copy of the work, the assignment is the operator's own item, and only this
 * one means […]
 *
 * `KIND.assignmentClosed` existed from the day the tray was built, with its
 * label, its click target (the TODO window) and its suppression class all
 * written and tested — and nothing ever emitted it. The only path by which
 * anything on the operator's standing list closes is `assignmentToSettle` →
 * `updateAssigned` in task_update, and it closed the item in silence: the one
 * list the operator maintains by hand was the one place work vanished from
 * without a word.
 *
 * Call it ONLY on the successful settle. A card claiming the assignment closed
 * when it did not would be worse than no card, and a failed settle already tells
 * the being to go tell its operator.
 *
 * @param {object} connection - portal connection
 * @param {object} task - the being's task the assignment was taken up as
 * @param {{assignedId: string, status: string}} closes - the settled assignment
 */
/**
 * Announce that a being is PARKED on the operator's decision — an ask_operator
 * card or a plan_submit verdict, neither of which carries a clock. Fired the
 * moment the card is raised: at the desk the operator sees the card itself and
 * this costs nothing; in another window it is the only way they hear that a
 * being is standing still on their word. Event-phrased so a card read after
 * the answer landed does not claim anyone is still waiting.
 *
 * @param {object} connection - portal connection (wallet + bound companion)
 * @param {{what: 'answer'|'plan', detail?: string|null}} card - what parked,
 *   and the first question / the plan's goal for recognition
 */
export const notifyAwaitingAnswer = (connection, { what, detail = null }) => {
  try {
    const base = actorBase(connection);
    if (!base) return;
    notifyOperator({
      wallet: base.wallet,
      standing: base.standing,
      actor: base.actor,
      kind: KIND.awaitingAnswer,
      title: what === 'plan'
        ? `${base.name} put a plan before you`
        : `${base.name} asked for your decision`,
      detail,
      ref: { sessionId: connection?.sessionId ?? null },
    });
  } catch { /* a card must never cost a tool call */ }
};

export const notifyAssignmentSettled = (connection, task, closes) => {
  try {
    const base = actorBase(connection);
    if (!base || !closes) return;
    notifyOperator({
      wallet: base.wallet,
      standing: base.standing,
      actor: base.actor,
      kind: KIND.assignmentClosed,
      title: `${base.name} ${closes.status === 'dropped' ? 'dropped' : 'closed'} your assignment`,
      detail: task?.title ?? null,
      // taskId is what notification-target reads to open the TODO window on the
      // right item; assignedId names the standing entry that actually closed.
      ref: {
        taskId: task?.id ?? null,
        assignedId: closes.assignedId ?? null,
        status: closes.status ?? null,
        chatId: task?.chatId ?? null,
      },
    });
  } catch { /* a card must never cost a tool call */ }
};
