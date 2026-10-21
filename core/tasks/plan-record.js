/**
 * PLAN OF RECORD — an operator-approved team plan as a durable fact. Pure.
 *
 * Design note, 2026-08-16: a being kept re-proposing a plan its operator had already
 * approved. The approval existed only as a chat row (which scrolls out of the
 * recent-conversation window) and as `connection._approvedPlan` (in-memory,
 * lost on relink, never rendered into any prompt). This module is the durable
 * half: the record a workspace persists, the bridge that lands the being's own
 * steps on its task ledger AT THE APPROVAL MOMENT (that is when tasks are
 * formed), and the prompt section that states the approval every turn so the
 * being never re-derives — or re-asks — a verdict already given.
 *
 * Pure module in the task-take.js mold: ids and timestamps are minted by the
 * impure caller (backend/services/team-plan.js owns persistence).
 */
import { addTask, updateTask, TASK_TITLE_MAX_CHARS, TASK_DETAIL_MAX_CHARS, LIVE_STATUSES, TASK_MAX_LIVE } from './task-ledger.js';
import { safeChatId } from './task-chat.js';

/** How much of a step's text the prompt section carries — the full text lives
 *  in the record on disk and (for the being's own steps) on its ledger copy. */
export const PLAN_SECTION_TASK_CHARS = 300;
export const PLAN_SECTION_DONE_CHARS = 200;

/** A ledger task holds at most this many blockers (task-order.js law); a step
 *  with more `needs` than that keeps the overflow in the record's step line. */
const LEDGER_BLOCKERS_MAX = 8;

const _clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/**
 * Normalize an approved engine plan into the record the workspace persists.
 * `chatId` is the SYSTEM's session binding — read through safeChatId, so a
 * crooked binding files the plan lane-wide rather than losing it. Pure.
 *
 * @param {{name?: string|null, goal: string, steps: Array, workspace?: Object|null}} plan
 *   the engine-validated plan (steps carry neumaId — resolvePlanMembers ran)
 * @param {{memberNames?: Object, approvedAt: string, chatId?: string|null, approvedBy?: ?Object}} stamp -
 *   approvedBy: who said yes ({kind: 'operator'|'optio'|'charter', ...}), read by the dispatch gate
 * @returns {Object} frozen record; `taskIds` starts empty — materialization fills it
 */
export const planRecordFrom = (plan, { memberNames = {}, approvedAt, chatId = null, approvedBy = null }) => {
  if (!plan?.goal || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new Error('planRecordFrom: an approved plan with goal and steps is required');
  }
  if (!approvedAt) throw new Error('planRecordFrom: approvedAt is required');
  const chat = safeChatId(chatId);
  return Object.freeze({
    name: plan.name ?? null,
    goal: plan.goal,
    steps: Object.freeze(plan.steps.map((s) => Object.freeze({
      id: s.id,
      neumaId: s.neumaId,
      task: s.task,
      ...(s.role ? { role: s.role } : {}),
      ...(s.done ? { done: s.done } : {}),
      ...(s.files ? { files: Object.freeze([...s.files]) } : {}),
      ...(s.clock ? { clock: s.clock } : {}),
      needs: Object.freeze([...(s.needs || [])]),
    }))),
    memberNames: Object.freeze({ ...memberNames }),
    workspace: plan.workspace
      ? Object.freeze({ root: plan.workspace.root, budgetBytes: plan.workspace.budgetBytes })
      : null,
    // The run's clock and width as approved (team-clock.js, #577).
    ...(plan.clock ? { clock: plan.clock } : {}),
    ...(plan.concurrency ? { concurrency: plan.concurrency } : {}),
    ...(plan.checkIn != null ? { checkIn: plan.checkIn } : {}),
    approvedAt,
    ...(approvedBy ? { approvedBy: Object.freeze({ ...approvedBy }) } : {}),
    ...(chat ? { chatId: chat } : {}),
    taskIds: Object.freeze({}),
  });
};

/**
 * Land the being's OWN steps of an approved plan on its task ledger — the
 * moment tasks are formed. All-or-nothing: a plan that would burst the live
 * cap materializes nothing (the caller reports it; the approval itself must
 * never fail on a full ledger).
 *
 * Two passes, deliberately: addTask validates `blockedBy` against tasks that
 * already exist, and a step's `needs` may point at a step not yet landed. So
 * every task lands first, then the dependency links are written — cycle-free
 * by construction, because the engine's validatePlan admitted only a DAG.
 * Only needs that map to the being's OWN steps become ledger blockers; a
 * dependency on a teammate's step is the run engine's to honor, not the
 * ledger's.
 *
 * @param {{tasks: Array}|null} ledger
 * @param {Object} record - planRecordFrom output
 * @param {{selfNeumaId: string, mintId: () => string, now: string}} stamp
 * @returns {{ledger: Object, record: Object}} record gains `taskIds` (stepId → taskId);
 *   both returned unchanged when the plan holds no steps for this being
 */
export const materializePlanTasks = (ledger, record, { selfNeumaId, mintId, now }) => {
  const own = record.steps.filter((s) => s.neumaId === selfNeumaId);
  if (own.length === 0) return { ledger, record };
  const live = (ledger?.tasks || []).filter((t) => LIVE_STATUSES.includes(t.status));
  if (live.length + own.length > TASK_MAX_LIVE) {
    throw new Error(`materializing ${own.length} plan steps would exceed the ${TASK_MAX_LIVE} live-task cap (${live.length} already live) — settle or drop ledger work first.`);
  }
  const taskIds = {};
  let next = ledger;
  for (const step of own) {
    const id = mintId();
    taskIds[step.id] = id;
    ({ ledger: next } = addTask(next, {
      title: _clip(step.task, TASK_TITLE_MAX_CHARS),
      ...(step.done ? { detail: _clip(`Done when: ${step.done}`, TASK_DETAIL_MAX_CHARS) } : {}),
      ...(record.chatId ? { chatId: record.chatId } : {}),
    }, { id, now }));
  }
  for (const step of own) {
    const blockedBy = step.needs.map((n) => taskIds[n]).filter(Boolean).slice(0, LEDGER_BLOCKERS_MAX);
    if (blockedBy.length > 0) {
      ({ ledger: next } = updateTask(next, { id: taskIds[step.id], blockedBy }, { now }));
    }
  }
  return { ledger: next, record: Object.freeze({ ...record, taskIds: Object.freeze(taskIds) }) };
};

/**
 * The PLAN OF RECORD prompt section — the standing approval fact. '' when no
 * record stands, or when the record belongs to a DIFFERENT chat (the same
 * scope law as the task lists: a chatless record is lane-wide and rides every
 * chat; a chatless TURN is never evidence the plan belongs elsewhere). Pure.
 *
 * @param {Object|null} record
 * @param {{chatId?: string|null}} [scope] the chat this turn speaks in
 * @returns {string}
 */
export const formatPlanSection = (record, { chatId = null } = {}) => {
  if (!record?.goal || !Array.isArray(record.steps) || record.steps.length === 0) return '';
  if (record.chatId && chatId && record.chatId !== chatId) return '';
  const names = record.memberNames || {};
  const hasTeamSteps = record.steps.some((s) => !record.taskIds?.[s.id]);
  const lines = record.steps.map((s, i) => {
    const who = names[s.neumaId] || s.neumaId;
    const taskId = record.taskIds?.[s.id];
    return `${i + 1}. [${s.id}] ${who}: ${_clip(s.task, PLAN_SECTION_TASK_CHARS)}`
      + (s.done ? ` — done when: ${_clip(s.done, PLAN_SECTION_DONE_CHARS)}` : '')
      + (s.files?.length ? ` — delivers: ${s.files.join(', ')}` : '')
      + (s.needs.length > 0 ? ` (after ${s.needs.join(', ')})` : '')
      + (taskId ? ` — YOURS, on your ledger as [${taskId.slice(0, 8)}]` : '');
  });
  const run = record.run || null;
  // One approval is one run: once the team has run it, the plan is a record
  // of work done, not a standing licence to run it again. A run that is still
  // working — or was interrupted and waits to be picked up — is that ONE run.
  const spent = run && run.status !== 'running' && run.status !== 'lost';
  const approval = spent
    ? `Your operator approved this plan (${record.approvedAt}) and your team has RUN it — that approval is spent. To run it again, submit it again (plan_submit) for your operator's approval.`
    : `Your operator APPROVED this plan (${record.approvedAt}). The approval STANDS — never re-propose this plan or ask for its approval again. Submitting a new plan (plan_submit) is how it gets superseded.`;
  return [
    '## Plan of Record (operator-approved)',
    `${record.name ? `"${record.name}" — ` : ''}${record.goal}`,
    approval,
    ...lines,
    ...(run ? [formatRunLine(run)] : []),
    // The two names this line used to teach — task_focus, task_update — left
    // the advertised catalog with the #414 cut, so it was directing a being to
    // tools it could no longer see. The intents are the live spelling.
    `Work your own steps through your ledger (file a tasks/focus intent to take one up, then tasks/update with status done as each completes)${hasTeamSteps && !run ? '; team steps run by filing the team/run intent' : ''}. Progress is what your ledger records, not what you remember.`,
  ].join('\n');
};

const RUN_ENDINGS = Object.freeze({
  done: 'FINISHED',
  failed: 'did NOT finish',
  stopped: 'was STOPPED by your operator',
});

/**
 * A plan whose run is stamped RUNNING but is not live in this process was
 * lost to a backend restart — the lead must not be told its team is at work.
 * Pure: the caller says whether the run is live.
 * @param {Object|null} record
 * @param {boolean} live
 * @returns {Object|null}
 */
export const withRunLiveness = (record, live) => (
  record?.run?.status === 'running' && !live
    ? { ...record, run: { ...record.run, status: 'lost' } }
    : record
);

// pure — the team run's standing, as the lead reads it. The run works in the
// background, so this line is how the lead learns it ended and where the
// report is — it never has to remember, or guess.
const formatRunLine = (run) => {
  if (run.status === 'running') {
    return `Your team is AT WORK on this plan now (run ${run.id}, since ${run.startedAt}). Your operator watches every member live and can stop the run; keep talking with them meanwhile, and never file team/run for this plan again.`;
  }
  if (run.status === 'lost') {
    return `Your team's run ${run.id} was INTERRUPTED — the backend stopped before it finished. Nothing finished is lost: file team/run with {"resume": "${run.id}"} to pick it up where it stopped (its finished parts stand; only what was left runs), and tell your operator.`;
  }
  const report = run.report
    ? `The full report is at ${run.report} — read it before you speak about the work.`
    : 'Its report could not be written; your operator\'s WORKFLOW window holds every part — ask them before you speak about the work.';
  return `Your team's run ${run.id} ${RUN_ENDINGS[run.status] || 'ended'} (${run.finishedAt}). ${report}`;
};
