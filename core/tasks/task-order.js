/**
 * TASK ORDER — how heavy a piece of work is, what it waits on, and what may be
 * taken up next. Pure.
 *
 * Design note, 2026-08-03:
 *
 *   […]
 *
 * Two ideas that look alike and are not:
 *
 *   SIZE is a PREFERENCE input. It says roughly how much of a sitting the work
 *   costs, and the operator decides whether that means take it first or last.
 *   Coarse on purpose — four buckets, not minutes. A wrong estimate in minutes
 *   is worse than no estimate at all, because it gets believed.
 *
 *   BLOCKING is a HARD constraint. Load-bearing work cannot be started early,
 *   so a blocked task is REFUSED at the focus door rather than merely sorted
 *   down. Sorting can be ignored; a refusal cannot.
 *
 * Blocking is DERIVED, like INTERRUPTED before it (core/tasks/task-work.js): a
 * task carries the ids it waits on, and whether it is blocked is answered by
 * reading those tasks' statuses right now. Nothing has to remember to unblock
 * anything — settling the blocker IS the unblock.
 */

/** How much of a sitting a task costs, coarsest to heaviest. */
export const TASK_SIZES = Object.freeze(['quick', 'half', 'deep', 'epic']);

/** At most this many blockers on one task. A task waiting on nine other things
 *  is not blocked, it is unplanned — the cap makes that visible early. */
export const MAX_BLOCKERS = 8;

const WEIGHT = Object.freeze({ quick: 1, half: 2, deep: 3, epic: 4 });

/**
 * A task's weight, or 0 when it has never been sized. Pure.
 * Unsized is deliberately NOT "medium": a task nobody sized has not answered
 * the question the sort asks, and guessing an answer for it would put it in
 * front of work that did answer.
 * @param {{size?: string}} task
 * @returns {number} 0 when unsized, 1–4 otherwise
 */
export const sizeWeight = (task) => WEIGHT[task?.size] ?? 0;

/** Human label for a size, or '' — the one string every surface prints. Pure. */
export const sizeLabel = (task) => (WEIGHT[task?.size] ? String(task.size).toUpperCase() : '');

const _correction = (message) => {
  const err = new Error(message);
  err.correction = true;
  return err;
};

/**
 * Validate an authored size. Pure.
 * `null` (or an empty string) CLEARS the size — […]
 * is a real answer and must stay sayable once a wrong one has been given.
 * @param {string|null} size
 * @returns {string|null} the clean size, or null to clear
 */
export const normalizeSize = (size) => {
  if (size === null || size === '') return null;
  if (!TASK_SIZES.includes(size)) {
    throw _correction(`size must be one of: ${TASK_SIZES.join(', ')} — quick (minutes), half (part of a sitting), deep (a whole sitting), epic (more than one).`);
  }
  return size;
};

/** Every id reachable from `startIds` by following blockedBy edges. Pure. */
const _reachable = (tasks, startIds) => {
  const byId = new Map((tasks || []).map((t) => [t.id, t]));
  const seen = new Set();
  const stack = [...startIds];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const next = byId.get(id)?.blockedBy;
    if (Array.isArray(next)) stack.push(...next);
  }
  return seen;
};

/**
 * Validate an authored blockedBy list against the ledger it will live in. Pure.
 *
 * Refuses three things, each because the alternative is work that can never be
 * picked up and no way to see why:
 *   - an id no task has (it would wait on nothing, forever)
 *   - waiting on itself
 *   - a cycle (A waits on B waits on A — both dead, neither refusable later)
 *
 * `null` or `[]` clears the list.
 *
 * @param {Array<string>|null} value
 * @param {{tasks: Array, selfId: string}} ctx
 * @returns {Array<string>|null} resolved full ids, or null to clear
 */
export const normalizeBlockedBy = (value, { tasks, selfId }) => {
  if (value === null) return null;
  if (!Array.isArray(value)) {
    throw _correction('blockedBy must be a list of task ids — the work that has to finish before this one can start.');
  }
  if (value.length === 0) return null;
  if (value.length > MAX_BLOCKERS) {
    throw _correction(`a task may wait on at most ${MAX_BLOCKERS} others — if it needs more than that, it is not blocked, it is unplanned.`);
  }
  const all = tasks || [];
  const ids = [];
  for (const raw of value) {
    const given = typeof raw === 'string' ? raw.trim() : '';
    if (!given) throw _correction('every blocker must be a task id — task_list shows them.');
    // Prefix ids are what the ledger lines print, so they resolve here too.
    const matches = all.filter((t) => t.id === given || t.id.startsWith(given));
    if (matches.length === 0) {
      throw _correction(`no task with id "${given}" — a task cannot wait on work that is not on the list (task_list shows what is).`);
    }
    if (matches.length > 1) {
      throw _correction(`the id "${given}" matches several tasks — use more of the id.`);
    }
    const id = matches[0].id;
    if (id === selfId) throw _correction('a task cannot wait on itself.');
    if (!ids.includes(id)) ids.push(id);
  }
  // The cycle check asks the question in the direction that catches it: can the
  // proposed blockers already be reached FROM this task? If so, closing the
  // loop would leave every task in it permanently unstartable.
  if (selfId && _reachable(all, ids).has(selfId)) {
    throw _correction('that would make two tasks wait on each other — neither could ever be started. Settle one of them first, or drop the link.');
  }
  return ids;
};

/**
 * The blockers still standing in a task's way — unsettled only, best-effort
 * titled. Pure.
 *
 * A blocker id that no longer resolves counts as SETTLED, not as blocking. Done
 * one-shots get pruned out of the ledger (TASK_MAX_SETTLED), so treating a
 * missing blocker as live would make a task unstartable forever with nothing on
 * screen to explain it. Between "started slightly early" and […], the recoverable failure wins.
 *
 * @param {{blockedBy?: Array<string>}} task
 * @param {Array} tasks the list the task lives in
 * @returns {Array<{id: string, title: string, status: string}>}
 */
export const blockersOf = (task, tasks) => {
  const ids = Array.isArray(task?.blockedBy) ? task.blockedBy : [];
  if (ids.length === 0) return [];
  const byId = new Map((tasks || []).map((t) => [t.id, t]));
  return ids
    .map((id) => byId.get(id))
    .filter((t) => t && t.status !== 'done' && t.status !== 'dropped')
    .map((t) => ({ id: t.id, title: t.title, status: t.status }));
};

/** True when a task is waiting on work that has not settled. Pure. */
export const isBlocked = (task, tasks) => blockersOf(task, tasks).length > 0;

/** How a refusal names what a task waits on — one string, so the tool result
 *  and the prompt can never describe the same block differently. Pure. */
export const blockedReason = (blockers) => {
  const names = (blockers || []).map((b) => `"${b.title}"`);
  if (names.length === 0) return '';
  const list = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  // The live spelling is the intent — task_update left the advertised catalog
  // with the #414 cut, so naming it here pointed the being at empty hands.
  return `that task is waiting on ${list} — finish that first, or drop the link with a tasks/update intent.`;
};

/** The orders an operator can put a list in. `mine` is the order the list is
 *  already in — the store's own, which is to say nobody's but theirs. */
export const ORDER_MODES = Object.freeze(['mine', 'heaviest', 'lightest']);

/** Is this a mode this module knows? Pure — callers persist operator choices,
 *  and a stale one from storage must degrade to `mine`, never throw. */
export const orderMode = (value) => (ORDER_MODES.includes(value) ? value : 'mine');

/**
 * Order a list by size, keeping the store's order as the tiebreak. Pure.
 *
 * `mine` returns the list in the order it arrived — the operator said the order
 * is theirs, and a sort that ran anyway would be the surface overruling them.
 * It is still a COPY: handing back the caller's own array would let a later
 * in-place sort downstream silently reorder the ledger everything else reads.
 *
 * Unsized tasks go LAST in both directions rather than being treated as
 * middling. Under HEAVIEST FIRST an unsized task is not evidence of weight, and
 * under LIGHTEST FIRST it is not evidence of lightness; trailing them is the
 * only placement that claims nothing.
 *
 * The index tiebreak is explicit rather than leaning on sort stability, so the
 * result is provable rather than a property of the engine.
 *
 * @param {Array} tasks
 * @param {string} mode
 * @returns {Array} a new array in every case — including `mine`, which keeps
 *   the order but never the caller's own reference
 */
export const orderBySize = (tasks, mode) => {
  const list = Array.isArray(tasks) ? tasks : [];
  const m = orderMode(mode);
  if (m === 'mine') return [...list];
  const dir = m === 'heaviest' ? -1 : 1;
  return list
    .map((task, i) => ({ task, i, w: sizeWeight(task) }))
    .sort((a, b) => {
      if (a.w === 0 || b.w === 0) {
        if (a.w === b.w) return a.i - b.i;
        return a.w === 0 ? 1 : -1;
      }
      return (a.w - b.w) * dir || a.i - b.i;
    })
    .map((d) => d.task);
};
