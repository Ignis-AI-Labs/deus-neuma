/**
 * User tasks — the operator's OWN list (their life: training, errands,
 * milestones), stored in their realm beside chats and projects at:
 *   <realmRoot>/<wallet>/tasks.json
 *
 * The same assigned-plan shape the operator uses to set work for their neuma
 * serves their own list too — daily/weekly recurrence, baseline standing
 * work, milestones with due dates. Shape and invariants live in
 * core/tasks/assigned-plan.js (pure); this is only the wallet-scoped
 * persistence, recurrence roll-forward, and mutation queue. The open tasks
 * also ride their neuma's prompt (OPERATOR LIST section) so a being can help
 * carry them — remind, ask after, break down. IO is isolated.
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { walletDir, writeJsonAtomic } from './user-realm.js';
import { emptyPlan, addAssigned, updateAssigned, materializeRecurrence, addSubtask, updateSubtask, removeSubtask, replaceSubtasks } from '../../core/tasks/assigned-plan.js';
import { instantiatePreset } from '../../core/tasks/task-presets.js';

const tasksFile = (wallet) => path.join(walletDir(wallet), 'tasks.json');

/** Read the wallet's task plan; a missing file is an empty plan. */
// impure
export const readUserTasks = async (wallet) => {
  try {
    const raw = await fs.readFile(tasksFile(wallet), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.tasks) ? { tasks: parsed.tasks } : emptyPlan();
  } catch (err) {
    if (err.code === 'ENOENT') return emptyPlan();
    throw err;
  }
};

// impure — atomic via the shared realm writer: a sibling temp file renamed
// over the store, so a reader can never observe a half-written file.
const writeUserTasks = async (wallet, plan) => writeJsonAtomic(tasksFile(wallet), plan);

// impure — per-wallet mutation queue (user-projects pattern): every op below
// is read-modify-write on ONE json file; racing writes lose updates or tear
// the file. Chaining a wallet's mutations makes each see the last one's store.
const storeQueues = new Map();
const withStoreQueue = (wallet, task) => {
  const key = String(wallet).toLowerCase();
  const tail = storeQueues.get(key) ?? Promise.resolve();
  const run = tail.then(task, task);
  // The queue survives a failed mutation (errors still surface to the caller).
  storeQueues.set(key, run.catch(() => {}));
  return run;
};

// pure — roll recurrence forward to now; the read half of every op.
const rollForward = (plan, now) => materializeRecurrence(plan, now).plan;

// pure — THE OPERATOR'S OWN LIST IS NEVER CHAT-SCOPED (Design note, 2026-08-01: it is
// their life — training, errands, milestones — not the work of one conversation.
// The shared assigned-plan shape understands `chatId`, and a being reaches this
// store through operator_task_add, so the field is stripped HERE, at the one
// door every write crosses, rather than trusted not to arrive.
const withoutChat = (args) => {
  const { chatId: _chatId, ...rest } = args || {};
  return rest;
};

/**
 * The wallet's plan with recurrence rolled forward; persists the roll when
 * it changed something (a done daily/weekly whose period elapsed reopened).
 * @returns {Promise<{tasks: Array}>}
 */
// impure
export const getUserTasks = (wallet) => withStoreQueue(wallet, async () => {
  const now = new Date().toISOString();
  const { plan, changed } = materializeRecurrence(await readUserTasks(wallet), now);
  if (changed) await writeUserTasks(wallet, plan);
  return plan;
});

/**
 * Add a task to the operator's own list.
 * @returns {Promise<{plan: Object, task: Object}>}
 */
// impure
export const addUserTask = (wallet, args) => withStoreQueue(wallet, async () => {
  const now = new Date().toISOString();
  const plan = rollForward(await readUserTasks(wallet), now);
  const { plan: next, task } = addAssigned(plan, withoutChat(args), { id: crypto.randomUUID(), now });
  await writeUserTasks(wallet, next);
  return { plan: next, task };
});

/**
 * Update one task in the operator's own list (status/title/detail/cadence/
 * dueDate). Validation corrections from the pure module surface as thrown
 * errors — the route maps them to 400s.
 * @returns {Promise<{plan: Object, task: Object}>}
 */
// impure
export const updateUserTask = (wallet, taskId, args) => withStoreQueue(wallet, async () => {
  const now = new Date().toISOString();
  const plan = rollForward(await readUserTasks(wallet), now);
  const { plan: next, task } = updateAssigned(plan, { ...withoutChat(args), id: taskId }, { now });
  await writeUserTasks(wallet, next);
  return { plan: next, task };
});

/**
 * Add a step to a task's checklist.
 * @returns {Promise<{plan: Object, task: Object, subtask: Object}>}
 */
// impure
export const addSubtaskToTask = (wallet, taskId, { title }) => withStoreQueue(wallet, async () => {
  const now = new Date().toISOString();
  const plan = rollForward(await readUserTasks(wallet), now);
  const { plan: next, task, subtask } = addSubtask(plan, { taskId, title }, { id: crypto.randomUUID(), now });
  await writeUserTasks(wallet, next);
  return { plan: next, task, subtask };
});

/**
 * Toggle or rename a subtask.
 * @returns {Promise<{plan: Object, task: Object, subtask: Object}>}
 */
// impure
export const updateSubtaskInTask = (wallet, taskId, subtaskId, patch) => withStoreQueue(wallet, async () => {
  const now = new Date().toISOString();
  const plan = rollForward(await readUserTasks(wallet), now);
  const { plan: next, task, subtask } = updateSubtask(plan, { taskId, subtaskId, ...(patch || {}) }, { now });
  await writeUserTasks(wallet, next);
  return { plan: next, task, subtask };
});

/**
 * Remove a subtask outright.
 * @returns {Promise<{plan: Object, task: Object}>}
 */
// impure
export const removeSubtaskFromTask = (wallet, taskId, subtaskId) => withStoreQueue(wallet, async () => {
  const now = new Date().toISOString();
  const plan = rollForward(await readUserTasks(wallet), now);
  const { plan: next, task } = removeSubtask(plan, { taskId, subtaskId }, { now });
  await writeUserTasks(wallet, next);
  return { plan: next, task };
});

/**
 * Add a task with its step checklist in one queued write — the shape a
 * being authors through operator_task_add (its route onto the operator's
 * list: it may add, and amend steps/text through updateUserTask and
 * updateUserTaskSubtasks; settling, dropping, and re-statusing stay the
 * operator's alone).
 * @returns {Promise<{plan: Object, task: Object}>}
 */
// impure
export const addUserTaskBundle = (wallet, args) => withStoreQueue(wallet, async () => {
  const now = new Date().toISOString();
  const plan = rollForward(await readUserTasks(wallet), now);
  const { plan: withTask, task } = addAssigned(plan, withoutChat(args), { id: crypto.randomUUID(), now });
  let next = withTask;
  const subs = Array.isArray(args?.subtasks) ? args.subtasks : [];
  for (const title of subs) {
    ({ plan: next } = addSubtask(next, { taskId: task.id, title }, { id: crypto.randomUUID(), now }));
  }
  await writeUserTasks(wallet, next);
  return { plan: next, task: next.tasks.find((t) => t.id === task.id) };
});

/**
 * Replace one task's whole step list (titles; a step whose title matches a
 * standing step keeps its check-mark). The amend door the being's
 * tasks/operator-update rides — returned task is READ BACK FROM THE STORE,
 * so the receipt reports what is stored, never what was intended.
 * @returns {Promise<{plan: Object, task: Object}>}
 */
// impure
export const updateUserTaskSubtasks = (wallet, taskId, titles) => withStoreQueue(wallet, async () => {
  const now = new Date().toISOString();
  const plan = rollForward(await readUserTasks(wallet), now);
  const { plan: next, task } = replaceSubtasks(plan, { taskId, titles }, { now, mintId: () => crypto.randomUUID() });
  await writeUserTasks(wallet, next);
  return { plan: next, task };
});

/**
 * Apply a preset bundle to the operator's own list — whole or not at all.
 * @returns {Promise<{plan: Object, added: Array}>}
 */
// impure
export const applyPresetToMine = (wallet, spec) => withStoreQueue(wallet, async () => {
  const now = new Date().toISOString();
  const plan = rollForward(await readUserTasks(wallet), now);
  const { plan: next, added } = instantiatePreset(plan, spec, { mintId: () => crypto.randomUUID(), now });
  await writeUserTasks(wallet, next);
  return { plan: next, added };
});
