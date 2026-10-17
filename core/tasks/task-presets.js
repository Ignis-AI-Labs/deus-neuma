/**
 * Task Presets — reusable bundles a witness applies to any lane.
 *
 * A preset is a named bundle of task specs (title, cadence, optional detail/
 * due date, optional subtask titles) — "Push Day", "Morning reset" — that
 * instantiates into a lane's plan in one click. The built-in catalog below
 * covers the basic rhythms people keep every day, on their own and with
 * their neuma; witnesses can also save their own. Instantiation composes the
 * assigned-plan ops, so every validation and cap of a hand-built task holds
 * for a preset-spawned one — and the whole bundle is checked against the
 * live cap BEFORE anything is added (a preset never half-applies).
 *
 * Pure module: specs in, plans out; ids come from the caller's mintId,
 * timestamps from its now.
 */

import {
  ASSIGNED_CADENCES, ASSIGNED_TITLE_MAX_CHARS, ASSIGNED_DETAIL_MAX_CHARS,
  ASSIGNED_MAX_LIVE, SUBTASK_TITLE_MAX_CHARS, SUBTASK_MAX_PER_TASK,
  addAssigned, addSubtask, normalizeDays,
} from './assigned-plan.js';

export const PRESET_NAME_MAX_CHARS = 60;
export const PRESET_MAX_TASKS = 10;

// Same tagged-correction idiom as assigned-plan — the REST layer maps these
// to 400s with the safe correction text.
const _correction = (msg) => Object.assign(new Error(msg), { correction: true });

/**
 * Validate and normalize a preset spec. Throws the correction on any
 * malformed part. Pure.
 * @param {{name: string, tasks: Array}} spec
 * @returns {{name: string, tasks: Array<{title: string, cadence: string, detail?: string, dueDate?: string, subtasks: Array<{title: string}>}>}}
 */
export const validatePresetSpec = (spec) => {
  const name = typeof spec?.name === 'string' ? spec.name.trim() : '';
  if (!name) throw _correction('a preset needs a name — what this bundle is called.');
  if (name.length > PRESET_NAME_MAX_CHARS) throw _correction(`a preset name must stay under ${PRESET_NAME_MAX_CHARS} characters.`);

  const tasks = Array.isArray(spec?.tasks) ? spec.tasks : [];
  if (tasks.length === 0) throw _correction('a preset needs at least one task.');
  if (tasks.length > PRESET_MAX_TASKS) throw _correction(`a preset holds at most ${PRESET_MAX_TASKS} tasks — past that it is a project, not a preset.`);

  const normalized = tasks.map((t, i) => {
    const where = `task ${i + 1} ("${String(t?.title ?? '').trim().slice(0, 30) || 'untitled'}")`;
    const title = typeof t?.title === 'string' ? t.title.trim() : '';
    if (!title) throw _correction(`${where} needs a title.`);
    if (title.length > ASSIGNED_TITLE_MAX_CHARS) throw _correction(`${where}: title must stay under ${ASSIGNED_TITLE_MAX_CHARS} characters.`);
    const cadence = t?.cadence === undefined ? 'once' : t.cadence;
    if (!ASSIGNED_CADENCES.includes(cadence)) throw _correction(`${where}: cadence must be one of: ${ASSIGNED_CADENCES.join(', ')}.`);
    const out = { title, cadence, subtasks: [] };
    // A preset can declare a daily a VESSEL daily (the operator's body
    // maintenance — settling it marks the vessel log). Strictly boolean,
    // stored only when true — the same law as the task record itself.
    if (t?.vessel !== undefined) {
      if (typeof t.vessel !== 'boolean') throw _correction(`${where}: vessel must be true or false.`);
      if (t.vessel) out.vessel = true;
    }
    // A custom rhythm carries its weekdays through the same law as the plan.
    if (cadence === 'custom') {
      try { out.days = normalizeDays(t?.days); }
      catch (err) { throw _correction(`${where}: ${err.message}`); }
    } else if (t?.days !== undefined) {
      throw _correction(`${where}: days only make sense on a custom cadence.`);
    }
    if (t?.detail !== undefined && String(t.detail).trim()) {
      const detail = String(t.detail).trim();
      if (detail.length > ASSIGNED_DETAIL_MAX_CHARS) throw _correction(`${where}: detail must stay under ${ASSIGNED_DETAIL_MAX_CHARS} characters.`);
      out.detail = detail;
    }
    if (t?.dueDate !== undefined && t.dueDate !== null && String(t.dueDate).trim()) {
      const dueDate = String(t.dueDate).trim();
      // The 2026-09-20 deadline law: a DATE pins a milestone or one-shot.
      if (!['milestone', 'once'].includes(cadence)) throw _correction(`${where}: a due date only makes sense on a milestone or a one-shot.`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate))) {
        throw _correction(`${where}: a due date must be an ISO date — YYYY-MM-DD.`);
      }
      out.dueDate = dueDate;
    }
    if (t?.dueTime !== undefined && t.dueTime !== null && String(t.dueTime).trim()) {
      const dueTime = String(t.dueTime).trim();
      if (!['daily', 'weekly', 'once', 'milestone'].includes(cadence)) throw _correction(`${where}: a due time only makes sense on daily, weekly, one-shot, or milestone work.`);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime)) throw _correction(`${where}: a due time must be HH:MM.`);
      out.dueTime = dueTime;
    }
    const subs = Array.isArray(t?.subtasks) ? t.subtasks : [];
    if (subs.length > SUBTASK_MAX_PER_TASK) throw _correction(`${where}: at most ${SUBTASK_MAX_PER_TASK} subtasks.`);
    out.subtasks = subs.map((s, j) => {
      const stitle = typeof s === 'string' ? s.trim() : String(s?.title ?? '').trim();
      if (!stitle) throw _correction(`${where}: subtask ${j + 1} needs a title.`);
      if (stitle.length > SUBTASK_TITLE_MAX_CHARS) throw _correction(`${where}: subtask ${j + 1} must stay under ${SUBTASK_TITLE_MAX_CHARS} characters.`);
      return { title: stitle };
    });
    return out;
  });

  return { name, tasks: normalized };
};

/**
 * Instantiate a preset into a plan. The whole bundle is validated and
 * cap-checked first — it applies whole or not at all. Pure.
 * @param {{tasks: Array}} plan
 * @param {{name: string, tasks: Array}} spec
 * @param {{mintId: () => string, now: string}} stamp
 * @returns {{plan: Object, added: Array}} the new plan and the spawned tasks
 */
export const instantiatePreset = (plan, spec, { mintId, now }) => {
  const valid = validatePresetSpec(spec);
  const live = (plan?.tasks || []).filter((t) => t.status === 'open').length;
  if (live + valid.tasks.length > ASSIGNED_MAX_LIVE) {
    throw _correction(`applying "${valid.name}" would push this list past ${ASSIGNED_MAX_LIVE} open tasks — settle or drop some first.`);
  }
  let next = plan || { tasks: [] };
  const added = [];
  for (const t of valid.tasks) {
    const { plan: withTask, task } = addAssigned(next, t, { id: mintId(), now });
    next = withTask;
    for (const s of t.subtasks) {
      ({ plan: next } = addSubtask(next, { taskId: task.id, title: s.title }, { id: mintId(), now }));
    }
    added.push(next.tasks.find((x) => x.id === task.id));
  }
  return { plan: next, added };
};

/**
 * The built-in catalog — basic rhythms, frozen. Ids are namespaced so a
 * built-in and a custom preset can never collide; built-ins are not deletable.
 */
export const BUILTIN_PRESETS = Object.freeze([
  Object.freeze({
    id: 'builtin:daily-training',
    name: 'Daily Training',
    tasks: Object.freeze([Object.freeze({
      title: 'Work out — at least an hour',
      cadence: 'daily',
      // A body daily — settling it marks the operator's vessel log.
      vessel: true,
      detail: 'Pick the day\'s targets from the menu and put in the hour.',
      subtasks: Object.freeze([
        Object.freeze({ title: 'Warm-up — 10 min' }),
        Object.freeze({ title: 'Push — chest / shoulders / triceps' }),
        Object.freeze({ title: 'Pull — back / biceps' }),
        Object.freeze({ title: 'Legs & core' }),
        Object.freeze({ title: 'Stretch — 10 min' }),
      ]),
    })]),
  }),
  Object.freeze({
    id: 'builtin:push-day',
    name: 'Push Day',
    tasks: Object.freeze([Object.freeze({
      title: 'Push day — chest, shoulders, triceps',
      cadence: 'once',
      subtasks: Object.freeze([
        Object.freeze({ title: 'Bench press — 4×8' }),
        Object.freeze({ title: 'Overhead press — 3×10' }),
        Object.freeze({ title: 'Incline dumbbell press — 3×10' }),
        Object.freeze({ title: 'Dips — 3×12' }),
        Object.freeze({ title: 'Tricep pushdown — 3×12' }),
      ]),
    })]),
  }),
  Object.freeze({
    id: 'builtin:pull-day',
    name: 'Pull Day',
    tasks: Object.freeze([Object.freeze({
      title: 'Pull day — back and biceps',
      cadence: 'once',
      subtasks: Object.freeze([
        Object.freeze({ title: 'Deadlift — 4×6' }),
        Object.freeze({ title: 'Pull-ups — 4×8' }),
        Object.freeze({ title: 'Barbell row — 4×10' }),
        Object.freeze({ title: 'Face pulls — 3×15' }),
        Object.freeze({ title: 'Curls — 3×12' }),
      ]),
    })]),
  }),
  Object.freeze({
    id: 'builtin:morning-reset',
    name: 'Morning Reset',
    tasks: Object.freeze([Object.freeze({
      title: 'Morning reset',
      cadence: 'daily',
      // Body maintenance (water, daylight) — a vessel daily.
      vessel: true,
      subtasks: Object.freeze([
        Object.freeze({ title: 'Make the bed' }),
        Object.freeze({ title: 'Water — 500 ml before anything else' }),
        Object.freeze({ title: 'Daylight — 10 min outside' }),
        Object.freeze({ title: 'No phone for the first 30 min' }),
      ]),
    })]),
  }),
  Object.freeze({
    id: 'builtin:deep-work',
    name: 'Deep Work Block',
    tasks: Object.freeze([Object.freeze({
      title: 'Deep work — one 90-minute block',
      cadence: 'daily',
      subtasks: Object.freeze([
        Object.freeze({ title: 'Phone in another room' }),
        Object.freeze({ title: 'One clear objective, written down' }),
        Object.freeze({ title: 'Log what actually shipped' }),
      ]),
    })]),
  }),
  Object.freeze({
    id: 'builtin:weekly-review',
    name: 'Weekly Review',
    tasks: Object.freeze([Object.freeze({
      title: 'Weekly review',
      cadence: 'weekly',
      subtasks: Object.freeze([
        Object.freeze({ title: 'Clear the inboxes to zero' }),
        Object.freeze({ title: 'Review what settled this week' }),
        Object.freeze({ title: 'Choose next week\'s milestones' }),
      ]),
    })]),
  }),
]);
