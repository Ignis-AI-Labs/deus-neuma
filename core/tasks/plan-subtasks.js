// plan-subtasks.js — the checklist under an assigned-plan task: add, toggle,
// rename, remove, and REPLACE. Extracted from assigned-plan.js (2026-09-20)
// along the size law: the plan module was one deadline away from the cap, and
// the checklist is a whole capability, not a clause. Sibling of assigned-plan
// and assigned-plan-format — never an importer of them — so the correction
// tag and the liveness predicate are held by construction, the same way the
// format module holds `_isLive`. assigned-plan.js re-exports everything here,
// so its readers keep their import doors.
//
// Pure throughout: plans in, plans out; the caller mints ids and stamps now.

export const SUBTASK_TITLE_MAX_CHARS = 200;
export const SUBTASK_MAX_PER_TASK = 20;

// Mirrors assigned-plan.js's private correction — the operator-actionable
// 400, tagged so the route layer can map it.
const _correction = (msg) => Object.assign(new Error(msg), { correction: true });

// Shared locator — throws the correction when either end is missing.
const _locateSubtask = (plan, taskId, subtaskId) => {
  const tasks = plan?.tasks || [];
  const taskIdx = tasks.findIndex((t) => t.id === taskId);
  if (taskIdx === -1) throw _correction(`no task with id "${taskId}" in this list.`);
  const parent = tasks[taskIdx];
  if (parent.status === 'dropped') throw _correction('that task was dropped — its steps went with it.');
  if (subtaskId === undefined) return { tasks, taskIdx, parent, subIdx: -1 };
  const subIdx = (parent.subtasks || []).findIndex((s) => s.id === subtaskId);
  if (subIdx === -1) throw _correction(`no subtask with id "${subtaskId}" on "${parent.title}".`);
  return { tasks, taskIdx, parent, subIdx };
};

const _normalizeSubtaskTitle = (title) => {
  const text = typeof title === 'string' ? title.trim() : '';
  if (!text) throw _correction('a subtask needs a title — one line naming the step.');
  if (text.length > SUBTASK_TITLE_MAX_CHARS) throw _correction(`a subtask title must stay under ${SUBTASK_TITLE_MAX_CHARS} characters.`);
  return text;
};

/**
 * Add a step to a task's checklist. Pure — the caller mints id/now.
 * @returns {{plan: Object, task: Object, subtask: Object}}
 */
export const addSubtask = (plan, { taskId, title }, { id, now }) => {
  const { tasks, taskIdx, parent } = _locateSubtask(plan, taskId);
  const subs = parent.subtasks || [];
  if (subs.length >= SUBTASK_MAX_PER_TASK) {
    throw _correction(`that task already holds ${SUBTASK_MAX_PER_TASK} subtasks — a checklist past that is a project, not a step list.`);
  }
  const subtask = { id, title: _normalizeSubtaskTitle(title), status: 'open', createdAt: now, updatedAt: now };
  const next = [...tasks];
  next[taskIdx] = { ...parent, subtasks: [...subs, subtask], updatedAt: now };
  return { plan: { tasks: next }, task: next[taskIdx], subtask };
};

/**
 * Toggle or rename a subtask. Pure.
 * @returns {{plan: Object, task: Object, subtask: Object}}
 */
export const updateSubtask = (plan, { taskId, subtaskId, status, title }, { now }) => {
  const { tasks, taskIdx, parent, subIdx } = _locateSubtask(plan, taskId, subtaskId);
  const patch = {};
  if (status !== undefined) {
    if (status !== 'open' && status !== 'done') throw _correction('a subtask is only ever open or done.');
    patch.status = status;
  }
  if (title !== undefined) patch.title = _normalizeSubtaskTitle(title);
  if (Object.keys(patch).length === 0) throw _correction('the update changed nothing — pass status or title.');
  const subs = [...parent.subtasks];
  subs[subIdx] = { ...subs[subIdx], ...patch, updatedAt: now };
  const next = [...tasks];
  next[taskIdx] = { ...parent, subtasks: subs, updatedAt: now };
  return { plan: { tasks: next }, task: next[taskIdx], subtask: subs[subIdx] };
};

/**
 * Remove a subtask outright — a retired step is not history worth keeping
 * (unlike tasks themselves, which settle as dropped).
 * @returns {{plan: Object, task: Object}}
 */
export const removeSubtask = (plan, { taskId, subtaskId }, { now }) => {
  const { tasks, taskIdx, parent, subIdx } = _locateSubtask(plan, taskId, subtaskId);
  const subs = parent.subtasks.filter((_, i) => i !== subIdx);
  const next = [...tasks];
  next[taskIdx] = { ...parent, subtasks: subs, updatedAt: now };
  return { plan: { tasks: next }, task: next[taskIdx] };
};

/**
 * Replace a task's WHOLE step list — the entries given ARE the checklist now,
 * the same replace-all law `blockedBy` has on a being's ledger. An entry is a
 * bare title, or `{title, done}` to set that step's tick in the same breath
 * (the being's own ledger checks steps off this way; a bare-title caller,
 * like the operator amend door, simply never sends `done`). A given step
 * whose title matches a standing step keeps that step's identity (id, created-
 * at) and its tick unless the entry says otherwise: swapping one exercise for
 * another must never wipe the progress on the steps that stayed. Steps left
 * out are retired — a retired step is not history worth keeping
 * (removeSubtask's own law). An empty array clears the checklist (absence IS
 * no checklist). The plan's SIBLING KEYS survive the rebuild — a caller's
 * store may carry more than `tasks` (the being's ledger holds the per-chat
 * focus pointer). Pure — the caller mints ids for genuinely new steps.
 * @param {{tasks: Array}} plan
 * @param {{taskId: string, titles?: Array<string|{title: string, done?: boolean}>}} args
 * @param {{now: string, mintId: () => string}} stamp
 * @returns {{plan: Object, task: Object}}
 */
export const replaceSubtasks = (plan, { taskId, titles }, { now, mintId }) => {
  const { tasks, taskIdx, parent } = _locateSubtask(plan, taskId);
  const list = Array.isArray(titles) ? titles : [];
  if (list.length > SUBTASK_MAX_PER_TASK) {
    throw _correction(`a checklist holds at most ${SUBTASK_MAX_PER_TASK} steps — this one names ${list.length}.`);
  }
  const standing = parent.subtasks || [];
  const subtasks = list.map((entry) => {
    const text = _normalizeSubtaskTitle(
      entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.title : entry);
    const kept = standing.find((s) => s.title === text);
    const asked = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.done : undefined;
    if (asked !== undefined && typeof asked !== 'boolean') {
      throw _correction(`a step's done must be true or false — "${text}" was given ${typeof asked}.`);
    }
    // The tick is the ask's to set, the standing state's to keep: a bare
    // title carries no tick ask, so a kept step keeps its check-mark and a
    // genuinely new step starts open.
    const status = asked === undefined ? (kept ? kept.status : 'open')
      : asked ? 'done' : 'open';
    return kept
      ? { ...kept, title: text, status, updatedAt: now }
      : { id: mintId(), title: text, status, createdAt: now, updatedAt: now };
  });
  const next = [...tasks];
  next[taskIdx] = { ...parent, updatedAt: now };
  if (subtasks.length) next[taskIdx].subtasks = subtasks;
  else delete next[taskIdx].subtasks;
  return { plan: { ...plan, tasks: next }, task: next[taskIdx] };
};
