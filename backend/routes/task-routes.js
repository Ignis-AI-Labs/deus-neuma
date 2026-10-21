/**
 * Task routes — the witness's todo lists.
 *
 * Two lanes, one shape (core/tasks/assigned-plan.js):
 *   /mine            the witness's own life list, realm-persisted
 *                    (<realm>/<wallet>/tasks.json) — rides their neuma's
 *                    prompt as WITNESS LIST so a being can help carry it.
 *   /neuma/:neumaId  the witness-assigned plan for one being, sovereign-
 *                    persisted (workspaces/<id>/tasks/assigned.json) — rides
 *                    that being's prompt as STANDING WORK. A sealed WITNESS lane
 *                    rides this same surface: one gate, one engine, one store.
 *   /live            every owned being's open-task COUNT in one read — the
 *                    stream rail's […].
 *
 * Auth-gated; per-neuma lanes are ownership-gated (fail-closed). Validation
 * corrections from the pure module arrive tagged `.correction` and map to
 * 400s with the safe correction text; everything else is a generic 500.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { getUserTasks, addUserTask, updateUserTask, addSubtaskToTask, updateSubtaskInTask, removeSubtaskFromTask, applyPresetToMine } from '../services/user-tasks.js';
import { houseDeadlineRecords, ownedLanes } from '../services/house-deadlines.js';
import { houseAgenda } from '../services/house-agenda/house-agenda.js';
import { mintCalendarToken, revokeCalendarToken, walletForCalendarToken } from '../services/calendar-share.js';
import { buildTasksIcs, liveDeadlines } from '../services/tasks-ics.js';
import { listPresets, createCustomPreset, deleteCustomPreset, resolvePreset } from '../services/task-presets.js';
import { neumaWorkspace } from '../../core/index.js';
import { addAssigned, updateAssigned, materializeRecurrence, addSubtask, updateSubtask, removeSubtask } from '../../core/tasks/assigned-plan.js';
import { instantiatePreset } from '../../core/tasks/task-presets.js';
import { bridgeMineCompletion } from '../services/vessel-daily-bridge.js';

const router = Router();
const log = createLogger('Tasks');

router.use(requireAuth);

// Pure-module corrections are operator-actionable 400s; tagged not-founds
// are 404s; anything else is a logged, generic 500. Returns true when it
// answered the request.
const answerError = (res, error, op) => {
  if (error.notFound) {
    res.status(404).json({ error: error.message });
    return true;
  }
  if (error.correction) {
    res.status(400).json({ error: error.message });
    return true;
  }
  log.error(op, { error: error.message });
  res.status(500).json({ error: op });
  return true;
};

// The fields a witness may author on add/update — nothing else crosses the
// boundary (status on update only; id/cadence/etc. stay server-owned).
//
// `chatId` binds a task to ONE chat of the being's, so the operator can set
// work inside a single conversation without it standing in every other one; an
// explicit null unbinds it back to lane-wide. It is admitted on the per-being
// lanes only — the operator's OWN list is their life, not chat work, and the
// /mine routes pass `withChat: false` so the field never reaches that store.
//
// `vessel` marks a daily on the operator's own list as one of their VESSEL
// dailies (settling it marks the vessel log — services/vessel-daily-bridge.js);
// on a being's lane the flag is inert but lawful (the pure module validates it).
const authoredFields = (body, { withStatus, withChat = false }) => {
  const out = {};
  for (const key of ['title', 'detail', 'cadence', 'dueDate', 'dueTime', 'startTime', 'days', 'size', 'vessel']) {
    if (body?.[key] !== undefined) out[key] = body[key];
  }
  if (withChat && body?.chatId !== undefined) out.chatId = body.chatId;
  if (withStatus && body?.status !== undefined) out.status = body.status;
  return out;
};

// --- The witness's own list ---

// GET /mine — recurrence rolled forward (and persisted when it rolled)
router.get('/mine', async (req, res) => {
  try {
    res.json({ plan: await getUserTasks(req.walletAddress) });
  } catch (error) {
    answerError(res, error, 'Could not read the task list');
  }
});

// POST /mine — { title, cadence, detail?, dueDate?, vessel? }
router.post('/mine', async (req, res) => {
  try {
    const { plan, task } = await addUserTask(req.walletAddress, authoredFields(req.body, { withStatus: false }));
    res.status(201).json({ plan, task });
  } catch (error) {
    answerError(res, error, 'Could not add the task');
  }
});

// PATCH /mine/:taskId — { status?, title?, detail?, cadence?, dueDate?, vessel? }
//
// THE VESSEL BRIDGE (Design note, 2026-08-29/31): settling a VESSEL daily on the
// operator's own list marks the vessel log in the same breath — awaited, so
// the response can say whether the mark landed (`vesselLogged: false` when
// the bridge failed; the settle itself always stands). A miss is warned and
// surfaced, never silent.
router.patch('/mine/:taskId', async (req, res) => {
  try {
    const { plan, task } = await updateUserTask(req.walletAddress, req.params.taskId, authoredFields(req.body, { withStatus: true }));
    if (task.status === 'done' && task.cadence === 'daily' && task.vessel === true) {
      try {
        await bridgeMineCompletion({ wallet: req.walletAddress, task, now: task.completedAt || new Date().toISOString() });
        return res.json({ plan, task, vesselLogged: true });
      } catch (error) {
        log.warn('vessel completion bridge failed', { error: error.message, taskId: task.id });
        return res.json({ plan, task, vesselLogged: false });
      }
    }
    res.json({ plan, task });
  } catch (error) {
    answerError(res, error, 'Could not update the task');
  }
});

// --- Subtasks on the witness's own list ---

// POST /mine/:taskId/subtasks — { title }
router.post('/mine/:taskId/subtasks', async (req, res) => {
  try {
    const { plan, task, subtask } = await addSubtaskToTask(req.walletAddress, req.params.taskId, { title: req.body?.title });
    res.status(201).json({ plan, task, subtask });
  } catch (error) {
    answerError(res, error, 'Could not add the subtask');
  }
});

// PATCH /mine/:taskId/subtasks/:subId — { status?, title? }
router.patch('/mine/:taskId/subtasks/:subId', async (req, res) => {
  try {
    const patch = {};
    if (req.body?.status !== undefined) patch.status = req.body.status;
    if (req.body?.title !== undefined) patch.title = req.body.title;
    const { plan, task, subtask } = await updateSubtaskInTask(req.walletAddress, req.params.taskId, req.params.subId, patch);
    res.json({ plan, task, subtask });
  } catch (error) {
    answerError(res, error, 'Could not update the subtask');
  }
});

// DELETE /mine/:taskId/subtasks/:subId — a retired step is removed outright
router.delete('/mine/:taskId/subtasks/:subId', async (req, res) => {
  try {
    const { plan, task } = await removeSubtaskFromTask(req.walletAddress, req.params.taskId, req.params.subId);
    res.json({ plan, task });
  } catch (error) {
    answerError(res, error, 'Could not remove the subtask');
  }
});

// --- Presets: list, save custom, delete custom, apply to a lane ---

// GET /presets — the built-in catalog plus the wallet's customs
router.get('/presets', async (req, res) => {
  try {
    res.json(await listPresets(req.walletAddress));
  } catch (error) {
    answerError(res, error, 'Could not read the presets');
  }
});

// POST /presets — save a custom preset { name, tasks: [...] }
router.post('/presets', async (req, res) => {
  try {
    const { presets, preset } = await createCustomPreset(req.walletAddress, req.body || {});
    res.status(201).json({ presets, preset });
  } catch (error) {
    answerError(res, error, 'Could not save the preset');
  }
});

// DELETE /presets/:presetId — customs only; built-ins are never deletable
router.delete('/presets/:presetId', async (req, res) => {
  try {
    res.json(await deleteCustomPreset(req.walletAddress, req.params.presetId));
  } catch (error) {
    answerError(res, error, 'Could not delete the preset');
  }
});

// POST /mine/apply-preset — { presetId } instantiates the bundle into the
// witness's own list (whole or not at all)
router.post('/mine/apply-preset', async (req, res) => {
  try {
    const preset = await resolvePreset(req.walletAddress, req.body?.presetId);
    if (!preset) return res.status(404).json({ error: 'no preset with that id' });
    const { plan, added } = await applyPresetToMine(req.walletAddress, preset);
    res.status(201).json({ plan, added });
  } catch (error) {
    answerError(res, error, 'Could not apply the preset');
  }
});

// --- How much live work every being carries (one read, not N) ---

// GET /live — the open-task count for each being this wallet owns, house and
// witness lanes alike.
//
// The stream's task rail shows […], which the desk
// first did by fetching every lane in parallel. On a real house that is a dozen
// simultaneous reads: it trips the rate limiter, and the limiter then refuses
// the operator's NEXT honest read for the better part of a minute (observed in
// the browser, 2026-07-27 — 429 with retryAfterMs ≈ 42s). One request answers
// the same question, and the server already knows the roster.
//
// Ownership is the enumeration itself: only lanes this wallet owns are counted,
// so there is nothing to gate afterwards. Counts only — no titles, no detail.
router.get('/live', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    const now = new Date().toISOString();
    const countFor = async (id) => {
      const plan = await neumaWorkspace.readAssignedPlan(id).catch(() => null);
      if (!plan) return 0;
      return materializeRecurrence(plan, now).plan.tasks.filter((t) => t.status === 'open').length;
    };

    const counts = await Promise.all((await ownedLanes(wallet)).map(async ({ laneId, kind, name }) => ({
      beingId: laneId, kind, ...(name ? { name } : {}), open: await countFor(laneId),
    })));
    res.json({ counts });
  } catch (error) {
    answerError(res, error, 'Could not read the live task counts');
  }
});

// --- The witness-assigned plan for one being (ownership-gated) ---

// GET /neuma/:neumaId — recurrence rolled forward under the file lock; the
// being's own self-authored ledger (rolled in memory — its writes persist
// through its own tool path) and its settled history ride read-only beside
// the witness's plan (the window shows them — the witness never settles
// another's self-authorship).
router.get('/neuma/:neumaId', async (req, res) => {
  try {
    if (!(await assertNeumaOwner(req, res, req.params.neumaId))) return;
    const now = new Date().toISOString();
    const [plan, ledgerRaw, history] = await Promise.all([
      neumaWorkspace.updateAssignedPlan(req.params.neumaId,
        (current) => materializeRecurrence(current, now).plan),
      neumaWorkspace.readTaskLedger(req.params.neumaId).catch(() => ({ tasks: [] })),
      neumaWorkspace.readTaskHistory(req.params.neumaId).catch(() => []),
    ]);
    // SPREAD, don't replace: materializeRecurrence answers `{tasks}` only, so
    // assigning its result would strip the ledger's `focus` map — and the desk
    // would never learn which task is being worked. (Same class of defect echo
    // caught inside the pure module: focus dying on the way through something
    // that only meant to touch tasks.)
    res.json({ plan, ledger: { ...ledgerRaw, ...materializeRecurrence(ledgerRaw, now).plan }, history });
  } catch (error) {
    answerError(res, error, 'Could not read the assigned plan');
  }
});

// POST /neuma/:neumaId — { title, cadence, detail?, dueDate? }
router.post('/neuma/:neumaId', async (req, res) => {
  try {
    if (!(await assertNeumaOwner(req, res, req.params.neumaId))) return;
    const now = new Date().toISOString();
    let task;
    const plan = await neumaWorkspace.updateAssignedPlan(req.params.neumaId, (current) => {
      const out = addAssigned(materializeRecurrence(current, now).plan, authoredFields(req.body, { withStatus: false, withChat: true }), { id: crypto.randomUUID(), now });
      task = out.task;
      return out.plan;
    });
    res.status(201).json({ plan, task });
  } catch (error) {
    answerError(res, error, 'Could not add the task');
  }
});

// PATCH /neuma/:neumaId/:taskId — { status?, title?, detail?, cadence?, dueDate? }
router.patch('/neuma/:neumaId/:taskId', async (req, res) => {
  try {
    if (!(await assertNeumaOwner(req, res, req.params.neumaId))) return;
    const now = new Date().toISOString();
    let task;
    const plan = await neumaWorkspace.updateAssignedPlan(req.params.neumaId, (current) => {
      const out = updateAssigned(materializeRecurrence(current, now).plan, { ...authoredFields(req.body, { withStatus: true, withChat: true }), id: req.params.taskId }, { now });
      task = out.task;
      return out.plan;
    });
    res.json({ plan, task });
  } catch (error) {
    answerError(res, error, 'Could not update the task');
  }
});

// --- Subtasks on a being's assigned plan (ownership-gated) ---

// POST /neuma/:neumaId/:taskId/subtasks — { title }
router.post('/neuma/:neumaId/:taskId/subtasks', async (req, res) => {
  try {
    if (!(await assertNeumaOwner(req, res, req.params.neumaId))) return;
    const now = new Date().toISOString();
    let task; let subtask;
    const plan = await neumaWorkspace.updateAssignedPlan(req.params.neumaId, (current) => {
      const out = addSubtask(materializeRecurrence(current, now).plan, { taskId: req.params.taskId, title: req.body?.title }, { id: crypto.randomUUID(), now });
      task = out.task;
      subtask = out.subtask;
      return out.plan;
    });
    res.status(201).json({ plan, task, subtask });
  } catch (error) {
    answerError(res, error, 'Could not add the subtask');
  }
});

// PATCH /neuma/:neumaId/:taskId/subtasks/:subId — { status?, title? }
router.patch('/neuma/:neumaId/:taskId/subtasks/:subId', async (req, res) => {
  try {
    if (!(await assertNeumaOwner(req, res, req.params.neumaId))) return;
    const now = new Date().toISOString();
    const patch = {};
    if (req.body?.status !== undefined) patch.status = req.body.status;
    if (req.body?.title !== undefined) patch.title = req.body.title;
    let task; let subtask;
    const plan = await neumaWorkspace.updateAssignedPlan(req.params.neumaId, (current) => {
      const out = updateSubtask(materializeRecurrence(current, now).plan, { taskId: req.params.taskId, subtaskId: req.params.subId, ...patch }, { now });
      task = out.task;
      subtask = out.subtask;
      return out.plan;
    });
    res.json({ plan, task, subtask });
  } catch (error) {
    answerError(res, error, 'Could not update the subtask');
  }
});

// DELETE /neuma/:neumaId/:taskId/subtasks/:subId — removed outright
router.delete('/neuma/:neumaId/:taskId/subtasks/:subId', async (req, res) => {
  try {
    if (!(await assertNeumaOwner(req, res, req.params.neumaId))) return;
    const now = new Date().toISOString();
    let task;
    const plan = await neumaWorkspace.updateAssignedPlan(req.params.neumaId, (current) => {
      const out = removeSubtask(materializeRecurrence(current, now).plan, { taskId: req.params.taskId, subtaskId: req.params.subId }, { now });
      task = out.task;
      return out.plan;
    });
    res.json({ plan, task });
  } catch (error) {
    answerError(res, error, 'Could not remove the subtask');
  }
});

// POST /neuma/:neumaId/apply-preset — { presetId } instantiates the bundle
// into the being's assigned plan (ownership-gated, whole or not at all)
router.post('/neuma/:neumaId/apply-preset', async (req, res) => {
  try {
    if (!(await assertNeumaOwner(req, res, req.params.neumaId))) return;
    const preset = await resolvePreset(req.walletAddress, req.body?.presetId);
    if (!preset) return res.status(404).json({ error: 'no preset with that id' });
    const now = new Date().toISOString();
    let added;
    const plan = await neumaWorkspace.updateAssignedPlan(req.params.neumaId, (current) => {
      const out = instantiatePreset(materializeRecurrence(current, now).plan, preset, { mintId: () => crypto.randomUUID(), now });
      added = out.added;
      return out.plan;
    });
    res.status(201).json({ plan, added });
  } catch (error) {
    answerError(res, error, 'Could not apply the preset');
  }
});

// --- The house's deadlines: one read for the desk's TASKS calendar and the
// --- ICS subscribe feed -----------------------------------------------

// --- The house's deadlines: one read for the desk's TASKS calendar and the
// --- ICS subscribe feed. The aggregation lives in house-deadlines.js; these
// --- routes stay thin over it. ------------------------------------------

// GET /deadlines — every deadline the house holds in one read: the
// operator's own list plus each owned lane's standing work and ledger.
router.get('/deadlines', async (req, res) => {
  try {
    res.json({ deadlines: await houseDeadlineRecords(req.walletAddress) });
  } catch (error) {
    answerError(res, error, 'Could not read the house deadlines');
  }
});

// GET /agenda?from=YYYY-MM-DD&to=YYYY-MM-DD — the house calendar: every row's
// schedule for the window (house-agenda/), this wallet's house only.
router.get('/agenda', async (req, res) => {
  try {
    res.json(await houseAgenda(req.walletAddress, { from: req.query.from, to: req.query.to }));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    answerError(res, error, 'Could not read the house agenda');
  }
});

// --- The ICS subscribe feed --------------------------------------------
//
// A calendar app cannot send the desk's Bearer session, so the feed
// authenticates with the wallet's SHARE TOKEN in the query string
// (calendar-share.js). Read-only by construction; the token is minted and
// revoked through the authed routes below. THIS ROUTER IS MOUNTED WITHOUT
// requireAuth — the token is the whole of the authentication.

export const calendarFeedRouter = Router();

router.post('/calendar-token', async (req, res) => {
  try {
    res.json(await mintCalendarToken(req.walletAddress));
  } catch (error) {
    answerError(res, error, 'Could not mint the calendar share token');
  }
});

router.delete('/calendar-token', async (req, res) => {
  try {
    await revokeCalendarToken(req.walletAddress);
    res.json({ revoked: true });
  } catch (error) {
    answerError(res, error, 'Could not revoke the calendar share token');
  }
});

calendarFeedRouter.get('/calendar.ics', async (req, res) => {
  try {
    const wallet = await walletForCalendarToken(req.query.token);
    if (!wallet) {
      res.status(401).contentType('text/plain').send('unknown or revoked calendar token');
      return;
    }
    const now = new Date();
    const body = buildTasksIcs(liveDeadlines(await houseDeadlineRecords(wallet, now), now), { now });
    res.contentType('text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="neuma-tasks.ics"');
    res.send(body);
  } catch (error) {
    log.error('calendar feed', { error: error.message });
    res.status(500).contentType('text/plain').send('could not build the calendar feed');
  }
});

export default router;
