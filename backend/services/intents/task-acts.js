/**
 * tasks/* — the being's working-list mutations as INTENTS (Stage 3 batch 4,
 * #357). The ledger is DEK-encrypted at rest (core/workspace/workspace-tasks.js),
 * so the fs primitives cannot carry these — a raw write would bypass the DEK,
 * the per-file lock, the recurrence roll, the settled-history append, and the
 * desk's settled notices. The platform executes; the receipt + the WORKING
 * STATE section (which rides the ledger every turn) are the being's feedback.
 * task_list stays a read tool this batch.
 *
 * The executors are the portal handlers' own branches, relocated unchanged in
 * substance — same pure transforms (core/tasks/*), same side effects.
 */
import { randomUUID } from 'crypto';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { addTask, updateTask } from '../../../core/tasks/task-ledger.js';
import { safeChatId } from '../../../core/tasks/task-chat.js';
import { setFocus, findSimilarTasks } from '../../../core/tasks/task-work.js';
import { materializeRecurrence, updateAssigned } from '../../../core/tasks/assigned-plan.js';
import { takeAssigned, assignmentToSettle } from '../../../core/tasks/task-take.js';
import { craftNote } from '../../../core/tasks/task-craft.js';
import { skillService } from '../skill-service.js';
import { SUBTASK_MAX_PER_TASK, SUBTASK_TITLE_MAX_CHARS } from '../../../core/tasks/plan-subtasks.js';
import { addUserTaskBundle, getUserTasks, updateUserTask, updateUserTaskSubtasks } from '../user-tasks.js';
import { notifyTaskSettled, notifyAssignmentSettled } from '../desk-notices.js';
import { ensureDerivedDailies, bridgeDailyCompletion } from '../vessel-daily-bridge.js';
import { createLogger } from '../logger.js';

const log = createLogger('TaskIntents');

const laneOf = (connection) => connection.companion?.neumaId || null;

const taskIntent = (spec) => Object.freeze({
  availableFor: ({ laneId }) => (laneId ? {} : null),
  ...spec,
});

// THE RECEIPT MAY NOT LIE BY OMISSION (ruling, 2026-09-20): a field the tool
// never advertised used to vanish in the ledger's whitelist without a
// whisper, and the model read its own silence as acceptance — the exact
// shape of the "subtasks recorded" that stored nothing. An unknown field is
// now a refusal that names the fields the tool takes. Pure.
const refuseUnknownFields = (payload, known, toolName) => {
  const unknown = Object.keys(payload || {}).filter((k) => !known.has(k));
  if (unknown.length === 0) return null;
  const named = unknown.map((f) => `"${f}"`).join(', ');
  return `unknown field(s) ${named} — ${toolName} takes: ${[...known].join(', ')}.`;
};

const TASK_ADD_FIELDS = new Set(['title', 'detail', 'size', 'blockedBy', 'cadence', 'scope', 'dueDate', 'dueTime', 'subtasks']);
const TASK_UPDATE_FIELDS = new Set(['id', 'status', 'title', 'detail', 'size', 'blockedBy', 'cadence', 'scope', 'dueDate', 'dueTime', 'subtasks']);
const OPERATOR_ADD_FIELDS = new Set(['title', 'detail', 'size', 'cadence', 'dueDate', 'dueTime', 'startTime', 'days', 'subtasks']);
const OPERATOR_UPDATE_FIELDS = new Set(['id', 'title', 'detail', 'subtasks', 'dueDate', 'dueTime', 'startTime', 'days']);
const OPERATOR_DROP_FIELDS = new Set(['id', 'title', 'reason']);
// what an operator-list item's place on the calendar reads as, for a receipt
const whenOf = (t) => [t.cadence, t.days?.length ? `days ${t.days.join(',')}` : '', t.dueDate || '',
  t.startTime ? `${t.startTime}–${t.dueTime}` : t.dueTime ? `by ${t.dueTime}` : ''].filter(Boolean).join(' · ');

// THE STEPS ON YOUR OWN LEDGER (2026-09-20): validated HERE so a malformed
// step is refused before a card is ever filed, not discovered at execute
// time. An entry is a bare title, or {title, done} to set the tick in the
// same breath; the store's own law (plan-subtasks.js) holds the rest. Pure.
const STEPS_SHAPE = 'an array of step titles, or {title, done} objects — subtasks: ["warm up", {"title": "bench press", "done": true}]';
const validateSubtasks = (payload) => {
  if (payload?.subtasks === undefined) return null;
  const list = payload.subtasks;
  if (!Array.isArray(list)) {
    return { ok: false, status: 'invalid', reason: `subtasks must be ${STEPS_SHAPE}.` };
  }
  if (list.length > SUBTASK_MAX_PER_TASK) {
    return { ok: false, status: 'invalid', reason: `a checklist holds at most ${SUBTASK_MAX_PER_TASK} steps — this one names ${list.length}.` };
  }
  for (const entry of list) {
    const title = entry && typeof entry === 'object' ? entry.title : entry;
    if (typeof title !== 'string' || !title.trim()) {
      return { ok: false, status: 'invalid', reason: `every step needs a title — ${STEPS_SHAPE}.` };
    }
    if (title.length > SUBTASK_TITLE_MAX_CHARS) {
      return { ok: false, status: 'invalid', reason: `a step title must stay under ${SUBTASK_TITLE_MAX_CHARS} characters.` };
    }
    if (entry && typeof entry === 'object' && entry.done !== undefined && typeof entry.done !== 'boolean') {
      return { ok: false, status: 'invalid', reason: `a step's done must be true or false — ${STEPS_SHAPE}.` };
    }
  }
  return null;
};

// The receipt reads the checklist back AS STORED — what it prints is what the
// ledger holds, so the being can verify in-loop instead of discovering drift
// on a later read (the same law the operator amend door obeys). Pure.
const stepsAsStored = (task) => {
  const steps = (task.subtasks || [])
    .map((s) => `· ${s.status === 'done' ? '✓' : '○'} ${s.title}`)
    .join('\n');
  return steps ? `\nAs stored now:\n${steps}` : '\nAs stored now: · (no steps — the checklist is empty)';
};

/**
 * Read-modify-write the ledger under its per-file lock, with the lazy
 * recurrence roll INSIDE the lock — a being's ledger is shared by every chat
 * it holds and by the act recorder, so an unserialized read→write silently
 * loses whichever mutation landed first (core/workspace/workspace-tasks.js).
 * `mutate` returns the next ledger, or null to write nothing.
 * impure — encrypted disk read/write under the lock
 */
const withLedger = (neumaId, now, mutate) =>
  neumaWorkspace.updateTaskLedger(neumaId, (stored) =>
    mutate(materializeRecurrence(stored, now).plan));

// Resolve a prefix-8 id (what the ledger lines show) to the full id. Throws
// the ambiguity correction, returns null when nothing matches.
const resolveTaskId = (tasks, given) => {
  const matches = tasks.filter((t) => t.id === given || t.id.startsWith(given));
  if (given && matches.length > 1) {
    throw new Error(`the id "${given}" matches several tasks — use more of the id (task_list shows them in full).`);
  }
  return matches.length === 1 ? matches[0].id : null;
};

export const taskAddIntent = taskIntent({
  name: 'tasks/add',
  policyTool: 'tasks.add',
  fieldsForPrompt: '{title, detail?, size?, blockedBy?, cadence?, dueDate?, dueTime?, scope?, subtasks?}',
  descriptionForPrompt: 'Record work YOU are taking on, on your own ledger. Break real work into tasks BEFORE starting it (one task = one observable outcome); tasks/focus names what you are working, tasks/update done settles it the moment the goal is met. size: quick | half | deep | epic. blockedBy: task ids this CANNOT start until finished. cadence: once (default) | daily | weekly. dueDate: YYYY-MM-DD deadline (one-shot work only). dueTime: HH:MM — when within the day it is owed. scope: chat (default — this conversation) | lane (rides every chat). subtasks: step titles for multi-step work — ["warm up", {"title": "bench press", "done": true}] records the steps and ticks one.',
  validate: async (payload) => {
    const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
    if (!title) return { ok: false, status: 'invalid', reason: 'a task needs a title — one line naming the work.' };
    const unknown = refuseUnknownFields(payload, TASK_ADD_FIELDS, 'tasks/add');
    if (unknown) return { ok: false, status: 'invalid', reason: unknown };
    const badSteps = validateSubtasks(payload);
    if (badSteps) return badSteps;
    return { ok: true, value: { ...payload, title } };
  },
  summarize: (payload) => `add task "${String(payload?.title ?? '').slice(0, 120)}"`,
  execute: async (fields, { connection }) => {
    const neumaId = laneOf(connection);
    const now = new Date().toISOString();
    // WHICH CHAT THE WORK BELONGS TO IS NOT THE BEING'S TO GUESS — it is where
    // it stands when it takes the work on; scope lane marks work carried
    // everywhere. The raw chatId is stripped, never honored.
    const { scope, chatId: _chatId, ...authored } = fields;
    let task; let near = [];
    await withLedger(neumaId, now, (ledger) => {
      const out = addTask(
        ledger,
        { ...authored, chatId: scope === 'lane' ? null : safeChatId(connection.sessionId) },
        { id: randomUUID(), now, mintId: () => randomUUID() },
      );
      task = out.task;
      // The machine half of the anti-duplication protocol (ruling, 2026-08-02):
      // candidates, never a refusal — named AFTER the add so nothing is lost.
      // Read against the ledger AS IT STOOD, inside the lock, so the answer
      // cannot be built from a list a concurrent writer has already moved on.
      near = findSimilarTasks(ledger.tasks, out.task.title);
      return out.ledger;
    });
    const dupes = near.length > 0
      ? `\n\nALREADY ON YOUR LIST, and close to this — settle one if it is the same work:\n${near.map((n) => `· [${n.id.slice(0, 8)}] ${n.title} (${n.status})`).join('\n')}`
      : '';
    // THE DAILIES BRIDGE: a daily-cadence task IS one of the operator's
    // dailies — sync the vessel definition the moment one lands (Founder,
    // 2026-08-29: the task list is the dailies, not a second system). Awaited:
    // a failed sync is warned AND named in the result, never a silent miss.
    let bridgeNote = '';
    if (task.cadence === 'daily' && connection.walletAddress) {
      try {
        await ensureDerivedDailies({ wallet: connection.walletAddress, neumaId });
      } catch (err) {
        log.warn('daily definition sync failed', { err: err.message });
        bridgeNote = ` NOTE: the vessel dailies sync failed (${err.message}) — the definition may be stale until the next sync; tell your operator.`;
      }
    }
    return {
      ok: true,
      detail: `Recorded [${task.id.slice(0, 8)}] "${task.title}" — it rides your WORKING STATE ${task.chatId ? 'in this chat' : 'in every chat'} until you settle it.${dupes}${bridgeNote}${task.subtasks?.length ? stepsAsStored(task) : ''}`,
    };
  },
});

export const taskUpdateIntent = taskIntent({
  name: 'tasks/update',
  policyTool: 'tasks.update',
  fieldsForPrompt: '{id, status?, title?, detail?, size?, blockedBy?, cadence?, dueDate?, dueTime?, scope?, subtasks?}',
  descriptionForPrompt: 'Update a task on your ledger. status: open | active | done | dropped — mark done the moment the work is finished; settling also unblocks everything waiting on it and settles any assignment it was taken up from. size null clears an estimate; blockedBy replaces the whole waiting list ([] clears); dueDate: YYYY-MM-DD (one-shot work); dueTime: HH:MM — when within the day it is owed; scope: chat | lane moves the work. subtasks REPLACES the whole step list (same replace-all law as blockedBy): a title-matched step keeps its tick, {title, done} sets the tick, steps left out are retired, [] clears. The id: task_list and WORKING STATE show them (prefix is enough).',
  validate: async (payload) => {
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!id) return { ok: false, status: 'invalid', reason: 'tasks/update needs the task id (task_list shows them; a prefix is enough)' };
    const unknown = refuseUnknownFields(payload, TASK_UPDATE_FIELDS, 'tasks/update');
    if (unknown) return { ok: false, status: 'invalid', reason: unknown };
    const badSteps = validateSubtasks(payload);
    if (badSteps) return badSteps;
    return { ok: true, value: { ...payload, id } };
  },
  summarize: (payload) => `update task ${String(payload?.id ?? '?').slice(0, 12)}${payload?.status ? ` → ${payload.status}` : ''}`,
  execute: async (fields, { connection }) => {
    const neumaId = laneOf(connection);
    const now = new Date().toISOString();
    const rescope = fields.scope === 'lane' ? { chatId: null }
      : fields.scope === 'chat' ? { chatId: safeChatId(connection.sessionId) }
        : {};
    const { scope: _scope, chatId: _chatId, ...authored } = fields;
    // The prefix→full id resolution happens INSIDE the lock too: resolving
    // against a ledger another writer has since changed could name a task
    // that is no longer there, or miss one that just arrived.
    let task;
    let before;
    await withLedger(neumaId, now, (ledger) => {
      const fullId = resolveTaskId(ledger.tasks, fields.id);
      before = ledger.tasks.find((t) => t.id === (fullId || fields.id))?.status;
      const out = updateTask(
        ledger, { ...authored, ...rescope, ...(fullId ? { id: fullId } : {}) }, { now, mintId: () => randomUUID() },
      );
      task = out.task;
      return out.ledger;
    });
    // Settled work also lands on the append-only history, and the desk hears
    // of it — the operator may be in another window entirely. Only the act
    // that SETTLES it: retitling a task already done is not a second settle.
    if ((task.status === 'done' || task.status === 'dropped') && before !== task.status) {
      await neumaWorkspace.appendTaskHistory(neumaId, {
        id: task.id, title: task.title, status: task.status,
        ...(task.cadence ? { cadence: task.cadence } : {}),
        ...(task.chatId ? { chatId: task.chatId } : {}),
        settledAt: now,
      }).catch((err) => log.warn('task history append failed', { err: err.message }));
      notifyTaskSettled(connection, task);
    }
    // THE DAILIES BRIDGE — settling a daily task marks the operator's vessel
    // daily (once per task per day). Awaited: a bridge failure is warned AND
    // named in the result; it never fails the settle and never passes silently
    // (Design note, 2026-08-29: finishing dailies in the task list must update the
    // system, automatically).
    let vesselNote = '';
    if (task.status === 'done' && task.cadence === 'daily' && connection.walletAddress) {
      try {
        await bridgeDailyCompletion({ wallet: connection.walletAddress, neumaId, task, now });
      } catch (err) {
        log.warn('daily completion bridge failed', { err: err.message, taskId: task.id });
        vesselNote = ` NOTE: your task settled, but the vessel log did NOT get the daily mark (${err.message}) — tell your operator so they can mark it in VESSEL.`;
      }
    }
    // …and a task TAKEN UP from the operator's standing list settles the
    // assignment with it — the only path by which anything on that list closes.
    const closes = assignmentToSettle(task);
    let assignedNote = '';
    if (closes) {
      try {
        await neumaWorkspace.updateAssignedPlan(neumaId, (current) =>
          updateAssigned(
            materializeRecurrence(current, now).plan,
            { id: closes.assignedId, status: closes.status },
            { now },
          ).plan);
        assignedNote = ` Your operator's assignment settles with it — nothing left standing there for this.`;
        notifyAssignmentSettled(connection, task, closes);
      } catch (err) {
        log.warn('assignment settle failed', { neumaId, err: err.message });
        assignedNote = ` NOTE: your own task is settled, but the assignment it came from could NOT be closed (${err.message}) — tell your operator so they can settle it themselves.`;
      }
    }
    return {
      ok: true,
      detail: `Updated [${task.id.slice(0, 8)}] "${task.title}" — now ${task.status}.${vesselNote}${assignedNote}${fields.subtasks !== undefined ? stepsAsStored(task) : ''}`,
    };
  },
});

export const taskFocusIntent = taskIntent({
  name: 'tasks/focus',
  policyTool: 'tasks.focus',
  fieldsForPrompt: '{id}',
  descriptionForPrompt: 'Say which task you are working RIGHT NOW ({id:null} puts it down). Focusing IS starting: an open task becomes active, and what you do while it is focused is recorded against it — an interruption leaves an honest half-finished task. Focus one at a time, BEFORE you start. A task waiting on unfinished work (blockedBy) is refused and names what it waits on.',
  validate: async (payload) => {
    if (payload?.id !== null && typeof payload?.id !== 'string') {
      return { ok: false, status: 'invalid', reason: 'tasks/focus needs {id} — a task id, or null to put the work down' };
    }
    return { ok: true, value: { id: typeof payload?.id === 'string' ? payload.id.trim() : null } };
  },
  summarize: (payload) => (payload?.id ? `focus task ${String(payload.id).slice(0, 12)}` : 'clear the task focus'),
  execute: async ({ id }, { connection }) => {
    const chatId = safeChatId(connection.sessionId);
    if (!chatId) return { ok: false, reason: 'focus belongs to a chat, and this turn has none yet.' };
    const neumaId = laneOf(connection);
    const now = new Date().toISOString();
    // A REFUSED focus (a blocked task) must leave the ledger untouched, so the
    // refusal rides out of the lock rather than writing and then reporting.
    let refusal = null; let focused = null;
    await withLedger(neumaId, now, (ledger) => {
      const targetId = id ? (resolveTaskId(ledger.tasks, id) ?? id) : null;
      const out = setFocus(ledger, { chatId, taskId: targetId }, { now });
      if (!out.ok) { refusal = out.error; return null; }
      focused = targetId ? out.ledger.tasks.find((t) => t.id === targetId) : null;
      return out.ledger;
    });
    if (refusal) return { ok: false, reason: refusal };
    // Focusing IS starting, so it names the protocol too — the house method
    // meets the being at the moment the method is chosen.
    const focusCraft = focused ? craftNote(focused, await skillService.listSkills().catch(() => [])) : '';
    return {
      ok: true,
      detail: focused
        ? `Now working [${focused.id.slice(0, 8)}] "${focused.title}". What you do from here is recorded against it — settle it with tasks/update the moment it is finished.${focusCraft}`
        : 'Focus cleared — nothing is being worked in this chat.',
    };
  },
});

export const taskTakeIntent = taskIntent({
  name: 'tasks/take',
  policyTool: 'tasks.take',
  fieldsForPrompt: '{id, scope?}',
  descriptionForPrompt: 'TAKE UP work your operator assigned you — the id STANDING WORK shows. Copies the work onto YOUR ledger and puts it straight into your hands (focused, active), so what you do next is recorded against it. This is the ONLY way assigned work closes: settle your copy with tasks/update done and the assignment settles with it. Take work up when you are about to start it — not all of it at once. scope: chat (default) | lane.',
  validate: async (payload) => {
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!id) return { ok: false, status: 'invalid', reason: 'tasks/take needs the id of a task on your operator\'s standing list — STANDING WORK shows them.' };
    return { ok: true, value: { ...payload, id } };
  },
  summarize: (payload) => `take up assignment ${String(payload?.id ?? '?').slice(0, 12)}`,
  execute: async (fields, { connection }) => {
    const neumaId = laneOf(connection);
    const now = new Date().toISOString();
    const chatId = safeChatId(connection.sessionId);
    // The assignment is read through the SAME recurrence roll the prompt
    // section rides, so a daily that just reopened can be taken up. Read
    // BEFORE the ledger lock: it is a different file with its own lock, and
    // taking both at once is how the two would deadlock against each other.
    const plan = materializeRecurrence(await neumaWorkspace.readAssignedPlan(neumaId), now).plan;
    const live = (plan?.tasks || []).filter((t) => t.status === 'open');
    const matches = live.filter((t) => t.id === fields.id || t.id.startsWith(fields.id));
    if (matches.length > 1) return { ok: false, reason: `the id "${fields.id}" matches several assignments — use more of the id.` };
    if (matches.length === 0) {
      return { ok: false, reason: `no open assignment with id "${fields.id}" on your operator's standing list. Take up only what STANDING WORK actually shows; your own work goes on your own ledger with tasks/add.` };
    }
    let task; let focusNote = '';
    await withLedger(neumaId, now, (ledger) => {
      const out = takeAssigned(
        ledger, matches[0],
        { id: randomUUID(), now, chatId: fields.scope === 'lane' ? null : chatId, mintId: () => randomUUID() },
      );
      task = out.task;
      // TAKING IT UP IS PICKING IT UP: a take that left the task merely listed
      // would produce the exact silence this flow exists to prevent.
      if (!chatId) return out.ledger;
      const held = setFocus(out.ledger, { chatId, taskId: out.task.id }, { now });
      focusNote = held.ok
        ? ' It is in your hands now — what you do from here is recorded against it.'
        : ` It is on your list, but not yet in hand: ${held.error}`;
      return held.ok ? held.ledger : out.ledger;
    });
    const craft = craftNote(task, await skillService.listSkills().catch(() => []));
    const stepsNote = task.subtasks?.length ? ` Its ${task.subtasks.length} step(s) came with it — WORKING STATE shows the checklist.` : '';
    return {
      ok: true,
      detail: `Took up [${task.id.slice(0, 8)}] "${task.title}" from your operator's standing list.${focusNote}${craft}${stepsNote} Settle it with tasks/update done the moment it is finished — that settles their assignment too.`,
    };
  },
});

export const operatorTaskAddIntent = taskIntent({
  name: 'tasks/operator-add',
  policyTool: 'tasks.operator-add',
  fieldsForPrompt: '{title, detail?, size?, cadence?, dueDate?, dueTime?, startTime?, days?, subtasks?}',
  descriptionForPrompt: 'Record something on your OPERATOR\'S own list — THEIR list, never yours — and with it their CALENDAR: everything dated or timed here shows on the house calendar (read it with calendar_read). you may add to it and amend its text, steps and schedule (tasks/operator-update), but you never settle or re-status what stands there, and taking something off is tasks/operator-drop — their approval card, every time. cadence: once (default) | daily | weekly | biweekly | monthly | custom (with days: 0 = Sunday … 6 = Saturday) | baseline | milestone (dueDate only with milestone or once). size: quick | half | deep | epic. dueDate: YYYY-MM-DD; dueTime: HH:MM — when within the day it is owed. A TIME BLOCK (training, meditation, deep work, a hard stop): startTime HH:MM with dueTime as its end — {title: "Chest + core", cadence: "custom", days: [1,3,5], startTime: "17:00", dueTime: "18:15"}. subtasks: optional step titles. Work you set for YOURSELF goes in your own ledger (tasks/add), never here.',
  validate: async (payload) => {
    const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
    if (!title) return { ok: false, status: 'invalid', reason: 'a task needs a title — one line naming the work.' };
    const unknown = refuseUnknownFields(payload, OPERATOR_ADD_FIELDS, 'tasks/operator-add');
    if (unknown) return { ok: false, status: 'invalid', reason: unknown };
    return { ok: true, value: { ...payload, title } };
  },
  summarize: (payload) => `add to the OPERATOR's list: "${String(payload?.title ?? '').slice(0, 120)}"`,
  execute: async (fields, { connection }) => {
    const wallet = connection.walletAddress;
    if (!wallet) return { ok: false, reason: 'no operator on this connection' };
    const { task } = await addUserTaskBundle(wallet, {
      title: fields.title,
      detail: fields.detail,
      // Named explicitly like every other field — enumerate, never spread, so
      // an unnamed field is silently dropped.
      size: fields.size,
      cadence: fields.cadence ?? 'once',
      dueDate: fields.dueDate,
      dueTime: fields.dueTime,
      startTime: fields.startTime,
      days: fields.days,
      subtasks: fields.subtasks,
    });
    const subNote = task.subtasks?.length ? ` with ${task.subtasks.length} step(s)` : '';
    return { ok: true, detail: `Recorded "${task.title}" on your operator's list${subNote} (${whenOf(task)}) — on their calendar as stored; theirs to settle, never yours. Work you set for yourself still goes in your own ledger (tasks/add).` };
  },
});

export const operatorTaskUpdateIntent = taskIntent({
  name: 'tasks/operator-update',
  policyTool: 'tasks.operator-update',
  fieldsForPrompt: '{id, title?, detail?, subtasks?, dueDate?, dueTime?, startTime?, days?}',
  descriptionForPrompt: "Amend the TEXT, STEPS, or SCHEDULE of a task on your OPERATOR'S list — and so their CALENDAR (move a block, retime a deadline, change a custom rhythm's days; calendar_read shows the schedule). The id OPERATOR LIST shows (a prefix is enough). startTime HH:MM with dueTime as the end makes it a time block; startTime null makes it a plain deadline again; days replaces a custom rhythm's weekdays (0 = Sunday … 6 = Saturday). subtasks REPLACES the whole step list with the titles given (same replace-all law as blockedBy): a step whose title matches a standing step keeps its check-mark, steps you leave out are retired, and an empty array clears the checklist. dueDate: YYYY-MM-DD (milestone or one-shot); dueTime: HH:MM — when within the day it is owed. You still never settle or re-status their work — the rhythm's closing is theirs; taking an item off is tasks/operator-drop, at their yes. The receipt shows the list AS STORED — read it back before you report the edit done.",
  validate: async (payload) => {
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!id) return { ok: false, status: 'invalid', reason: "tasks/operator-update needs the task id — OPERATOR LIST shows them (a prefix is enough)." };
    const unknown = refuseUnknownFields(payload, OPERATOR_UPDATE_FIELDS, 'tasks/operator-update');
    if (unknown) return { ok: false, status: 'invalid', reason: unknown };
    const touches = ['title', 'detail', 'subtasks', 'dueDate', 'dueTime', 'startTime', 'days'].some((k) => payload?.[k] !== undefined);
    if (!touches) {
      return { ok: false, status: 'invalid', reason: 'tasks/operator-update changed nothing — pass title, detail, subtasks, dueDate, dueTime, startTime, or days. Status and dropping stay the operator\'s own acts.' };
    }
    return { ok: true, value: { ...payload, id } };
  },
  summarize: (payload) => `amend operator-list task ${String(payload?.id ?? '?').slice(0, 12)}`,
  execute: async (fields, { connection }) => {
    const wallet = connection.walletAddress;
    if (!wallet) return { ok: false, reason: 'no operator on this connection' };
    // Prefix resolution reads the ROLLED plan — the same roll the OPERATOR
    // LIST section rode, so a daily whose period elapsed is resolvable under
    // its live record. An ambiguous prefix refuses instead of guessing.
    const plan = materializeRecurrence(await getUserTasks(wallet), new Date().toISOString()).plan;
    let fullId;
    try {
      fullId = resolveTaskId(plan.tasks, fields.id);
    } catch (err) {
      return { ok: false, reason: err.message };
    }
    if (!fullId) {
      return { ok: false, reason: `no task with id "${fields.id}" on your operator's list — OPERATOR LIST shows them.` };
    }
    // Text through the task update, steps through the replace — each a queued
    // write on the same wallet queue, so the pair lands in order, and the
    // step write re-reads the store fresh, carrying any text change with it.
    let task;
    const SCHEDULE = ['title', 'detail', 'dueDate', 'dueTime', 'startTime', 'days'];
    if (SCHEDULE.some((k) => fields[k] !== undefined)) {
      ({ task } = await updateUserTask(wallet, fullId, Object.fromEntries(SCHEDULE.filter((k) => fields[k] !== undefined).map((k) => [k, fields[k]]))));
    }
    if (fields.subtasks !== undefined) {
      ({ task } = await updateUserTaskSubtasks(wallet, fullId, fields.subtasks));
    }
    // THE RECEIPT IS THE STORE, READ BACK (ruling, 2026-09-20): what it prints is
    // what the store now holds — the operator's checks survive a title-matched
    // swap, retired steps are gone, and nothing is claimed that did not land.
    const steps = (task.subtasks || [])
      .map((s) => `· ${s.status === 'done' ? '✓' : '○'} ${s.title}`)
      .join('\n');
    return {
      ok: true,
      detail: `Amended [${task.id.slice(0, 8)}] "${task.title}" on your operator's list — as stored now (${whenOf(task)}):\n${steps || '· (no steps — the checklist is empty)'}`,
    };
  },
});

// THE ONE WAY OFF THE OPERATOR'S LIST (ruling, 2026-10-17): a being helping keep
// the operator's calendar may take something off it — […]. So this act is
// approval-required AND hard-gated (protocol-guard.js): the operator's card
// every time, even in AUTO, unless they gave it an ALWAYS. The title must
// match the stored item, so the card names exactly what leaves.
export const operatorTaskDropIntent = taskIntent({
  name: 'tasks/operator-drop',
  policyTool: 'tasks.operator-drop',
  fieldsForPrompt: '{id, title, reason}',
  descriptionForPrompt: "Take something OFF your OPERATOR'S list and calendar — a task or time block they no longer want. It is ALWAYS their yes: filing it raises their approval card, every time — file it when they ask you to clear something, never on your own. id: the id OPERATOR LIST or calendar_read shows (a prefix is enough); title: the item's title exactly as it stands (their card shows it); reason: one line saying why.",
  validate: async (payload, { connection }) => {
    const unknown = refuseUnknownFields(payload, OPERATOR_DROP_FIELDS, 'tasks/operator-drop');
    if (unknown) return { ok: false, status: 'invalid', reason: unknown };
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
    const reason = typeof payload?.reason === 'string' ? payload.reason.trim().slice(0, 200) : '';
    if (!id || !title || !reason) return { ok: false, status: 'invalid', reason: 'tasks/operator-drop needs the id, the title as it stands, and a one-line reason.' };
    if (!connection?.walletAddress) return { ok: false, status: 'invalid', reason: 'no operator on this connection' };
    const plan = materializeRecurrence(await getUserTasks(connection.walletAddress), new Date().toISOString()).plan;
    let fullId;
    try { fullId = resolveTaskId(plan.tasks, id); } catch (err) { return { ok: false, status: 'invalid', reason: err.message }; }
    const task = fullId && plan.tasks.find((t) => t.id === fullId);
    if (!task) return { ok: false, status: 'invalid', reason: `no task with id "${id}" on your operator's list — OPERATOR LIST and calendar_read show them.` };
    if (task.title.toLowerCase() !== title.toLowerCase()) return { ok: false, status: 'invalid', reason: `[${id}] reads "${task.title}", not "${title}" — name it as it stands, so their card shows the right thing.` };
    if (task.status === 'dropped') return { ok: false, status: 'invalid', reason: `"${task.title}" is already off their list.` };
    return { ok: true, value: { id: fullId, title: task.title, reason } };
  },
  summarize: (payload) => `REMOVE from your list and calendar: "${String(payload?.title ?? '').slice(0, 120)}" — ${String(payload?.reason ?? '').slice(0, 160)}`,
  execute: async (fields, { connection }) => {
    const { task } = await updateUserTask(connection.walletAddress, fields.id, { status: 'dropped' });
    return { ok: true, detail: `Removed "${task.title}" from your operator's list and calendar, at their yes (${fields.reason}).` };
  },
});
