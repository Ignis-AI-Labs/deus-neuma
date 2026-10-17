/**
 * Assigned Plan — the operator's list for a being (or for themselves).
 *
 * The assigned plan is the OPERATOR-authored counterpart to the being's own
 * task ledger: dailies, weeklies, standing baseline work, and milestones the
 * operator sets for a neuma in their house. It lives beside the ledger but
 * never mixes with it — the ledger stays the being's self-authorship. The
 * open standing work rides the system prompt (STANDING WORK section) so the
 * being wakes into what its operator expects of it.
 *
 * Recurrence is lazy: nothing schedules anything. `materializeRecurrence`
 * reopens a done daily/weekly once its period has rolled past, computed
 * purely from `now` — the caller applies it on read and persists when it
 * changed something.
 *
 * A task may also be bound to ONE CHAT, so the operator can set work for a
 * being inside a single conversation without it standing in every other one;
 * a task with no chat is lane-wide. The scope law is shared with the being's
 * own ledger — core/tasks/task-chat.js.
 *
 * Pure module: every operation takes a plan and returns a new one; ids and
 * timestamps are passed in by the impure caller. Validation errors name the
 * correction.
 */
import { normalizeChatId } from './task-chat.js';
import { normalizeSize } from './task-order.js';
import { normalizeDueDate, normalizeDueTime } from './deadline.js';
import {
  localDayKey, localWeekKey, localBiweekKey, localMonthKey,
} from '../time/day-key.js';

// THE CHECKLIST LIVES IN plan-subtasks.js (size law, 2026-09-20): add, toggle,
// rename, remove, and the replace-all door. This module re-exports the whole
// family, so every reader keeps its import door — the barrel, not the body.
export {
  SUBTASK_TITLE_MAX_CHARS, SUBTASK_MAX_PER_TASK,
  addSubtask, updateSubtask, removeSubtask, replaceSubtasks,
} from './plan-subtasks.js';

// The prompt-section formatting lives in assigned-plan-format.js (size-law
// extraction, 2026-08-26) — re-exported here so every reader keeps its door.
export {
  WEEKDAY_LABELS, SUBTASK_PROMPT_MAX, daysLabel,
  formatAssignedSection, formatOperatorSection,
} from './assigned-plan-format.js';

export const ASSIGNED_CADENCES = Object.freeze(['baseline', 'daily', 'weekly', 'biweekly', 'monthly', 'custom', 'once', 'milestone']);
export const ASSIGNED_STATUSES = Object.freeze(['open', 'done', 'dropped']);

export const ASSIGNED_TITLE_MAX_CHARS = 200;
export const ASSIGNED_DETAIL_MAX_CHARS = 1000;
/** Subtasks are a lightweight checklist under a task — the steps inside the
 *  work ("work out 1h" → push-ups, chest, back). No cadence, no due date;
 *  they reopen with their parent. */
/** At most this many open tasks per list — past this it stops being a plan
 *  and starts being a backlog dump. */
export const ASSIGNED_MAX_LIVE = 30;
/** Settled (done-milestone/dropped) history kept for context. Recurring
 *  done tasks are never pruned — they ARE the schedule. */
export const ASSIGNED_MAX_SETTLED = 20;

/** The empty plan shape (also what a missing file reads as). */
export const emptyPlan = () => ({ tasks: [] });

// Validation corrections are thrown tagged, so the impure layer (REST route)
// can tell […] (400, message is safe to
// surface) apart from a real failure (500, generic message).
const _correction = (msg) => Object.assign(new Error(msg), { correction: true });

const _isLive = (t) => t.status === 'open';
const RECURRING = Object.freeze(['daily', 'weekly', 'biweekly', 'monthly', 'custom']);
const _isRecurring = (t) => RECURRING.includes(t.cadence);
/** Prunable history: dropped, or done one-shots (milestones). A done daily/
 *  weekly is the recurring schedule itself — pruning it would delete the
 *  rhythm, so it is kept regardless of age. */
const _isPrunable = (t) => t.status === 'dropped' || (t.status === 'done' && !_isRecurring(t));

// The period keys judge by the OPERATOR-LOCAL calendar — the same local-day
// law the vessel streak follows (core/time/day-key.js; server-local =
// operator-local by design, host UTC+N). Under the old UTC clock a daily
// settled at 23:30 local waited until 07:00 local (midnight UTC) to reopen;
// now it reopens at local midnight. Period-boundary semantics are identical
// otherwise — daily: next local day, weekly: next local Monday, biweekly:
// the next fortnight of local Mondays (the same calendar Mondays as before,
// so standing rhythms keep their phase), monthly: next local calendar month.
// The exported names stay so every existing importer keeps its door.
export const dayKey = localDayKey;
export const weekKey = localWeekKey;
export const biweekKey = localBiweekKey;
export const monthKey = localMonthKey;

const PERIOD_KEYS = Object.freeze({ daily: dayKey, weekly: weekKey, biweekly: biweekKey, monthly: monthKey });

/** The weekday (0 = Sunday) of a whole-days-since-epoch key — day 0
 *  (1970-01-01) was a Thursday. Pure. */
const _weekdayOfDay = (day) => (day + 4) % 7;

/** The first day key strictly after `afterDay` whose weekday is scheduled.
 *  Pure; null when the set is empty (a malformed custom task never rolls). */
const _nextScheduledDay = (afterDay, days) => {
  for (let step = 1; step <= 7; step++) {
    if (days.includes(_weekdayOfDay(afterDay + step))) return afterDay + step;
  }
  return null;
};

/** Has this done recurring task's rhythm rolled past its completion? Pure.
 *  Custom cadence carries over: once a scheduled weekday has PASSED since
 *  completion the task is open until done — a missed Wednesday is still
 *  to-do on Thursday, not silently skipped. */
const _rolled = (t, now) => {
  const doneAt = t.completedAt || t.updatedAt;
  if (t.cadence === 'custom') {
    const doneDay = dayKey(doneAt);
    const nowDay = dayKey(now);
    const days = Array.isArray(t.days) && t.days.length > 0 ? t.days : null;
    if (doneDay === null || nowDay === null || !days) return false;
    const next = _nextScheduledDay(doneDay, days);
    return next !== null && next <= nowDay;
  }
  const key = PERIOD_KEYS[t.cadence];
  const donePeriod = key(doneAt);
  const nowPeriod = key(now);
  return donePeriod !== null && nowPeriod !== null && nowPeriod > donePeriod;
};

/**
 * Roll the plan forward to `now`: a done recurring task whose rhythm has
 * elapsed reopens (updatedAt stamped) — dailies/weeklies/biweeklies/
 * monthlies by period, custom by its own scheduled weekdays. Pure —
 * returns the same plan (changed: false) when nothing rolled.
 *
 * SIBLING KEYS SURVIVE. This was written for the operator's assigned plan,
 * which is nothing but tasks, and later reused for the being's own LEDGER,
 * which also carries the per-chat FOCUS map (task-work.js). Rebuilding the
 * result as a bare `{ tasks }` dropped that pointer — and `_handleTaskTool`
 * opens EVERY call by rolling the ledger through here and writing the result
 * back, so a being's focus was silently erased by its own next task call.
 * Work recording attributes to focus, so it stopped; INTERRUPTED is derived
 * from work-plus-silence, so a crash stopped leaving an honest half-finished
 * task. Found in a live sitting, 2026-08-05 — the identical trap `prune` was
 * hardened against once already.
 *
 * @param {{tasks: Array}|null} plan
 * @param {string} now - ISO timestamp
 * @returns {{plan: {tasks: Array}, changed: boolean}}
 */
export const materializeRecurrence = (plan, now) => {
  const tasks = plan?.tasks || [];
  let changed = false;
  const next = tasks.map((t) => {
    if (t.status !== 'done' || !_isRecurring(t)) return t;
    if (!_rolled(t, now)) return t;
    changed = true;
    // The parent's checklist reopens with it — a new period starts the steps
    // fresh (tomorrow's workout menu is unchecked again).
    const subtasks = (t.subtasks || []).map((s) =>
      s.status === 'done' ? { ...s, status: 'open', updatedAt: now } : s);
    return { ...t, status: 'open', updatedAt: now, ...(subtasks.length ? { subtasks } : {}) };
  });
  return changed
    ? { plan: { ...plan, tasks: next }, changed: true }
    : { plan: { ...plan, tasks }, changed: false };
};

/** Normalize a custom cadence's weekday set: 1–7 unique integers 0–6
 *  (0 = Sunday), returned sorted. Throws the correction otherwise. Pure —
 *  shared with task-presets so a preset's custom spec speaks the same law. */
export const normalizeDays = (days) => {
  if (!Array.isArray(days) || days.length === 0) {
    throw _correction('a custom cadence needs its days — which weekdays the task runs (0 = Sunday … 6 = Saturday).');
  }
  const clean = [...new Set(days)];
  if (clean.length !== days.length || !clean.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
    throw _correction('custom days must be unique integers 0–6 (0 = Sunday … 6 = Saturday).');
  }
  return clean.sort((a, b) => a - b);
};

/**
 * Validate and normalize operator-authored fields. Throws the correction on
 * any malformed part. Pure.
 */
const _normalizeFields = ({ title, detail, cadence, dueDate, dueTime, days, chatId, size, vessel }, { requireTitle, requireCadence }) => {
  const out = {};
  // Same four sizes the being's own ledger speaks (core/tasks/task-order.js).
  // ONE vocabulary across both lists, because the TASKS window orders them
  // side by side — two scales rendered in one column would be a lie about
  // which of two tasks is bigger.
  if (size !== undefined) out.size = normalizeSize(size);
  // VESSEL: a daily on the OPERATOR'S own list that IS one of their vessel
  // dailies — settling it marks the vessel log (backend/services/
  // vessel-daily-bridge.js). Strictly boolean; absence means […] (the chatId convention — an unflagged task stores no key at all).
  if (vessel !== undefined) {
    if (typeof vessel !== 'boolean') throw _correction('vessel must be true or false — it marks a daily as one of your vessel dailies.');
    out.vessel = vessel;
  }
  if (days !== undefined && days !== null) out.days = normalizeDays(days);
  // Absent means "leave it alone"; an explicit null/empty means […] — the two are different asks and must stay different.
  if (chatId !== undefined) out.chatId = normalizeChatId(chatId);
  if (title !== undefined || requireTitle) {
    const text = typeof title === 'string' ? title.trim() : '';
    if (!text) throw _correction('a task needs a title — one line naming the work.');
    if (text.length > ASSIGNED_TITLE_MAX_CHARS) throw _correction(`a task title must stay under ${ASSIGNED_TITLE_MAX_CHARS} characters.`);
    out.title = text;
  }
  if (cadence !== undefined || requireCadence) {
    if (!ASSIGNED_CADENCES.includes(cadence)) {
      throw _correction(`cadence must be one of: ${ASSIGNED_CADENCES.join(', ')}.`);
    }
    out.cadence = cadence;
  }
  if (detail !== undefined) {
    const text = typeof detail === 'string' ? detail.trim() : '';
    if (text.length > ASSIGNED_DETAIL_MAX_CHARS) throw _correction(`task detail must stay under ${ASSIGNED_DETAIL_MAX_CHARS} characters.`);
    if (text) out.detail = text;
    else out.detail = null; // explicit empty string clears the detail
  }
  if (dueDate !== undefined && dueDate !== null) {
    out.dueDate = normalizeDueDate(dueDate); // strict real-day YYYY-MM-DD (core/tasks/deadline.js)
  } else if (dueDate === null) {
    out.dueDate = null; // explicit null clears the due date
  }
  if (dueTime !== undefined && dueTime !== null) {
    out.dueTime = normalizeDueTime(dueTime); // strict HH:MM local — when in the day it is owed
  } else if (dueTime === null) {
    out.dueTime = null; // explicit null clears the due time
  }
  return out;
};

/**
 * Add a task to the plan. Pure — the caller mints id/now.
 * @param {{tasks: Array}} plan
 * @param {{title: string, cadence: string, detail?: string, dueDate?: string, vessel?: boolean}} args
 * @param {{id: string, now: string}} stamp
 * @returns {{plan: Object, task: Object}} the new plan and the added task
 */
export const addAssigned = (plan, args, { id, now }) => {
  const fields = _normalizeFields(args || {}, { requireTitle: true, requireCadence: true });
  // THE DEADLINE GATES (Design note, 2026-09-20: a DATE pins an instance's day —
  // milestones and one-shots, the cadences that happen once; a TIME marks
  // when within the day a recurring task is owed ([…]). Putting a
  // due date on a recurring rhythm would be ambiguous — every instance or
  // just the first? — so the store refuses rather than guesses.
  if (fields.dueDate && !['milestone', 'once'].includes(fields.cadence)) {
    throw _correction('a due date only makes sense on a milestone or a one-shot — recurring work carries its own rhythm.');
  }
  if (fields.dueTime && !['daily', 'weekly', 'once', 'milestone'].includes(fields.cadence)) {
    throw _correction('a due time only makes sense on daily, weekly, one-shot, or milestone work — the other rhythms carry their own period.');
  }
  if (fields.cadence === 'custom' && !fields.days) {
    throw _correction('a custom cadence needs its days — which weekdays the task runs (0 = Sunday … 6 = Saturday).');
  }
  if (fields.days && fields.cadence !== 'custom') {
    throw _correction('days only make sense on a custom cadence — the other rhythms carry their own period.');
  }
  const live = (plan?.tasks || []).filter(_isLive);
  if (live.length >= ASSIGNED_MAX_LIVE) {
    throw _correction(`this list already holds ${ASSIGNED_MAX_LIVE} open tasks — settle or drop one before adding more.`);
  }
  const task = {
    id,
    title: fields.title,
    ...(fields.detail ? { detail: fields.detail } : {}),
    cadence: fields.cadence,
    ...(fields.days ? { days: fields.days } : {}),
    ...(fields.size ? { size: fields.size } : {}),
    // Absence IS lane-wide, so an unchatted task stores no key at all — the
    // same shape every task assigned before chats existed already has.
    ...(fields.chatId ? { chatId: fields.chatId } : {}),
    // Absence IS […] — only a true flag lands on the record.
    ...(fields.vessel === true ? { vessel: true } : {}),
    status: 'open',
    ...(fields.dueDate ? { dueDate: fields.dueDate } : {}),
    ...(fields.dueTime ? { dueTime: fields.dueTime } : {}),
    createdAt: now,
    updatedAt: now,
  };
  return { plan: prune({ tasks: [...(plan?.tasks || []), task] }), task };
};

/**
 * Update a task's status, title, detail, cadence, or due date. Pure.
 * Marking done stamps completedAt (the recurrence clock for dailies/
 * weeklies). Baseline work never settles — it stands until dropped.
 * @param {{tasks: Array}} plan
 * @param {{id: string, status?: string, title?: string, detail?: string, cadence?: string, dueDate?: string|null, vessel?: boolean}} args
 * @param {{now: string}} stamp
 * @returns {{plan: Object, task: Object}} the new plan and the updated task
 */
export const updateAssigned = (plan, args, { now }) => {
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  if (!id) throw _correction('updating a task needs its id.');
  const tasks = plan?.tasks || [];
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) throw _correction(`no task with id "${id}" in this list.`);

  const prev = tasks[idx];
  const patch = {};
  if (args?.status !== undefined) {
    if (!ASSIGNED_STATUSES.includes(args.status)) {
      throw _correction(`status must be one of: ${ASSIGNED_STATUSES.join(', ')}.`);
    }
    if (args.status === 'done' && prev.cadence === 'baseline') {
      throw _correction('baseline work never settles — it stands until you drop it.');
    }
    patch.status = args.status;
  }
  const fields = _normalizeFields(args || {}, { requireTitle: false, requireCadence: false });
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.detail !== undefined) {
    if (fields.detail === null) patch.clearDetail = true;
    else patch.detail = fields.detail;
  }
  if (fields.cadence !== undefined) {
    if (fields.cadence === 'baseline' && (patch.status ?? prev.status) === 'done') {
      throw _correction('baseline work never settles — it stands until you drop it.');
    }
    patch.cadence = fields.cadence;
  }
  {
    const effectiveCadence = patch.cadence ?? prev.cadence;
    if (fields.days !== undefined && effectiveCadence !== 'custom') {
      throw _correction('days only make sense on a custom cadence — the other rhythms carry their own period.');
    }
    // Arriving at custom needs its days from somewhere: the patch or the
    // task's own standing set.
    if (effectiveCadence === 'custom' && !(fields.days || prev.days?.length)) {
      throw _correction('a custom cadence needs its days — which weekdays the task runs (0 = Sunday … 6 = Saturday).');
    }
    if (fields.days !== undefined) patch.days = fields.days;
  }
  if (fields.dueDate !== undefined) {
    const effectiveCadence = patch.cadence ?? prev.cadence;
    if (fields.dueDate !== null && !['milestone', 'once'].includes(effectiveCadence)) {
      throw _correction('a due date only makes sense on a milestone or a one-shot — recurring work carries its own rhythm.');
    }
    if (fields.dueDate === null) patch.clearDueDate = true;
    else patch.dueDate = fields.dueDate;
  }
  if (fields.dueTime !== undefined) {
    const effectiveCadence = patch.cadence ?? prev.cadence;
    if (fields.dueTime !== null && !['daily', 'weekly', 'once', 'milestone'].includes(effectiveCadence)) {
      throw _correction('a due time only makes sense on daily, weekly, one-shot, or milestone work — the other rhythms carry their own period.');
    }
    if (fields.dueTime === null) patch.clearDueTime = true;
    else patch.dueTime = fields.dueTime;
  }
  if (fields.chatId !== undefined) {
    if (fields.chatId === null) patch.clearChat = true; // → stands in every chat
    else patch.chatId = fields.chatId;
  }
  if (fields.size !== undefined) {
    if (fields.size === null) patch.clearSize = true;
    else patch.size = fields.size;
  }
  if (fields.vessel !== undefined) {
    if (fields.vessel === false) patch.clearVessel = true; // → not a vessel daily
    else patch.vessel = true;
  }
  if (Object.keys(patch).length === 0) {
    throw _correction('the update changed nothing — pass status, title, detail, cadence, days, size, vessel, a chat, or a due date.');
  }

  // Reopening past the live cap is refused the same way adding is.
  if (patch.status === 'open' && !_isLive(prev)) {
    const live = tasks.filter(_isLive);
    if (live.length >= ASSIGNED_MAX_LIVE) {
      throw _correction(`this list already holds ${ASSIGNED_MAX_LIVE} open tasks — settle or drop one before reopening this.`);
    }
  }
  const { clearDetail, clearDueDate, clearDueTime, clearChat, clearSize, clearVessel, ...rest } = patch;
  const task = { ...prev, ...rest, updatedAt: now };
  if (clearChat) delete task.chatId;
  if (clearSize) delete task.size;
  if (clearVessel) delete task.vessel;
  if (clearDetail) delete task.detail;
  if (clearDueDate || (patch.cadence && !['milestone', 'once'].includes(patch.cadence))) delete task.dueDate;
  if (clearDueTime || (patch.cadence && !['daily', 'weekly', 'once', 'milestone'].includes(patch.cadence))) delete task.dueTime;
  if (patch.cadence && patch.cadence !== 'custom') delete task.days;
  if (patch.status === 'done') task.completedAt = now;
  const next = [...tasks];
  next[idx] = task;
  return { plan: prune({ tasks: next }), task };
};

// (The checklist family — add/toggle/rename/remove/replace — lives in
// plan-subtasks.js; the barrel at the top of this file re-exports it.)

/**
 * Trim prunable history to ASSIGNED_MAX_SETTLED, oldest-updated first. Open
 * tasks and done recurring tasks (the schedule) are never pruned. Pure.
 */
export const prune = (plan) => {
  const tasks = plan?.tasks || [];
  const settled = tasks.filter(_isPrunable);
  if (settled.length <= ASSIGNED_MAX_SETTLED) return { tasks };
  const keep = new Set(
    settled
      .slice()
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, ASSIGNED_MAX_SETTLED)
      .map((t) => t.id)
  );
  return { tasks: tasks.filter((t) => !_isPrunable(t) || keep.has(t.id)) };
};
