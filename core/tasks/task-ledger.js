/**
 * Task Ledger — a being's own working list.
 *
 * The ledger is the being's self-authored to-do list: what it has taken on,
 * what it is working now, what it finished or set down. It is load-bearing
 * by design — the open work rides the system prompt every turn (WORKING
 * STATE section), so the being wakes into its list instead of having to
 * remember to ask for it.
 *
 * A task also records the CHAT it was taken on in, so a being holding several
 * parallel conversations does not carry all of them into each one; a task with
 * no chat is lane-wide and stands in every chat. The scope law is shared with
 * the operator-assigned plan — core/tasks/task-chat.js.
 *
 * Pure module: every operation takes a ledger and returns a new one; ids
 * and timestamps are passed in by the impure caller. Validation errors name
 * the correction (the plan_submit style) — the thrown text goes straight
 * back to the being as the tool result.
 */
import { normalizeChatId, splitByChat } from './task-chat.js';
import { taskState, focusedTaskId, workSummary, focusMap } from './task-work.js';
import { normalizeSize, normalizeBlockedBy, blockersOf, sizeLabel } from './task-order.js';
import { normalizeDueDate, normalizeDueTime, dueLabel } from './deadline.js';
import { craftClause } from './task-craft.js';
import { replaceSubtasks } from './plan-subtasks.js';
import { SUBTASK_PROMPT_MAX } from './assigned-plan-format.js';

export const TASK_STATUSES = Object.freeze(['open', 'active', 'done', 'dropped']);

/** Statuses that count as live work — shown in the prompt, capped in count. */
export const LIVE_STATUSES = Object.freeze(['open', 'active']);

/** Optional rhythms a being may give its own work: a done daily/weekly
 *  reopens when its period rolls (same lazy recurrence as the witness's
 *  assigned plan — materializeRecurrence in core/tasks/assigned-plan.js).
 *  'once' (also the meaning of no cadence at all) settles for good. */
export const TASK_CADENCES = Object.freeze(['once', 'daily', 'weekly']);

export const TASK_TITLE_MAX_CHARS = 200;
export const TASK_DETAIL_MAX_CHARS = 1000;
/** At most this many live (open/active) tasks — a list past this stops
 *  being a working list and starts being a backlog dump. */
export const TASK_MAX_LIVE = 30;
/** Finished/dropped history kept for context; older entries are pruned so
 *  the ledger file never grows unbounded. */
export const TASK_MAX_SETTLED = 20;

/** The empty ledger shape (also what a missing file reads as). */
export const emptyLedger = () => ({ tasks: [] });

const _isLive = (t) => LIVE_STATUSES.includes(t.status);
const _isRecurring = (t) => t.cadence === 'daily' || t.cadence === 'weekly';
/** Prunable history: dropped, or done one-shots. A done daily/weekly is the
 *  recurring schedule itself — pruning it would delete the rhythm. */
const _isPrunable = (t) => t.status === 'dropped' || (t.status === 'done' && !_isRecurring(t));

/**
 * Validate and normalize the fields a being may author. Throws the
 * correction on any malformed part. Pure.
 */
const _normalizeAuthoredFields = ({ title, detail, cadence, chatId, size, dueDate, dueTime }, { requireTitle }) => {
  const out = {};
  if (dueDate !== undefined && dueDate !== null) out.dueDate = normalizeDueDate(dueDate);
  else if (dueDate === null) out.dueDate = null; // explicit null clears the due date
  if (dueTime !== undefined && dueTime !== null) out.dueTime = normalizeDueTime(dueTime);
  else if (dueTime === null) out.dueTime = null; // explicit null clears the due time
  // Absent means "leave it alone"; an explicit null/empty means […] — the two are different asks and must stay different.
  if (chatId !== undefined) out.chatId = normalizeChatId(chatId);
  if (title !== undefined || requireTitle) {
    const text = typeof title === 'string' ? title.trim() : '';
    if (!text) throw new Error('a task needs a title — one line naming the work.');
    if (text.length > TASK_TITLE_MAX_CHARS) throw new Error(`a task title must stay under ${TASK_TITLE_MAX_CHARS} characters.`);
    out.title = text;
  }
  if (detail !== undefined) {
    const text = typeof detail === 'string' ? detail.trim() : '';
    if (text.length > TASK_DETAIL_MAX_CHARS) throw new Error(`task detail must stay under ${TASK_DETAIL_MAX_CHARS} characters.`);
    if (text) out.detail = text;
    else out.detail = null; // explicit empty string clears the detail
  }
  if (cadence !== undefined) {
    if (!TASK_CADENCES.includes(cadence)) {
      throw new Error(`cadence must be one of: ${TASK_CADENCES.join(', ')} — once (the default), daily, or weekly.`);
    }
    out.cadence = cadence;
  }
  // Absent leaves the size alone; explicit null clears it back to unsized,
  // because a first guess that turned out wrong must stay retractable.
  if (size !== undefined) out.size = normalizeSize(size);
  return out;
};

/**
 * Add a task to the ledger. Pure — the caller mints id/now.
 *
 * `fromAssigned` rides the STAMP rather than the args, beside the id, because
 * it is the same kind of fact: which assignment this task answers is decided by
 * HOW it was created (task_take), not by a field a being fills in. Keeping it
 * out of `args` means a being cannot claim its own work closes something on its
 * operator's list — the take path is the only door (core/tasks/task-take.js).
 *
 * @param {{tasks: Array}} ledger
 * @param {{title: string, detail?: string, cadence?: string, subtasks?: Array<string|{title: string, done?: boolean}>}} args - being-authored fields
 * @param {{id: string, now: string, fromAssigned?: string, mintId?: () => string}} stamp
 * @returns {{ledger: Object, task: Object}} the new ledger and the added task
 */
export const addTask = (ledger, args, { id, now, fromAssigned = null, mintId = null }) => {
  const fields = _normalizeAuthoredFields(args || {}, { requireTitle: true });
  const live = (ledger?.tasks || []).filter(_isLive);
  if (live.length >= TASK_MAX_LIVE) {
    throw new Error(`your ledger already holds ${TASK_MAX_LIVE} open tasks — finish or drop one (a tasks/update intent) before adding more.`);
  }
  // Validated against the WHOLE ledger and the id this task is about to have,
  // so a blocker that does not exist — or one that would close a cycle — is
  // refused at the moment it is written rather than discovered later by a task
  // that can never be started.
  const blockedBy = args?.blockedBy !== undefined
    ? normalizeBlockedBy(args.blockedBy, { tasks: ledger?.tasks || [], selfId: id })
    : null;
  // THE DEADLINE GATES: a DATE pins a one-shot's day (a recurring rhythm
  // carries no single day); a TIME marks when within the day it is owed.
  const effectiveCadence = fields.cadence ?? 'once';
  if (fields.dueDate && effectiveCadence !== 'once') {
    throw new Error('a due date only makes sense on a one-shot — daily and weekly work carries its own rhythm.');
  }
  if (fields.dueTime && !['daily', 'weekly', 'once'].includes(effectiveCadence)) {
    throw new Error('a due time only makes sense on daily, weekly, or one-shot work.');
  }
  const task = {
    id,
    title: fields.title,
    ...(fields.detail ? { detail: fields.detail } : {}),
    // 'once' is the absence of rhythm — only daily/weekly are stored.
    ...(fields.cadence && fields.cadence !== 'once' ? { cadence: fields.cadence } : {}),
    // Unsized and unblocked are the absence of a key, not a stored empty —
    // the same shape every task written before either existed already has.
    ...(fields.size ? { size: fields.size } : {}),
    ...(fields.dueDate ? { dueDate: fields.dueDate } : {}),
    ...(fields.dueTime ? { dueTime: fields.dueTime } : {}),
    ...(blockedBy ? { blockedBy } : {}),
    // Absence IS lane-wide, so an unchatted task stores no key at all — the
    // same shape every task written before chats existed already has.
    ...(fields.chatId ? { chatId: fields.chatId } : {}),
    // The assignment this task answers, when it was taken up from one. Absent
    // on self-authored work, which is most of it.
    ...(fromAssigned ? { fromAssigned } : {}),
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  const added = { ledger: prune({ ...ledger, tasks: [...(ledger?.tasks || []), task] }), task };
  // THE STEPS ride the same replace-all law every checklist obeys
  // (plan-subtasks.js); ids are minted by the impure caller like the task's own.
  if (args?.subtasks === undefined) return added;
  if (typeof mintId !== 'function') throw new Error('recording steps needs the caller to mint their ids.');
  const replaced = replaceSubtasks(added.ledger, { taskId: task.id, titles: args.subtasks }, { now, mintId });
  return { ledger: prune(replaced.plan), task: replaced.task };
};

/**
 * Update a task's status, title, detail, cadence, or step list. Pure. Setting
 * cadence 'once' clears the rhythm (absence IS once); done recurring tasks stamp
 * completedAt — the clock the lazy reopen reads. `subtasks` (when given)
 * replaces the WHOLE step list through the shared checklist law: title-matched
 * steps keep their tick, `{title, done}` sets it, others retire, `[]` clears.
 * @param {{tasks: Array}} ledger
 * @param {{id: string, status?: string, title?: string, detail?: string, cadence?: string, subtasks?: Array<string|{title: string, done?: boolean}>}} args
 * @param {{now: string, mintId?: () => string}} stamp
 * @returns {{ledger: Object, task: Object}} the new ledger and the updated task
 */
export const updateTask = (ledger, args, { now, mintId = null }) => {
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  if (!id) throw new Error('tasks/update needs the task id — your Working State section shows every id.');
  const tasks = ledger?.tasks || [];
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error(`no task with id "${id}" in your ledger — your Working State section shows what is there.`);
  const prev = tasks[idx];

  const patch = {};
  if (args?.status !== undefined) {
    if (!TASK_STATUSES.includes(args.status)) {
      throw new Error(`status must be one of: ${TASK_STATUSES.join(', ')}.`);
    }
    patch.status = args.status;
  }
  const fields = _normalizeAuthoredFields(args || {}, { requireTitle: false });
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.detail !== undefined) {
    if (fields.detail === null) patch.clearDetail = true;
    else patch.detail = fields.detail;
  }
  if (fields.cadence !== undefined) {
    if (fields.cadence === 'once') patch.clearCadence = true;
    else patch.cadence = fields.cadence;
  }
  if (fields.chatId !== undefined) {
    if (fields.chatId === null) patch.clearChat = true; // → lane-wide
    else patch.chatId = fields.chatId;
  }
  if (fields.size !== undefined) {
    if (fields.size === null) patch.clearSize = true;
    else patch.size = fields.size;
  }
  if (args?.blockedBy !== undefined) {
    // Cycles are checked against the ledger AS IT STANDS, which is what makes
    // the check meaningful: the link being added is the one that could close a
    // loop, and after the write there is no door left to refuse it at.
    const blockedBy = normalizeBlockedBy(args.blockedBy, { tasks, selfId: id });
    if (blockedBy === null) patch.clearBlockedBy = true;
    else patch.blockedBy = blockedBy;
  }
  const cadenceAfter = patch.clearCadence ? 'once' : (patch.cadence ?? prev.cadence ?? 'once'); // absence IS once
  if (fields.dueDate !== undefined) {
    if (fields.dueDate !== null && cadenceAfter !== 'once') {
      throw new Error('a due date only makes sense on a one-shot — daily and weekly work carries its own rhythm.');
    }
    if (fields.dueDate === null) patch.clearDueDate = true;
    else patch.dueDate = fields.dueDate;
  }
  if (fields.dueTime !== undefined) {
    if (fields.dueTime !== null && !['daily', 'weekly', 'once'].includes(cadenceAfter)) {
      throw new Error('a due time only makes sense on daily, weekly, or one-shot work.');
    }
    if (fields.dueTime === null) patch.clearDueTime = true;
    else patch.dueTime = fields.dueTime;
  }
  if (Object.keys(patch).length === 0 && args?.subtasks === undefined) {
    throw new Error('tasks/update changed nothing — pass status, title, detail, cadence, size, blockedBy, chatId, dueDate, dueTime, or subtasks.');
  }

  // Reopening past the live cap is refused the same way adding is.
  if (patch.status && LIVE_STATUSES.includes(patch.status) && !_isLive(prev)) {
    const live = tasks.filter(_isLive);
    if (live.length >= TASK_MAX_LIVE) {
      throw new Error(`your ledger already holds ${TASK_MAX_LIVE} open tasks — finish or drop one before reopening this.`);
    }
  }
  const { clearDetail, clearCadence, clearChat, clearSize, clearBlockedBy, clearDueDate, clearDueTime, ...rest } = patch;
  const task = { ...prev, ...rest, updatedAt: now };
  if (clearDetail) delete task.detail;
  if (clearCadence) delete task.cadence;
  if (clearChat) delete task.chatId;
  if (clearSize) delete task.size;
  if (clearBlockedBy) delete task.blockedBy;
  if (clearDueDate || (patch.cadence && patch.cadence !== 'once' && !patch.dueDate)) delete task.dueDate;
  if (clearDueTime) delete task.dueTime;
  if (patch.status === 'done') task.completedAt = now;
  const next = [...tasks];
  next[idx] = task;

  // BLOCKING A TASK THAT IS IN HAND TAKES IT OUT OF HAND. Focus is the door the
  // block is enforced at, but the block can arrive AFTER the door was passed:
  // focus an open task, then learn it waits on something else. Left alone, the
  // being would go on recording real work against a task it can no longer be
  // given — the artifacts would say it was worked while the door said it could
  // never have started. Dropping the focus makes the two agree, and the being's
  // next task_focus is refused with the blocker named. Settling (done, dropped)
  // takes it out of hand the same way, or later acts stamp finished work.
  const lifted = patch.status === 'done' || patch.status === 'dropped' || blockersOf(task, next).length > 0
    ? Object.fromEntries(Object.entries(focusMap(ledger)).filter(([, id]) => id !== task.id))
    : null;
  const carried = lifted ? { ...ledger, focus: lifted } : ledger;
  const updated = { ledger: prune({ ...carried, tasks: next }), task };
  // THE STEPS REPLACE-ALL, last so the patch above stands first: the checklist
  // replaces against the task AS THIS UPDATE LEFT IT, and a dropped target
  // refuses here (plan-subtasks' own law) because its steps went with the drop.
  if (args?.subtasks === undefined) return updated;
  if (typeof mintId !== 'function') throw new Error('recording steps needs the caller to mint their ids.');
  const replaced = replaceSubtasks(updated.ledger, { taskId: task.id, titles: args.subtasks }, { now, mintId });
  return { ledger: prune(replaced.plan), task: replaced.task };
};

/**
 * Trim prunable history to TASK_MAX_SETTLED, oldest-updated first. Live
 * tasks and done recurring tasks (the schedule) are never pruned. Pure.
 */
export const prune = (ledger) => {
  const tasks = ledger?.tasks || [];
  // SIBLING KEYS SURVIVE. The ledger is not only its task array — it also
  // carries the per-chat FOCUS pointer (task-work.js). Rebuilding it as a bare
  // `{ tasks }` silently dropped that pointer on every add/update, which
  // stopped work recording dead: with nothing in focus there is nothing to
  // attribute an artifact to, so a crash would have left no trace to recover
  // from. Caught as a research question in echo r1 (GLM), then reproduced.
  const settled = tasks.filter(_isPrunable);
  if (settled.length <= TASK_MAX_SETTLED) return { ...ledger, tasks };
  const keep = new Set(
    settled
      .slice()
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, TASK_MAX_SETTLED)
      .map((t) => t.id)
  );
  return { ...ledger, tasks: tasks.filter((t) => !_isPrunable(t) || keep.has(t.id)) };
};

/** How big the work is, said the same way on every line. Pure. */
const _weight = (t) => (sizeLabel(t) ? ` · ${sizeLabel(t)}` : '');

/**
 * What a task is still waiting on, said out loud — or ''. Pure.
 *
 * ALWAYS resolved against the WHOLE ledger, never the chat-narrowed slice a
 * section happens to be printing. A task in this chat may well wait on
 * lane-wide work or on something taken up in a parallel conversation, and
 * resolving against the slice would make that blocker simply vanish — the task
 * would read as free right up until the focus door refused it with no visible
 * reason. The refusal and the line must never disagree.
 */
const _blockNote = (t, all) => {
  const blockers = blockersOf(t, all);
  return blockers.length === 0 ? ''
    : `BLOCKED, waiting on ${blockers.map((b) => `[${b.id.slice(0, 8)}] ${b.title}`).join(', ')}`;
};

/**
 * Work taken up from the operator's standing list says so. Pure.
 *
 * Without this the being cannot tell its own work from work it answers TO, and
 * the consequence is invisible: settling this one also ticks a box on its
 * operator's list. A being should know that before it settles, not after.
 */
const _takenNote = (t) => (t.fromAssigned ? 'FROM YOUR OPERATOR\'S LIST — settling this settles theirs' : '');

/** The marks a line carries, in one trailing clause. Pure. */
const _marks = (notes) => {
  const kept = notes.filter(Boolean);
  return kept.length === 0 ? '' : ` ← ${kept.join(' · ')}`;
};

/** The open steps under a line, indented, capped at the operator list's render
 *  cap; done steps stay quiet until the checklist reopens with its task. Pure. */
const _steps = (t) => {
  const open = (t.subtasks || []).filter((s) => s.status === 'open');
  if (open.length === 0) return '';
  const lines = open.slice(0, SUBTASK_PROMPT_MAX).map((s) => `\n    – ${s.title}`);
  if (open.length > SUBTASK_PROMPT_MAX) lines.push(`\n    – … and ${open.length - SUBTASK_PROMPT_MAX} more steps`);
  return lines.join('');
};

const _line = (t, all) => {
  const marker = t.status === 'active' ? '▶' : t.status === 'done' ? '✓' : t.status === 'dropped' ? '✕' : '·';
  const rhythm = _isRecurring(t) ? ` · ${t.cadence}` : '';
  return `${marker} [${t.id.slice(0, 8)}] ${t.title}${t.detail ? ` — ${t.detail}` : ''} (${t.status}${rhythm}${_weight(t)})${dueLabel(t)}${_marks([_takenNote(t), _blockNote(t, all)])}${_steps(t)}`;
};

/**
 * One live line as the being reads it MID-WORK: a box it can see ticked, the
 * derived state, and — for a task that was interrupted — what it already got
 * done, so it resumes instead of starting over. Pure.
 */
const _stateLine = (t, focusedId, all) => {
  const state = taskState(t, { focusedId, streaming: true });
  const box = state === 'done' ? '[x]' : '[ ]';
  // BLOCKED is kept SEPARATE from state rather than folded into it, and BOTH
  // are printed when both hold. A task that was half worked and has since
  // become blocked has two facts about it — how far it got, and that it cannot
  // go further right now — and collapsing them would lose whichever one lost.
  const mark = _marks([
    state === 'in-progress' ? 'WORKING THIS NOW'
      : state === 'interrupted' ? 'INTERRUPTED, not finished' : '',
    _takenNote(t),
    _blockNote(t, all),
  ]);
  const rhythm = _isRecurring(t) ? ` · ${t.cadence}` : '';
  const head = `${box} [${t.id.slice(0, 8)}] ${t.title}${t.detail ? ` — ${t.detail}` : ''} (${state}${rhythm}${_weight(t)})${dueLabel(t)}${mark}${_steps(t)}`;
  const done = workSummary(t);
  // The crash record, said out loud. Without this an interrupted task reads
  // exactly like an untouched one and the work gets repeated. Paths ride so
  // a wake does not spend turns re-touching the walls.
  if (!done) return head;
  const files = done.targets?.length ? ` — last files: ${done.targets.join(', ')}` : '';
  return `${head}\n    already done here: ${done.count} act(s) — ${done.kinds.join(', ')}, last ${done.lastAt}${files}`;

};

/**
 * Live tasks, what is being worked before what is merely taken on — and what
 * cannot be started at all, last. Pure.
 *
 * Blocked work sinks below everything workable rather than being hidden: the
 * being still needs to see that it exists (it is why the other task matters),
 * but reading a list top-down should land on something it can actually pick up.
 */
const _ordered = (tasks, all) => {
  const blocked = (t) => blockersOf(t, all || tasks).length > 0;
  const rank = (t) => (blocked(t) ? 2 : t.status === 'active' ? 0 : 1);
  return tasks
    .map((t, i) => ({ t, i, r: rank(t) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((d) => d.t);
};

const _KEEP_IT_HONEST = (skills) => [
  'TREAT EVERY TASK AS A GOAL THAT MUST BE CLOSED. Before you take on anything new, read this list — if the work is already here, take THAT task up instead of writing a second one for the same thing.',
  'Say what you are working with a tasks/focus intent BEFORE you start; what you do is then recorded against it, so an interruption leaves an honest half-finished task instead of one that looks untouched.',
  'Size real work when you record it (quick | half | deep | epic) so your operator can choose what to take first, and say what a task WAITS ON (blockedBy) when it cannot start until another one is finished — a blocked task refuses to be focused until its blocker settles.',
  // THE NUMBERS LAW (PAL, arXiv:2211.10435 — computation to the interpreter).
  'Numbers come from runs, never memory: any sum, count, comparison, or measurement is computed by a script through coding/execute and pasted with its source.',
  // THE CRAFT, bound at the seam where work actually begins. Silent on a
  // machine with no Shadow Clone installed — see core/tasks/task-craft.js.
  craftClause(skills),
  'The moment a goal is met, settle it (a tasks/update intent, done). A list of things nobody ever closes is not a working list.',
].filter(Boolean).join(' ');

/**
 * The WORKING STATE prompt section: live tasks only, active first. Empty
 * string when nothing is live — an empty section never rides the prompt.
 *
 * Given a chat, the section narrows to THAT chat's work plus whatever stands
 * lane-wide, and says which is which. Another chat's work is not shown at all:
 * a being holding several parallel conversations would otherwise carry every
 * one of them into each turn, which is the thing this exists to stop.
 *
 * Without a chat (no live session), nothing is narrowed — the whole ledger
 * rides, exactly as before. A missing chat is not evidence that work belongs
 * elsewhere, so it never hides any.
 *
 * Pure.
 * @param {{tasks: Array}|null} ledger
 * @param {{chatId?: string|null, skills?: Array}} [scope] the chat this turn is
 *   speaking in, and the skills actually installed — the Craft clause names
 *   only protocols that really exist on this machine
 * @returns {string}
 */
export const formatLedgerSection = (ledger, { chatId = null, skills = null } = {}) => {
  const honest = _KEEP_IT_HONEST(skills);
  // The WHOLE list, kept beside the narrowed one: blockers and cycles live in
  // the ledger, not in whichever slice a section prints, so every blocked
  // reading below resolves against this and never against `here`/`laneWide`.
  const all = ledger?.tasks || [];
  const live = all.filter(_isLive);
  // COLD START SPEAKS (Design note, 2026-08-16: the task system read as dead). A real
  // ledger with nothing live used to emit NO section at all — so the doctrine
  // reached only beings that already had tasks, and the one about to take on
  // fresh work was never shown it. `null` (no ledger loaded — probe contexts,
  // failed readers) still renders nothing: the absence of a store is not an
  // empty list, and the frozen prompt fixtures pass no ledger at all.
  if (live.length === 0) {
    if (!ledger || !Array.isArray(ledger.tasks)) return '';
    const craft = craftClause(skills);
    return `## Working State (your task ledger)\nNothing is live on your ledger. Real work gets recorded BEFORE it starts: a tasks/add intent breaks it into tasks (one task = one observable outcome), tasks/focus names what you are working, and tasks/update done settles it the moment the goal is met.${craft ? ` ${craft}` : ''}`;
  }
  if (!chatId) {
    return `## Working State (your task ledger)\nThe work you have taken on, as you recorded it. ${honest}\n${_ordered(live, all).map((t) => _stateLine(t, null, all)).join('\n')}`;
  }
  const focusedId = focusedTaskId(ledger, chatId);
  const { here, laneWide } = splitByChat(live, chatId);
  const parts = [];
  if (here.length > 0) {
    parts.push(`## Working State (this chat)\nThe work you have taken on IN THIS CHAT. Other chats you hold carry their own lists, and they are not shown here — this one is what you are in. ${honest}\n${_ordered(here, all).map((t) => _stateLine(t, focusedId, all)).join('\n')}`);
  }
  if (laneWide.length > 0) {
    // NOT "Standing Work" — that name belongs to the operator's assigned plan,
    // which rides its own section a few lines below this one. Two different
    // owners must never wear the same header in one prompt.
    parts.push(`## Work You Carry In Every Chat\nWork you took on for yourself rather than for one conversation, so it stands in every chat you hold. It is still yours, recorded the same way.\n${_ordered(laneWide, all).map((t) => _stateLine(t, focusedId, all)).join('\n')}`);
  }
  // Live work that belongs only to OTHER chats leaves both blocks empty — and
  // an empty section never rides the prompt.
  return parts.join('\n\n');
};

/**
 * The full ledger as the being reads it through task_list — live tasks
 * first, then recent settled history.
 *
 * Unlike the prompt section, this hides nothing: task_list is a deliberate
 * ask, and a being asking for its list should get all of it. Given a chat, the
 * live work is merely SORTED into standing — this chat, every chat, and the
 * other chats it holds — so the being can tell at a glance what is in front of
 * it from what is waiting in a parallel conversation.
 *
 * Pure.
 * @param {{tasks: Array}|null} ledger
 * @param {{chatId?: string|null}} [scope] the chat this turn is speaking in
 * @returns {string}
 */
export const formatLedgerForBeing = (ledger, { chatId = null } = {}) => {
  const tasks = ledger?.tasks || [];
  if (tasks.length === 0) return 'Your ledger is empty — a tasks/add intent records the first piece of work you take on.';
  const live = tasks.filter(_isLive);
  const settled = tasks
    .filter((t) => !_isLive(t))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const parts = [];
  if (live.length && !chatId) {
    parts.push(`Live:\n${_ordered(live, tasks).map((t) => _line(t, tasks)).join('\n')}`);
  } else if (live.length) {
    const { here, laneWide } = splitByChat(live, chatId);
    const hereIds = new Set([...here, ...laneWide].map((t) => t.id));
    const elsewhere = live.filter((t) => !hereIds.has(t.id));
    if (here.length) parts.push(`Live in this chat:\n${_ordered(here, tasks).map((t) => _line(t, tasks)).join('\n')}`);
    if (laneWide.length) parts.push(`Live in every chat:\n${_ordered(laneWide, tasks).map((t) => _line(t, tasks)).join('\n')}`);
    if (elsewhere.length) parts.push(`Live in your other chats (not this one):\n${_ordered(elsewhere, tasks).map((t) => _line(t, tasks)).join('\n')}`);
  }
  if (settled.length) parts.push(`Settled:\n${settled.map((t) => _line(t, tasks)).join('\n')}`);
  return parts.join('\n\n');
};
