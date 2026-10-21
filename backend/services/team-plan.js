/**
 * Team Plan — a being-authored team plan, gated on its operator's approval.
 *
 * The shadow-clone way, made native: a LEAD being drafts the plan (goal,
 * steps, owners, done-criteria), submits it through plan_submit, and the
 * operator approves or asks for revision on a structured card — never
 * fire-and-forget. The approved plan is the SAME shape the run engine
 * executes (team-coordinator's validatePlan is the gate), so approval is
 * a promise about what will actually run, not a summary of it.
 *
 * Sibling of operator-ask.js: same per-connection pending-map broker, same
 * settle-everywhere guarantee (approve / revise / interrupt / close), same
 * honesty rule — an unanswered submission tells the being nobody answered,
 * never a fabricated verdict. NO clock on the card (Design note, 2026-07-27: an
 * essential decision waits for the human, it never expires).
 */

import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { validatePlan, isStepId } from './team-coordinator.js';
import { repairJsonStringControlChars } from '../../core/index.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { safeChatId } from '../../core/tasks/task-chat.js';
import { planRecordFrom, materializePlanTasks } from '../../core/tasks/plan-record.js';
import { ensureFilesystemRoots } from './mcp-filesystem.js';
import { notifyAwaitingAnswer } from './desk-notices.js';
import { createLogger } from './logger.js';
import { normalizeStepFiles } from './team-step-files.js';
import { normalizeClock, normalizeCheckIn, describeClock, NO_CLOCK, DEFAULT_CHECK_IN_MINUTES } from './team-clock.js';
import { normalizeConcurrency } from './team-run-gate.js';

const log = createLogger('TeamPlan');

// Does this parsed call target the plan tool? Matched by NAME, not server —
// the 'team' server holds more tools (team_run and kin).
export const isPlanTool = (match) => match.toolName === 'plan_submit';

/** What the being reads when no verdict came — honest, path forward named.
 *  No `timeout` key: the card carries no clock (ruling, 2026-07-27). */
export const PLAN_UNANSWERED = Object.freeze({
  interrupted: 'The turn was interrupted before your operator ruled on the plan — it is NOT approved.',
  closed: 'The portal closed before your operator ruled on the plan — it is NOT approved.',
});

// impure — the operator's roster: every being this wallet holds, by name.
export const operatorRoster = async (walletAddress) => {
  const owned = await neumaWorkspace.listNeumaByOwner(walletAddress).catch(() => []);
  return Promise.all(owned.map(async (o) => {
    // A corrupt DNA throws (MEM-003 #189) — the being still lists under its
    // lane id, and the damage is logged rather than read as "unborn".
    const dna = await neumaWorkspace.readDNA(o.neumaId).catch((err) => {
      log.error('roster entry degraded — identity unreadable', { neumaId: o.neumaId, err: err?.message });
      return null;
    });
    return { neumaId: o.neumaId, name: dna?.identity?.name || dna?.name || o.neumaId };
  }));
};

// The same boundaries the operator-facing composer enforces (team-routes):
// a plan a being writes obeys the limits a plan the operator writes does.
export const PLAN_NAME_MAX_CHARS = 60;
export const PLAN_GOAL_MAX_CHARS = 1000;
export const PLAN_TASK_MAX_CHARS = 2000;
export const PLAN_DONE_MAX_CHARS = 500;
export const PLAN_ROLE_MAX_CHARS = 40;
export const PLAN_NOTES_MAX_CHARS = 4000;
export const PLAN_MAX_STEPS = 16;

export const PLAN_DECISIONS = Object.freeze(['approve', 'revise']);

/**
 * Accept a structured arg that arrived as TEXT. Text tool dialects deliver
 * every parameter as a string — a model can emit a perfect JSON array for
 * `steps` and still have it land here as "[{...}]", which no correction it
 * receives can fix (observed live: Keir's bench plans failed three straight
 * rounds on "needs steps"). Parse JSON-looking strings (with the shared
 * control-char repair for real newlines inside string values); return the
 * value untouched when it already has the wanted shape, null when it never
 * reaches it. Pure.
 * @param {*} value - the raw arg
 * @param {Function} hasShape - e.g. Array.isArray — the shape that counts
 * @returns {*|null}
 */
const coerceStructuredArg = (value, hasShape) => {
  if (hasShape(value)) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text.startsWith('[') && !text.startsWith('{')) return null;
  for (const candidate of [text, repairJsonStringControlChars(text)]) {
    try {
      const parsed = JSON.parse(candidate);
      if (hasShape(parsed)) return parsed;
      break;
    } catch { /* try repaired form */ }
  }
  return null;
};

/**
 * Normalize a being's plan_submit args into a candidate plan, throwing an
 * honest, correctable message on any malformed part — the thrown text goes
 * straight back to the being as the tool result, so it names the fix. Pure.
 *
 * @param {Object|undefined} args - { name?, goal, steps }
 * @returns {{name: string|null, goal: string, steps: Array}} steps keep
 *   `member` as given (a NAME) — resolution to neumaIds happens against
 *   the operator's roster, separately, so this stays pure.
 */
export const normalizePlanArgs = (args) => {
  const goal = typeof args?.goal === 'string' ? args.goal.trim() : '';
  if (!goal) throw new Error('plan_submit needs a goal — the one sentence every step serves.');
  if (goal.length > PLAN_GOAL_MAX_CHARS) throw new Error(`the goal must stay under ${PLAN_GOAL_MAX_CHARS} characters.`);

  const name = typeof args?.name === 'string' && args.name.trim()
    ? args.name.trim().slice(0, PLAN_NAME_MAX_CHARS)
    : null;

  const rawSteps = coerceStructuredArg(args?.steps, Array.isArray) ?? [];
  if (rawSteps.length === 0) throw new Error('plan_submit needs steps — at least one, each with {id, member, task}.');
  if (rawSteps.length > PLAN_MAX_STEPS) throw new Error(`a plan holds at most ${PLAN_MAX_STEPS} steps.`);

  const steps = rawSteps.map((s, i) => {
    const id = typeof s?.id === 'string' ? s.id.trim() : '';
    if (!id) throw new Error(`step ${i + 1} needs an id (a short unique label like "build" or "verify").`);
    if (!isStepId(id)) throw new Error(`step ${i + 1} id ${JSON.stringify(id.slice(0, 40))} must be one word of letters, digits, ".", "_" or "-" (like "build" or "market-research").`);
    const member = typeof s?.member === 'string' ? s.member.trim() : '';
    if (!member) throw new Error(`step "${id}" needs a member — the NAME of the teammate who owns it (yourself included).`);
    const task = typeof s?.task === 'string' ? s.task.trim() : '';
    if (!task) throw new Error(`step "${id}" needs a task — what its owner is asked to do.`);
    if (task.length > PLAN_TASK_MAX_CHARS) throw new Error(`step "${id}" task must stay under ${PLAN_TASK_MAX_CHARS} characters.`);
    const role = typeof s?.role === 'string' && s.role.trim() ? s.role.trim().slice(0, PLAN_ROLE_MAX_CHARS) : null;
    const done = typeof s?.done === 'string' && s.done.trim() ? s.done.trim() : null;
    if (done && done.length > PLAN_DONE_MAX_CHARS) throw new Error(`step "${id}" done criteria must stay under ${PLAN_DONE_MAX_CHARS} characters.`);
    const needs = (Array.isArray(s?.needs) ? s.needs : [])
      .filter((n) => typeof n === 'string' && n.trim())
      .map((n) => n.trim());
    // The step's DELIVERABLES — the platform checks they stand on disk
    // before the step counts as done (team-step-files.js).
    const files = normalizeStepFiles(s?.files, id);
    // Its own clock, or 'none' to work free of the plan's (team-clock.js, #577).
    const clock = normalizeClock(s?.clock, `step "${id}"`);
    return { id, member, task, ...(role ? { role } : {}), ...(done ? { done } : {}), ...(files ? { files } : {}), ...(clock ? { clock } : {}), needs };
  });

  const workspace = args?.workspace == null
    ? null
    : coerceStructuredArg(args.workspace, (v) => v !== null && typeof v === 'object' && !Array.isArray(v));
  if (args?.workspace != null && workspace === null) {
    throw new Error('workspace, when given, must be an object: { "root": "<directory>", "budgetBytes"?: <number> }.');
  }
  // The run's clock every part inherits, and how many parts work at once (#577) — both optional.
  const clock = normalizeClock(args?.clock, 'the plan');
  const concurrency = normalizeConcurrency(args?.concurrency, 'the plan\'s concurrency');
  const checkIn = normalizeCheckIn(args?.checkIn, 'the plan\'s checkIn'); // the eye's cadence (team-watch.js)
  return {
    name, goal, steps, workspace: normalizeWorkspace(workspace),
    ...(clock && clock !== NO_CLOCK ? { clock } : {}), ...(concurrency ? { concurrency } : {}), ...(checkIn != null ? { checkIn } : {}),
  };
};

/** Default space budget for an assigned team workspace — 512MB. */
export const DEFAULT_WORKSPACE_BUDGET_BYTES = 512 * 1024 * 1024;

/**
 * Normalize a plan's optional assigned workspace: the directory the whole
 * team's file work is confined to, plus the byte budget metering its writes
 * (#171 — things stay within a repository space; agents never step outside).
 * Pure; throws the correction on malformed input.
 * @param {Object|undefined|null} ws - { root, budgetBytes? }
 * @returns {{root: string, budgetBytes: number}|null}
 */
export const normalizeWorkspace = (ws) => {
  if (ws == null) return null;
  const root = typeof ws.root === 'string' ? ws.root.trim() : '';
  if (!root) throw new Error('workspace, when given, needs a root — the directory all the team\'s files live under (workspace.root).');
  const budgetBytes = ws.budgetBytes == null ? DEFAULT_WORKSPACE_BUDGET_BYTES : Number(ws.budgetBytes);
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
    throw new Error('workspace.budgetBytes, when given, must be a positive number of bytes.');
  }
  return Object.freeze({ root: path.resolve(root), budgetBytes });
};

/**
 * Resolve each step's `member` name to a neumaId against the operator's own
 * roster — a team is drawn from your house, never someone else's. Matching
 * is case-insensitive on the being's name, with the raw neumaId accepted
 * too. Throws naming every unresolvable member so the being can correct
 * the plan (or ask its operator who is available). Pure given the roster.
 *
 * @param {Array} steps - normalized steps carrying `member` names
 * @param {Array<{neumaId: string, name: string}>} roster - the operator's beings
 * @returns {Array} engine-shaped steps ({ id, neumaId, task, role?, done?, needs })
 */
export const resolvePlanMembers = (steps, roster) => {
  const byName = new Map();
  const ambiguous = new Set(); // display names shared by 2+ beings — never silently picked
  const byId = new Map();
  for (const m of roster) {
    if (m?.neumaId) byId.set(m.neumaId, m.neumaId);
    if (!m?.name) continue;
    const key = String(m.name).toLowerCase();
    if (byName.has(key) && byName.get(key) !== m.neumaId) ambiguous.add(key);
    else byName.set(key, m.neumaId);
  }
  const unknown = [];
  const collided = [];
  const resolved = steps.map(({ member, ...rest }) => {
    if (byId.has(member)) return { ...rest, neumaId: member };
    const key = member.toLowerCase();
    if (ambiguous.has(key)) { collided.push(member); return { ...rest, neumaId: null }; }
    const neumaId = byName.get(key) || null;
    if (!neumaId) unknown.push(member);
    return { ...rest, neumaId };
  });
  if (collided.length > 0) {
    throw new Error(`several beings in your operator's house share the name ${[...new Set(collided)].map((n) => `'${n}'`).join(', ')} — name them by their exact id instead so the right one owns the step.`);
  }
  if (unknown.length > 0) {
    const known = roster.map((m) => m.name).filter(Boolean).join(', ') || '(no beings in this house)';
    throw new Error(`these plan members are not in your operator's house: ${[...new Set(unknown)].join(', ')}. Beings you can name: ${known}.`);
  }
  return resolved;
};

// impure — try to send; a portal that closed mid-review must not throw,
// but the drop is logged so it never disappears silently.
const _safeSend = (ws, payload) => {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  } catch (err) {
    log.debug('plan send dropped — portal closed', { type: payload.type, error: err.message });
  }
};

const _pending = (connection) => {
  if (!connection._pendingPlans) connection._pendingPlans = new Map();
  return connection._pendingPlans;
};

/**
 * impure — put a validated plan before the operator and wait for the verdict.
 * Resolves { status: 'approve' } | { status: 'revise', notes } on a real
 * decision, or { status: 'interrupted' | 'closed' }. Never rejects — and
 * never times out: the card waits for the human.
 *
 * @param {Object} connection - Portal connection (carries ws + pending map)
 * @param {Object} req - { name, goal, steps, memberNames, signal? }
 *   memberNames: neumaId -> display name, so the card shows who, not ids.
 * @returns {Promise<{status: string, notes?: string}>}
 */
export const requestPlanApproval = (connection, { name, goal, steps, workspace = null, memberNames = {}, signal, clock = null, concurrency = null, checkIn = null }) =>
  new Promise((resolve) => {
    const id = randomUUID();
    const pending = _pending(connection);

    const settle = (outcome) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (signal) signal.removeEventListener('abort', entry.onAbort);
      // The desk learns the card settled on EVERY path — no dangling buttons.
      _safeSend(connection.ws, {
        type: 'operator:plan_resolved', id, status: outcome.status,
        ...(outcome.notes ? { notes: outcome.notes } : {}),
      });
      resolve(outcome);
    };

    const onAbort = () => settle({ status: 'interrupted' });
    pending.set(id, { settle, onAbort });

    if (signal) {
      if (signal.aborted) { settle({ status: 'interrupted' }); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // The verdict carries no clock — the tray tells an operator who is not
    // looking at this stream that a plan now stands before them.
    notifyAwaitingAnswer(connection, { what: 'plan', detail: goal });
    _safeSend(connection.ws, {
      type: 'operator:plan',
      id,
      ...(name ? { name } : {}),
      goal,
      // The workspace is DISCLOSED at approval — the operator sees exactly
      // which directory the team will touch and its space budget before
      // saying yes (#171).
      ...(workspace ? { workspace: { root: workspace.root, budgetBytes: workspace.budgetBytes } } : {}),
      // The run's clock and width are disclosed too (#577): the operator says
      // yes to how long and how wide, not only to what.
      clock: describeClock(clock),
      ...(concurrency ? { concurrency } : {}),
      checkIn: checkIn ?? DEFAULT_CHECK_IN_MINUTES,
      steps: steps.map((s) => ({
        id: s.id,
        member: memberNames[s.neumaId] || s.neumaId,
        task: s.task,
        ...(s.role ? { role: s.role } : {}),
        ...(s.done ? { done: s.done } : {}),
        ...(s.files ? { files: [...s.files] } : {}),
        ...(s.clock ? { clock: describeClock(s.clock) } : {}),
        needs: [...(s.needs || [])],
      })),
    });
  });

/**
 * impure — deliver the operator's verdict to a pending plan. Untrusted:
 * unknown ids and unknown decisions are dropped; revise notes are clipped
 * at the boundary.
 * @param {Object} connection - Portal connection
 * @param {string} id - Plan id from operator:plan
 * @param {string} decision - 'approve' | 'revise'
 * @param {string} [notes] - The operator's revision notes (revise only)
 * @returns {boolean} Whether a pending plan was settled
 */
export const resolvePlanApproval = (connection, id, decision, notes) => {
  if (!PLAN_DECISIONS.includes(decision)) return false;
  const entry = connection._pendingPlans?.get(id);
  if (!entry) return false;
  const text = typeof notes === 'string' ? notes.trim().slice(0, PLAN_NOTES_MAX_CHARS) : '';
  entry.settle(decision === 'approve'
    ? { status: 'approve' }
    : { status: 'revise', ...(text ? { notes: text } : {}) });
  return true;
};

/**
 * impure — settle everything still pending as closed (portal torn down).
 * @param {Object} connection - Portal connection being torn down
 */
export const expirePendingPlans = (connection) => {
  const pending = connection._pendingPlans;
  if (!pending) return;
  for (const entry of [...pending.values()]) entry.settle({ status: 'closed' });
};

/**
 * The full submission path used by the portal handler: normalize the args,
 * resolve members against the roster, run the ENGINE's validatePlan (the
 * same gate team_run uses — approval is a promise about what will run),
 * then wait on the operator. Throws on malformed input (the message is the
 * being's correction); resolves with the verdict plus the engine-ready plan.
 *
 * impure (broker + roster reads happen in the caller-provided loaders)
 *
 * @param {Object} connection - Portal connection
 * @param {Object|undefined} args - raw tool args
 * @param {Object} deps - { roster: Array<{neumaId,name}>, signal?, decide? } — decide stands
 *   where the operator's card stands when no one is at the desk (a house wake's plan route)
 * @returns {Promise<{outcome: Object, plan: Object}>}
 */
export const submitPlan = async (connection, args, { roster, signal, decide = requestPlanApproval } = {}) => {
  const { name, goal, steps, workspace, clock = null, concurrency = null, checkIn = null } = normalizePlanArgs(args);
  const engineSteps = validatePlan(resolvePlanMembers(steps, roster));
  const memberNames = Object.fromEntries(roster.map((m) => [m.neumaId, m.name || m.neumaId]));
  const outcome = await decide(connection, {
    name, goal, steps: engineSteps, workspace, memberNames, signal, clock, concurrency, checkIn,
  });
  const governs = { ...(clock ? { clock } : {}), ...(concurrency ? { concurrency } : {}), ...(checkIn != null ? { checkIn } : {}) };
  return { outcome, plan: Object.freeze({ name, goal, steps: engineSteps, ...(workspace ? { workspace } : {}), ...governs }) };
};

/**
 * impure — make an APPROVED plan durable at the moment the verdict lands:
 * the record persists to the being's workspace (it survives relink and rides
 * the PLAN OF RECORD prompt section every turn), and the being's own steps
 * land on its task ledger — that is when tasks are formed. Never throws:
 * the approval already happened, so every failure lands in the returned note
 * instead of undoing the operator's verdict.
 *
 * @param {Object} connection - Portal connection (companion.neumaId, sessionId)
 * @param {Object} plan - the frozen engine plan submitPlan resolved with
 * @param {Array<{neumaId: string, name: string}>} roster - the operator's beings
 * @param {{approvedAt?: string, approvedBy?: Object}} [opts] - the verdict's instant; the record and
 *   the connection copy must carry ONE timestamp for the one approval; who gave it
 * @returns {Promise<{record: Object, note: string}>} note is appended to the
 *   tool result the being reads
 */
export const persistApprovedPlan = async (connection, plan, roster, { approvedAt, approvedBy = null } = {}) => {
  const neumaId = connection.companion?.neumaId || null;
  const memberNames = Object.fromEntries(roster.map((m) => [m.neumaId, m.name || m.neumaId]));
  let record = planRecordFrom(plan, {
    memberNames,
    approvedAt: approvedAt || new Date().toISOString(),
    chatId: safeChatId(connection.sessionId),
    approvedBy,
  });
  if (!neumaId) return { record, note: '' };
  let note = '';
  try {
    // Through updateTaskLedger, never read-then-write (#413): the ledger's
    // file lock is the only thing standing between a plan approval and a
    // tasks/add intent landing in the same instant, and the loser of that used to
    // be whichever write finished second — silently. Returning null when the
    // plan materializes nothing keeps this a read, with no write at all.
    let materialized = null;
    await neumaWorkspace.updateTaskLedger(neumaId, (ledger) => {
      materialized = materializePlanTasks(ledger, record, {
        selfNeumaId: neumaId, mintId: randomUUID, now: record.approvedAt,
      });
      return materialized.record === record ? null : materialized.ledger;
    });
    if (materialized && materialized.record !== record) {
      record = materialized.record;
      const n = Object.keys(record.taskIds).length;
      // task_focus / task_update left the advertised catalog with #414; a
      // being told to reach for them would be reaching for nothing.
      note = ` Your ${n} step${n === 1 ? '' : 's'} of the plan now stand on your own ledger — work them there (file a tasks/focus intent to take one up, then tasks/update with status done as each completes).`;
    }
  } catch (err) {
    log.warn('plan step materialization skipped', { neumaId, error: err.message });
    note = ` (Your steps could not be copied onto your ledger: ${err.message})`;
  }
  try {
    await neumaWorkspace.writePlanRecord(neumaId, record);
  } catch (err) {
    log.error('plan record write failed — approval survives this connection only', { neumaId, error: err.message });
    note += ' (The durable plan record could not be written; the approval stands for this session only.)';
  }
  return { record, note };
};

/**
 * impure — restore the plan of record after a relink. The connection copy is
 * memory only, but the approval was made durable when it was given — so the
 * team_run gate reads the workspace before refusing. Re-mounts the assigned
 * workspace exactly as approval did (confinement is part of the approval,
 * #171); a failed re-mount THROWS rather than restoring an unconfined plan.
 *
 * @param {Object} connection - Portal connection
 * @returns {Promise<Object|null>} the frozen plan of record, or null when none stands
 */
export const rehydrateApprovedPlan = async (connection) => {
  const neumaId = connection.companion?.neumaId || null;
  if (!neumaId) return null;
  const record = await neumaWorkspace.readPlanRecord(neumaId).catch(() => null);
  if (!record) return null;
  if (record.workspace?.root) {
    await fs.mkdir(record.workspace.root, { recursive: true });
    await ensureFilesystemRoots([record.workspace.root]);
    connection._teamWorkspace = {
      root: record.workspace.root, budgetBytes: record.workspace.budgetBytes, usedBytes: 0,
    };
  }
  connection._approvedPlan = Object.freeze({
    name: record.name ?? null,
    goal: record.goal,
    steps: record.steps,
    memberNames: record.memberNames || {},
    approvedAt: record.approvedAt,
    ...(record.workspace ? { workspace: record.workspace } : {}),
    ...(record.clock ? { clock: record.clock } : {}),
    ...(record.concurrency ? { concurrency: record.concurrency } : {}),
    ...(record.checkIn != null ? { checkIn: record.checkIn } : {}),
  });
  return connection._approvedPlan;
};

/**
 * impure — stamp the team run onto the plan of record it ran: `running` at
 * start, then `done` / `failed` / `stopped` with the report's path. The
 * stamp is how the lead (whose turn ended when the run left it) learns the
 * run's standing every turn, and how one approval stays ONE run. A record
 * superseded by a newer approval is left alone. Never throws — the run must
 * never fail on its own bookkeeping.
 *
 * @param {string} neumaId - the lead's lane
 * @param {string} approvedAt - the approval the run was dispatched under
 * @param {Object} run - { id, status, startedAt, finishedAt?, report? }
 * @returns {Promise<boolean>} whether the stamp landed
 */
export const stampPlanRun = async (neumaId, approvedAt, run) => {
  try {
    const record = await neumaWorkspace.readPlanRecord(neumaId);
    if (!record || record.approvedAt !== approvedAt) return false;
    await neumaWorkspace.writePlanRecord(neumaId, { ...record, run: Object.freeze({ ...run }) });
    return true;
  } catch (err) {
    log.warn('plan run stamp failed', { neumaId, error: err.message });
    return false;
  }
};

/**
 * impure — the run already dispatched under this approval, if any.
 *
 * @param {string} neumaId
 * @param {string} approvedAt
 * @returns {Promise<?Object>} the run stamp, or null
 */
export const runUnderApproval = async (neumaId, approvedAt) => {
  const record = await neumaWorkspace.readPlanRecord(neumaId).catch(() => null);
  return record && record.approvedAt === approvedAt && record.run ? record.run : null;
};
