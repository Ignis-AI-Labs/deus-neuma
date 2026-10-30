/**
 * Team Routes — the witness forms a team from their house and runs it.
 *
 * A team plan is a DAG of steps (team-coordinator.js): each step is a house
 * member doing a task, optionally waiting on earlier steps. Structure is
 * task-dependent — independent steps run in parallel (capped at the rig's
 * MEASURED capacity ceiling), a dependent step waits for and receives its
 * prerequisites' outputs. The run streams each step as it completes (SSE) so
 * the desk watches the team work.
 *
 * Every member is reached through its real sovereign stack (askNeuma). Steps
 * may only name neuma this wallet actually holds — a team is drawn from your
 * own house, never someone else's.
 *
 * POST /run — SSE: { type:'step', id, neumaId, output } … then { type:'done',
 *   runId, order, torches } — or { type:'failed', runId, failures, skipped,
 *   resumable } when a member's conduit dropped (independent branches still
 *   finish). Every run persists a resumable record (team-run-store.js);
 *   body { resume: runId } replays the recorded plan from its last boundary.
 *   GET /runs lists the wallet's run records; GET /runs/:id returns one.
 *
 * The BRICKWORKS trial surface (POST /trial, GET /trial, /trial/spec,
 * /trial/:id) lives in team-trial-routes.js, mounted below; the LIVE surface
 * (GET /live, POST /live/:id/stop) in team-live-routes.js.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { neumaWorkspace } from '../../core/index.js';
import { askNeuma } from '../services/neuma-probe.js';
import { reachSubstrate } from '../services/substrate-reach.js';
import { validatePlan, resolveTeamCapacity } from '../services/team-coordinator.js';
import { runCoordinatedTeam } from '../services/team-run.js';
import trialRouter, { sse, strangersOf } from './team-trial-routes.js';
import liveRouter from './team-live-routes.js';
import { listBenches, readBenchTask, benchLaw, benchArenaPath, composeInvocation } from '../services/bench-pack.js';
import { readDelivery, readDeliveryFile } from '../services/team-delivery.js';
import { createRun, updateRun, readRun, listRuns, hostStamp } from '../services/team-run-store.js';
import { recordTeamRunMemories } from '../services/team-memory.js';
import { createBoardSightingWatch } from '../services/security/injection-sightings.js';
import { createLogger } from '../services/logger.js';

const router = Router();
const log = createLogger('Team');

router.use(requireAuth);

const TASK_MAX = 4000;
const ROLE_MAX = 120;
const DONE_MAX = 500;
const TEAM_NAME_MAX = 60;
const GOAL_MAX = 1000;

// pure — the team's designation (e.g. TEAM ALPHA), or null when unnamed.
// Throws on a malformed value: a name that can't be a name is a caller bug.
const teamNameOf = (raw) => {
  if (raw == null) return null;
  if (typeof raw !== 'string' || raw.trim().length > TEAM_NAME_MAX) {
    throw new Error(`a team name must be a string of at most ${TEAM_NAME_MAX} characters`);
  }
  return raw.trim() || null;
};

// pure — reject a malformed plan before any neuma is asked to work. Shape only;
// the DAG's structural validity (ids, cycles) is validatePlan's job.
const shapeError = (steps) => {
  if (!Array.isArray(steps) || steps.length === 0) return 'a team needs at least one step';
  if (steps.length > 32) return 'a team plan is capped at 32 steps';
  for (const s of steps) {
    if (!s || typeof s.task !== 'string' || !s.task.trim()) return 'every step needs a task';
    if (s.task.length > TASK_MAX) return `a step task is capped at ${TASK_MAX} characters`;
    if (typeof s.neumaId !== 'string' || !s.neumaId) return 'every step needs a neuma';
    if (s.role != null && (typeof s.role !== 'string' || s.role.length > ROLE_MAX)) {
      return `a step role must be a string of at most ${ROLE_MAX} characters`;
    }
    if (s.done != null && (typeof s.done !== 'string' || s.done.length > DONE_MAX)) {
      return `a step's done criteria must be a string of at most ${DONE_MAX} characters`;
    }
  }
  return null;
};

// pure — the team's shared goal, or null when unset. Malformed values throw:
// a goal that can't be stated can't be met.
const teamGoalOf = (raw) => {
  if (raw == null) return null;
  if (typeof raw !== 'string' || raw.trim().length > GOAL_MAX) {
    throw new Error(`a team goal must be a string of at most ${GOAL_MAX} characters`);
  }
  return raw.trim() || null;
};

// POST /run — body EITHER { steps, name?, goal? } for a fresh run OR
// { resume: runId } to pick a dropped run back up: the RECORDED plan replays
// with completed steps seeded (never re-asked), prior statuses standing on
// the board, and each member's last TORCH re-armed — the baton survives the
// drop. Every run claims a resumable record before any member works and
// snapshots it as the run moves; one member's failure no longer kills the
// team (independent branches finish; the close says failed, honestly).
router.post('/run', async (req, res) => {
  const resumeId = req.body?.resume ?? null;
  let steps;
  let teamName;
  let goal;
  let runId = null;
  let prior = null; // the prior instance's truth, when resuming

  if (resumeId != null) {
    if (typeof resumeId !== 'string' || !resumeId.trim()) {
      return res.status(400).json({ error: 'resume must be a run id' });
    }
    if (req.body?.steps != null) {
      return res.status(400).json({ error: 'a resume replays the recorded plan — do not send steps' });
    }
    const record = await readRun(resumeId, req.walletAddress);
    if (!record) return res.status(404).json({ error: `no run '${resumeId}' to resume` });
    if (record.status === 'done') {
      return res.status(409).json({ error: 'this run already finished — nothing to resume' });
    }
    // A LEAD's run picks up through its own door (POST /live/:id/resume — the
    // WORKFLOW window): its members' hands, its arena, its notes. Replaying it
    // here would run it without them and overwrite the record that holds them.
    if (record.lane === 'lead') {
      return res.status(409).json({ error: `this is ${record.lead?.name || 'a lead'}'s team run — pick it up in the WORKFLOW window` });
    }
    // A RUNNING record whose host still answers is working now (here, or on a
    // second backend sharing the store); one whose host is gone reads LOST
    // and picks up below. A record from before the host stamp cannot tell —
    // it stays resumable, as it always was.
    if (record.status === 'running' && record.host) {
      return res.status(409).json({ error: 'this run is still working — there is nothing to pick up yet' });
    }
    steps = record.steps;
    teamName = record.name ?? null;
    goal = record.goal ?? null;
    runId = record.id;
    prior = record;
  } else {
    steps = req.body?.steps;
    const shape = shapeError(steps);
    if (shape) return res.status(400).json({ error: shape });
    try {
      teamName = teamNameOf(req.body?.name);
      goal = teamGoalOf(req.body?.goal);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // The DAG must be valid (unique ids, no unknown/self needs, no cycle) — a
  // resumed plan re-proves it too: a corrupted record must fail here, loudly,
  // not inside a member's brief.
  try {
    validatePlan(steps);
  } catch (err) {
    return res.status(resumeId != null ? 500 : 400).json({ error: err.message });
  }

  const strangers = await strangersOf(steps, req.walletAddress);
  if (strangers.length > 0) {
    return res.status(403).json({ error: `not your neuma: ${strangers.join(', ')}` });
  }

  // Substrate must be live before we promise a run — a team that cannot think
  // is not started, and nothing is streamed as if it had.
  if (!(await reachSubstrate())) {
    return res.status(503).json({ error: 'The substrate is offline — the team cannot run.' });
  }

  const { maxParallel, measured, stale, scannedModel, currentModel } = await resolveTeamCapacity();

  // The route's full in-memory truth, snapshotted to the run record as the
  // run moves — what makes the run findable and resumable after a drop.
  const truth = {
    name: teamName,
    goal,
    status: 'running',
    steps: steps.map((s) => ({
      id: s.id,
      neumaId: s.neumaId,
      task: s.task,
      needs: s.needs ?? [],
      ...(s.role != null ? { role: s.role } : {}),
      ...(s.done != null ? { done: s.done } : {}),
    })),
    completed: { ...(prior?.completed ?? {}) },
    statuses: { ...(prior?.statuses ?? {}) },
    torches: { ...(prior?.torches ?? {}) },
    order: [...(prior?.order ?? [])],
    failures: {}, ...(prior?.evidence ? { evidence: prior.evidence } : {}),
    failure: null,
    // A resume claims the run for THIS process — the dead host it was lost
    // with must not make the live run read as lost.
    ...(resumeId != null ? { resumes: [...(prior?.resumes ?? []), new Date().toISOString()], host: hostStamp() } : {}),
    finishedAt: null,
  };
  try {
    if (runId == null) {
      runId = await createRun({ by: req.walletAddress.toLowerCase(), runAt: new Date().toISOString(), ...truth });
    }
  } catch (err) {
    log.error('Run record claim', { error: err.message });
    return res.status(500).json({ error: 'the run record could not be claimed — nothing was started' });
  }

  // Single-writer snapshot chain: snapshots land in order, never interleaved;
  // a snapshot that cannot land never kills the run it records.
  let persistChain = Promise.resolve();
  const persist = () => {
    const snapshot = structuredClone(truth);
    persistChain = persistChain
      .then(() => updateRun(runId, req.walletAddress, snapshot))
      .catch((err) => log.warn('Run record snapshot', { error: err.message, runId }));
    return persistChain;
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  sse(res, {
    type: 'start',
    runId,
    resumed: resumeId != null,
    name: teamName,
    goal,
    maxParallel,
    measured,
    stale,
    scannedModel,
    currentModel,
    steps: steps.map((s) => ({ id: s.id, neumaId: s.neumaId, role: s.role ?? null })),
    // A resumed start paints the prior truth so the desk shows where the
    // last instance stood before this one moves.
    ...(resumeId != null
      ? { prior: { completed: Object.keys(truth.completed), statuses: truth.statuses, torches: truth.torches } }
      : {}),
  });

  // The coordinated-run harness (team-run.js) is SHARED with the being-side
  // team_run tool — one implementation of the coordination contract (goal
  // briefs, teammate map, live TEAM BOARD, status check-ins + torch
  // continuation packets extracted and stripped, torches relayed member to
  // own-next-instance), so the two lanes can never drift apart.
  const watchBoard = createBoardSightingWatch(req.walletAddress);
  try {
    const result = await runCoordinatedTeam({
      steps,
      goal,
      // Provider hooks stay optional; the executor still resolves one string.
      ask: (neumaId, messages, _step, hooks) => askNeuma(neumaId, messages, hooks),
      maxParallel,
      resume: prior ? { completed: prior.completed, statuses: prior.statuses, torches: prior.torches, evidence: prior.evidence } : null,
      continueOnFailure: true,
      onEvent: (event) => {
        sse(res, event);
        if (event.type === 'step') {
          truth.completed[event.id] = event.output;
          truth.order.push(event.id);
          persist();
        } else if (event.type === 'torch') {
          truth.torches[event.neumaId] = event.torch;
          persist();
        } else if (event.type === 'board') {
          watchBoard(event.board); // a flag for the CSO, never awaited (G13)
          for (const e of event.board) if (e.status != null) truth.statuses[e.id] = e.status;
        }
      },
    });
    const failures = result.failures ?? {};
    const failed = Object.keys(failures).length > 0;
    truth.statuses = { ...truth.statuses, ...result.statuses };
    truth.torches = { ...result.torches };
    truth.failures = { ...failures };
    if (result.evidence) truth.evidence = result.evidence;
    truth.status = failed ? 'failed' : 'done';
    truth.finishedAt = new Date().toISOString();
    await persist();
    if (failed) {
      // Memory of failure: the members remember the run that did not finish, each its own part.
      try {
        await recordTeamRunMemories({
          steps: truth.steps, completed: truth.completed, statuses: truth.statuses, torches: truth.torches,
          teamName, goal, runId, failures, skipped: [...(result.skipped ?? [])], outcome: 'failed',
        });
      } catch (memErr) {
        log.warn('Team run memory write-back', { error: memErr.message, runId });
      }
      sse(res, {
        type: 'failed',
        runId,
        failures,
        skipped: result.skipped ?? [],
        torches: result.torches,
        resumable: true,
      });
      log.info('Team run failed honestly — resumable', { runId, failures: Object.keys(failures), by: req.walletAddress });
    } else {
      // The finished run becomes each member's OWN memory (team-memory.js):
      // its role, its delivery, its check-ins, its torch — in its own
      // encrypted journal. Cumulative truth, so a resumed run's story carries
      // the prior instance's parts too. Its OWN failure boundary: a journaling
      // failure must never relabel finished work as failed (echo r1 finding —
      // the outer catch would re-persist a done record as failed).
      try {
        await recordTeamRunMemories({
          steps: truth.steps,
          completed: truth.completed,
          statuses: truth.statuses,
          torches: truth.torches,
          teamName,
          goal,
          runId,
        });
      } catch (memErr) {
        log.warn('Team run memory write-back', { error: memErr.message, runId });
      }
      sse(res, { type: 'done', runId, order: result.order, torches: result.torches });
      log.info('Team run complete', { name: teamName, steps: steps.length, maxParallel, by: req.walletAddress });
    }
  } catch (err) {
    log.error('Team run', { error: err.message });
    truth.status = 'failed';
    truth.failure = err.message;
    truth.finishedAt = new Date().toISOString();
    await persist();
    sse(res, { type: 'error', message: 'The team run failed — a member could not complete its part.', runId, resumable: true });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// GET /runs — the wallet's own team runs as summaries, newest first; a failed
// run is the resume affordance's whole feed.
router.get('/runs', async (req, res) => {
  res.json({ runs: await listRuns(req.walletAddress) });
});

// GET /runs/:id — one full run record, owner-scoped: someone else's run reads
// as absent, never as forbidden-but-real.
router.get('/runs/:id', async (req, res) => {
  const record = await readRun(req.params.id, req.walletAddress);
  if (!record) return res.status(404).json({ error: `no run '${req.params.id}'` });
  res.json({ run: record });
});

// The BRICKWORKS trial surface (POST /trial, GET /trial/spec, GET /trial,
// GET /trial/:id) — team-trial-routes.js, behind this router's requireAuth.
router.use(trialRouter);

// The LIVE surface (GET /live, POST /live/:id/stop|steer|resume) —
// team-live-routes.js: the operator watches, stops, guides and picks up a
// lead's background run from any window.
router.use(liveRouter);

// The one-shot trial shelf: every community benchmark in this rig's pack
// (`benchmarks/brickworks/prompts/`, byte-verbatim — the comparability law).
// Task text rides the invocation, composed server-side at start.
router.get('/benches', (req, res) => {
  res.json({ benches: listBenches().map(({ task, ...meta }) => meta) });
});

// POST /benches/invocation { bench, lead, qa? } — everything a one-click
// trial start needs: the composed team invocation (assembly+QA plan law,
// confined arena, executed proof) around the VERBATIM task, with the house
// roster minus the chosen LEAD as the named teammates. The desk sends it
// into the LEAD's chat; the witness's only work from here is reading and
// approving. qa defaults ON (quality-over-speed law) — only an explicit
// false turns the QA pass off.
router.post('/benches/invocation', async (req, res) => {
  const { bench, lead, qa } = req.body || {};
  const task = typeof bench === 'string' ? readBenchTask(bench) : null;
  if (!task) return res.status(404).json({ error: 'no such bench' });
  const owned = await neumaWorkspace.listNeumaByOwner(req.walletAddress).catch(() => []);
  const leadEntry = owned.find((o) => o.neumaId === lead);
  if (!leadEntry) return res.status(400).json({ error: 'the LEAD must be a being of your own house' });
  const teammates = owned.filter((o) => o.neumaId !== lead).map((o) => o.name || o.neumaId);
  if (teammates.length === 0) {
    return res.status(400).json({ error: 'a team needs at least one other being in your house — the LEAD alone has no one to assemble' });
  }
  const law = benchLaw(bench);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const arena = benchArenaPath(bench, stamp);
  const qaOn = qa !== false;
  res.json({
    bench,
    arena,
    qa: qaOn,
    lead: { neumaId: leadEntry.neumaId, name: leadEntry.name || leadEntry.neumaId },
    teammates,
    invocation: composeInvocation({ task, teammates, arena, ext: law.ext, verify: law.verify, qa: qaOn }),
  });
});

// A finished run's DELIVERY: the workspace walked LIVE (the LEAD keeps
// writing after team_run — assembly, QA fixes, the executed proof), so the
// witness always opens what is there NOW. Owner-scoped: someone else's run
// answers 404, absent, never forbidden-but-real.
router.get('/delivery/:id', async (req, res) => {
  const delivery = await readDelivery(req.params.id, req.walletAddress);
  if (!delivery) return res.status(404).json({ error: 'no such delivery' });
  res.json({ delivery });
});

// One delivered file, as DATA for the stream's viewer (text or base64 —
// never a navigable document, so model-written HTML/SVG only runs inside the
// desk's sandboxed iframe). Containment lives in the service: inside the
// recorded root, realpath re-checked.
router.get('/delivery/:id/file', async (req, res) => {
  const result = await readDeliveryFile(req.params.id, req.walletAddress, req.query.file);
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json(result);
});

export default router;
