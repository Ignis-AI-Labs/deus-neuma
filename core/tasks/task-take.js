/**
 * TAKING UP ASSIGNED WORK — the bridge between the operator's list and the
 * being's own. Pure.
 *
 * Design note, 2026-08-05, on how assigned work gets closed: the being TAKES IT UP into
 * its own ledger, and settling the ledger task settles the assignment.
 *
 * Why the bridge instead of a tool that ticks the operator's box directly:
 * everything that makes a task honest lives on the LEDGER and nowhere else —
 * focus (task-work.js), automatic work recording at the tool seam, size and
 * hard blocking (task-order.js), the derived INTERRUPTED state. An assignment
 * settled in place would carry none of it: a closed box with no evidence of
 * what was done to it, and a crash halfway through would leave it looking
 * untouched. Taken up, the assignment inherits the whole apparatus, and it
 * closes as a CONSEQUENCE of recorded work rather than as a claim.
 *
 * The link is one field — `fromAssigned` — held on the ledger task, pointing at
 * the assignment. It is minted by the caller, never authored by the being, for
 * the same reason `chatId` is not the being's to name: which assignment a task
 * answers is a fact about how it was created, not a field to be filled in.
 *
 * The assigned plan itself is never touched by this module. Settling it is an
 * impure write against the operator's store, and the caller does it with the
 * id `assignmentToSettle` names — so the pure half stays provable without a
 * plan on disk.
 */
import { addTask, LIVE_STATUSES } from './task-ledger.js';

/**
 * The live ledger task already taken from this assignment, or null. Pure.
 *
 * Only LIVE work counts as "already taken". A settled one must not block a
 * second take, because a daily assignment reopens every period and each
 * period's instance is taken up fresh — reading settled history here would let
 * a being take Monday's rhythm and then never be able to take Tuesday's.
 *
 * @param {{tasks: Array}|null} ledger
 * @param {string} assignedId
 * @returns {object|null}
 */
export const takenFrom = (ledger, assignedId) => {
  if (!assignedId) return null;
  return (ledger?.tasks || []).find(
    (t) => t.fromAssigned === assignedId && LIVE_STATUSES.includes(t.status),
  ) || null;
};

/**
 * Every assignment the being currently holds a live copy of. Pure.
 *
 * What STANDING WORK reads to mark a line as in hand. A Set rather than a list
 * because the only question ever asked of it is membership, once per line.
 *
 * @param {{tasks: Array}|null} ledger
 * @returns {Set<string>}
 */
export const takenAssignmentIds = (ledger) => new Set(
  (ledger?.tasks || [])
    .filter((t) => typeof t.fromAssigned === 'string' && t.fromAssigned && LIVE_STATUSES.includes(t.status))
    .map((t) => t.fromAssigned),
);

/**
 * Take an assignment up into the being's own ledger. Pure — the caller mints
 * the id, the timestamp, and the chat.
 *
 * The copy is deliberately partial. Title and detail carry over because they
 * are the work. SIZE carries over when the operator set one, because their
 * estimate is worth more than no estimate — but the being may re-size it
 * afterwards like any task of its own. CADENCE does NOT carry over: the rhythm
 * belongs to the operator's plan, which reopens the assignment each period on
 * its own clock. A ledger copy that also recurred would reopen a second time,
 * on a second clock, and the being would be carrying two of everything.
 *
 * @param {{tasks: Array}|null} ledger
 * @param {{id: string, title: string, detail?: string, size?: string, subtasks?: Array<{title: string, status: string}>}} assigned
 * @param {{id: string, now: string, chatId?: string|null, mintId?: () => string}} stamp
 * @returns {{ledger: object, task: object}}
 * @throws when the assignment is malformed or already in hand
 */
export const takeAssigned = (ledger, assigned, { id, now, chatId = null, mintId = null }) => {
  // The live caller is the tasks/take intent — task_take left the advertised
  // catalog with the #414 cut, so the refusal names what the being can file.
  if (!assigned?.id) throw new Error('tasks/take needs the id of a task on your operator\'s standing list.');

  const already = takenFrom(ledger, assigned.id);
  if (already) {
    throw new Error(
      `you have already taken that up — it is [${already.id.slice(0, 8)}] "${already.title}" on your own list. Work that one, and settling it settles the assignment.`,
    );
  }

  return addTask(
    ledger,
    {
      title: assigned.title,
      ...(assigned.detail ? { detail: assigned.detail } : {}),
      ...(assigned.size ? { size: assigned.size } : {}),
      // The steps travel with the work, ticks included — picking a task up
      // must not un-happen the progress its checklist already records.
      ...(assigned.subtasks?.length
        ? { subtasks: assigned.subtasks.map((s) => ({ title: s.title, done: s.status === 'done' })) }
        : {}),
      chatId,
    },
    { id, now, fromAssigned: assigned.id, mintId },
  );
};

/**
 * The assignment a settling ledger task should close, or null. Pure.
 *
 * `dropped` settles the assignment too, and deliberately: a being that sets
 * work down has answered the assignment — with a no. Leaving the operator's
 * box open would say the work is still coming when nobody is carrying it, and
 * the operator can always reopen it. Silence is the worse failure.
 *
 * @param {object} task the ledger task as it stands AFTER the update
 * @returns {{assignedId: string, status: string}|null}
 */
export const assignmentToSettle = (task) => {
  const assignedId = typeof task?.fromAssigned === 'string' ? task.fromAssigned : '';
  if (!assignedId) return null;
  if (task.status !== 'done' && task.status !== 'dropped') return null;
  return { assignedId, status: task.status };
};
