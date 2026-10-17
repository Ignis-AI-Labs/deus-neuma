// stream-tasks-view.js — pure shaping for the stream's task rail.
//
// The rail answers one question while the operator is mid-conversation: what is
// THIS being carrying right now? Two registers, because they are two different
// facts and must never blur:
//
//   NOW           what the being took on ITSELF and is actively working (its own
//                 ledger). The operator watches this; it is not theirs to settle.
//   STANDING WORK what the operator ASSIGNED, grouped by cadence. Settling lives
//                 here, because this is the operator's own list.
//
// A foot line names the rest of the house — who else has live work — so the rail
// stays about the conversation in front of you without hiding the others.
//
// Kept free of React/DOM so every decision here is provable with real inputs.

import { groupLiveTasks, subtaskProgress } from './todo-view.js';
import { chatOf, isLaneWide } from '../../../core/tasks/task-chat.js';
import { taskState, isChecked, workSummary, focusedTaskId } from '../../../core/tasks/task-work.js';
import { blockersOf, sizeLabel, orderBySize } from '../../../core/tasks/task-order.js';

/**
 * Narrow a list to the chat the stream is bound to, plus whatever stands
 * lane-wide — the SAME law the prompt obeys (core/tasks/task-chat.js), so the
 * rail shows the operator exactly what the being is being shown. With no chat
 * bound, nothing is narrowed: a missing chat is not evidence that work belongs
 * elsewhere, so it never hides any.
 *
 * A FILTER, not a partition: `splitByChat` answers "which bucket", and
 * rebuilding a list from its buckets would sort every chat-specific row above
 * every lane-wide one. The rail reports the order the store gave it — that
 * order is the being's own, and re-sorting it would be the rail inventing a
 * priority nobody set. `isLaneWide` is the shared law, so this surface and the
 * TASKS window can never disagree about what stands everywhere.
 * @param {Array<object>|null|undefined} tasks
 * @param {string|null} chatId
 * @returns {Array<object>}
 */
export const inChat = (tasks, chatId) => {
  const list = Array.isArray(tasks) ? tasks : [];
  if (!chatId) return list;
  return list.filter((task) => isLaneWide(task) || chatOf(task) === chatId);
};

/** The rail's header: the being it is about, or the bare word when there is none. */
export const railTitle = (being) =>
  (being ? `TASKS // ${String(being.name || being.neumaId).toUpperCase()}` : 'TASKS');

/**
 * How much live work a plan holds — open assigned tasks only. Used for the
 * rail's own count and for every other being's count in the foot.
 * @param {{tasks?: Array<{status: string}>}|null} plan
 * @returns {number}
 */
export const liveCount = (plan) =>
  (Array.isArray(plan?.tasks) ? plan.tasks : []).filter((t) => t?.status === 'open').length;

/**
 * The being's OWN live work, each row carrying the state it should READ as.
 *
 * The box is a MARK, not a control (Design note, 2026-08-03: the operator reads
 * whether a goal is met, and settling a being's self-authored task still goes
 * through the being. So every row answers one question — where is this? —
 * rather than offering an act the operator does not own.
 *
 * Ordered by what deserves the eye: what is being worked NOW, then what was
 * left half-finished, then what has merely been taken on, and last what cannot
 * be started at all. A pile of undifferentiated bullets was the complaint this
 * answers.
 *
 * BLOCKED sinks below everything workable but is never hidden — it is the
 * reason another task matters — and it is carried BESIDE the state rather than
 * folded into it, so a half-worked task that has since become blocked still
 * reports both facts.
 *
 * `order` is the operator's own preference (heaviest / lightest / mine) and
 * applies only WITHIN a state band. Which task is being worked right now is a
 * fact about the work, not a taste, so no sort may push it down the list.
 *
 * @param {{tasks?: Array, focus?: object}|null} ledger the CHAT-NARROWED ledger
 * @param {string|null} chatId
 * @param {boolean} streaming whether a turn is live right now
 * @param {{all?: Array, order?: string}} [opts] `all` is the WHOLE ledger's
 *   tasks — blockers are resolved against it, never against the narrowed slice,
 *   because a task in this chat may wait on work taken up in another one.
 * @returns {Array<{id, title, size, state, checked, blockers, done: object|null}>}
 */
export const ownRows = (ledger, chatId, streaming = false, { all = null, order = 'mine' } = {}) => {
  const focusedId = focusedTaskId(ledger, chatId);
  const list = Array.isArray(ledger?.tasks) ? ledger.tasks : [];
  const whole = Array.isArray(all) ? all : list;
  const live = list.filter((t) => t?.status === 'open' || t?.status === 'active');
  const rank = { 'in-progress': 0, interrupted: 1, active: 2, open: 3 };
  return orderBySize(live, order)
    .map((t, i) => {
      const state = taskState(t, { focusedId, streaming });
      const blockers = blockersOf(t, whole).map((b) => ({ id: b.id, title: b.title }));
      return {
        row: {
          id: t.id,
          title: t.title,
          size: sizeLabel(t),
          state,
          checked: isChecked(t),
          blockers,
          done: workSummary(t),
        },
        i,
        // +10 sinks a blocked row under every workable one while keeping its
        // own state readable — a blocked ACTIVE task still sorts under an
        // unblocked OPEN one, because only one of the two can be picked up.
        rank: (rank[state] ?? 4) + (blockers.length > 0 ? 10 : 0),
      };
    })
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((d) => d.row);
};

/** The being's recently SETTLED work — the closed-off goals, for the fold.
 *  Newest first, capped: this is a receipt, not a history. Pure. */
export const settledRows = (ledger, max = 8) =>
  (Array.isArray(ledger?.tasks) ? ledger.tasks : [])
    .filter((t) => t?.status === 'done')
    .sort((a, b) => String(b.completedAt || b.updatedAt || '').localeCompare(String(a.completedAt || a.updatedAt || '')))
    .slice(0, max)
    .map((t) => ({
      id: t.id, title: t.title, size: sizeLabel(t), state: 'done',
      checked: true, blockers: [], done: workSummary(t),
    }));

/**
 * Every OTHER being that has live work, heaviest first, then by name. Beings
 * with nothing open are omitted: a row reading 0 is noise, and the count in the
 * header already says how many carry anything.
 * @param {Array<{neumaId: string, name?: string, kind?: string, count: number}>} counts
 * @param {string|null} activeId the being the rail is already showing
 * @returns {Array<{neumaId: string, name: string, kind: string, count: number}>}
 */
export const otherBeings = (counts, activeId = null) =>
  (Array.isArray(counts) ? counts : [])
    .filter((c) => c?.neumaId && c.neumaId !== activeId && c.count > 0)
    .map((c) => ({
      neumaId: c.neumaId,
      name: String(c.name || c.neumaId).toUpperCase(),
      kind: c.kind === 'witness' ? 'witness' : 'neuma',
      count: c.count,
    }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));

/**
 * A task's step count as the ONE string the rail prints — 'STEPS 2/5' — or '' for
 * a task with no checklist. subtaskProgress returns {open, total}, and a rail
 * that handed that object to React crashed the whole stream (caught in the
 * browser, 2026-07-27): the formatting belongs here, where it is provable.
 * @param {{subtasks?: Array<{status: string}>}} task
 * @returns {string}
 */
export const stepsLabel = (task) => {
  const { open, total } = subtaskProgress(task);
  return total > 0 ? `STEPS ${total - open}/${total}` : '';
};

/**
 * The rail's whole state in one shape.
 *
 * `show` is false with no being (the council room is a room of many, and a rail
 * that named one of them would be lying about the others). While the plan is
 * still loading the rail renders its frame with `loading` true rather than
 * flashing an empty state that says the being has nothing.
 *
 * @param {Object} input
 * @param {{neumaId: string, name?: string}|null} [input.being]
 * @param {{tasks?: Array}|null|undefined} [input.plan] undefined = loading, null = unreadable
 * @param {{tasks?: Array}|null} [input.ledger]
 * @param {Array<{neumaId: string, name?: string, kind?: string, count: number}>} [input.counts]
 * @param {string|null} [input.chatId] the chat the stream is bound to; both
 *   registers narrow to it plus lane-wide work, exactly as the being's own
 *   prompt does. Null narrows nothing.
 * @returns {{show: boolean, title: string, loading: boolean, unreadable: boolean,
 *   own: Array<object>, settled: Array<object>, groups: Array<{cadence: string, tasks: Array<object>}>,
 *   live: number, others: Array<object>, othersLive: number}}
 */
export const railState = ({ being = null, plan = undefined, ledger = null, counts = [], chatId = null, streaming = false, order = 'mine' } = {}) => {
  const others = otherBeings(counts, being?.neumaId ?? null);
  // The rail is the operator's view of THIS conversation, so it is scoped the
  // same way the conversation is. A rail showing work from a chat the being
  // cannot see would be describing a turn that is not happening.
  const mine = inChat(plan?.tasks, chatId);
  // Narrow BEFORE selecting, never after — the same shape the `groups` line
  // uses, so both registers are scoped by one step in one place.
  const theirs = ledger ? { ...ledger, tasks: inChat(ledger.tasks, chatId) } : ledger;
  return Object.freeze({
    show: Boolean(being?.neumaId),
    title: railTitle(being),
    loading: plan === undefined,
    unreadable: plan === null,
    order,
    // The being's own live work WITH state, and the goals it has closed.
    // (`nowRows` — status-only, no state — was retired when `own` replaced it:
    // a bare active flag cannot tell WORKING NOW from INTERRUPTED.)
    // The UN-narrowed task list rides along so a blocker taken up in a parallel
    // chat still blocks here: narrowing first and resolving after would make it
    // vanish, and the row would read free while the focus door refused it.
    own: ownRows(theirs, chatId, streaming, { all: ledger?.tasks ?? null, order }),
    settled: settledRows(theirs),
    groups: groupLiveTasks(mine, order),
    live: liveCount({ tasks: mine }),
    others,
    othersLive: others.length,
  });
};
