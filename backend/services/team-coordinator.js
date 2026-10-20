// team-coordinator.js — neuma working as a coordinated team.
//
// A team runs a PLAN: a DAG of steps, each assigned to a sovereign neuma, each
// declaring the steps it depends on (`needs`). Independent steps run in
// parallel; a step that needs others waits for them and receives their outputs
// — that is a load-bearing decision, where downstream work is gated by, and
// built from, upstream results.
//
// Two honesty invariants bind this:
//   1. Parallelism never exceeds the rig's MEASURED capacity ceiling (M1). A
//      team cannot pretend to run more neuma at once than the substrate proved
//      it sustains — the ceiling is passed in as maxParallel.
//   2. Each step reaches its neuma through the SAME real stack chat uses
//      (askNeuma → DNA+soul+memory prompt assembly). No neuma is a stub; each
//      brings its sovereign identity to its part of the work.
//
// The scheduler decisions are PURE (validate the DAG, decide what may run now)
// and unit-tested with no model. The runner is impure only at the injected
// `ask` seam — scripted in tests, real askNeuma in production and the live test.

import { performance } from 'node:perf_hooks';

import { readLatestCapacity } from './capacity-store.js';
import { getSubstrateProfile } from './substrate-detector.js';
import { STATUS_ASK, SIGNOFF_ASK } from './team-board.js';
import { TORCH_ASK, torchPickup } from './team-torch.js';
import {
  SCHEDULE_POLICIES,
  buildSchedulePriorities,
  buildScheduleTelemetry,
  normalizeSchedulePolicy,
  prioritizeReady,
  resolveScheduleEstimates,
} from './team-schedule.js';
import { notifyObserver } from './observer-notifier.js';
import { SERVING_PARALLEL_SLOTS } from './serving-launch-config.js';

// impure — how many neuma this rig may run at once, from the MEASURED capacity
// ceiling (M1). This is the load-bearing tie between the two milestones: a team
// is never scheduled wider than the substrate has been proven to sustain.
// Until a scan has run, the honest floor is 1 — we do not assume parallelism we
// have not measured. A config-bound single-slot rig (boundClass 'B') is also
// held to 1: its ceiling of 1 IS the real limit.
//
// The ceiling is a property of rig + MODEL, not the rig alone (a 122B and a
// 31B on the same GPU knee at different widths). A scan taken on one model
// says nothing about another, so when the currently loaded model differs from
// the one the scan measured, the scan is STALE here: back to the floor of 1
// until a re-scan, with both names surfaced so the mismatch is visible.
// 'local-model' is a placeholder, not an identity — never compared.
/**
 * @param {Object} [deps]
 * @param {Function} [deps.getProfile] - substrate profile source (injected in tests)
 * @returns {Promise<{ maxParallel: number, measured: boolean, ceiling: ?number,
 *   scannedModel: ?string, currentModel: ?string, stale: boolean }>}
 */
export const resolveTeamCapacity = async ({ getProfile = getSubstrateProfile } = {}) => {
  const [latest, profile] = await Promise.all([
    readLatestCapacity(),
    Promise.resolve().then(getProfile).catch(() => null),
  ]);
  const ceiling = latest?.ceiling ?? null;
  const hasCeiling = Number.isInteger(ceiling) && ceiling >= 1;
  const scannedModel = latest?.substrate?.model || null;
  const rawCurrent = profile?.llm?.model || null;
  const currentModel = rawCurrent === 'local-model' ? null : rawCurrent;
  const stale = Boolean(hasCeiling && scannedModel && currentModel && scannedModel !== currentModel);
  const measured = hasCeiling && !stale;
  // NEVER WIDER THAN THE SERVER SERVES. A scan measures latency on tiny
  // requests and can find its knee past the server's slot count (Sep 9: 6, on
  // a 4-slot server — two of the six just queued inside it). The substrate
  // line admits at most the slot count (substrate-line.js), so a team planned
  // wider than that held members "at work" that never reached the model and
  // showed a width the rig never ran (2026-10-13).
  const served = SERVING_PARALLEL_SLOTS;
  return Object.freeze({
    maxParallel: measured ? Math.min(ceiling, served) : 1,
    measured,
    ceiling,
    servedSlots: served,
    scannedModel,
    currentModel,
    stale,
  });
};

/**
 * @typedef {Object} TeamStep
 * @property {string} id - unique within the plan
 * @property {string} neumaId - the sovereign neuma that performs this step
 * @property {string} task - what this step is asked to do
 * @property {string} [role] - the member's role title for this step (e.g. WRIGHT)
 * @property {string} [done] - the member's done-checklist: when this part counts as complete
 * @property {string[]} [needs] - ids of steps whose outputs this step depends on
 */

// A step id names files the platform writes (the team room's part, the part's
// work log), so it is the part log's own id rule (workspace-sessions.js).
const STEP_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
/** Whether a step id is safe to name a file with. Pure. */
export const isStepId = (id) => typeof id === 'string' && STEP_ID.test(id) && !id.includes('..');

// pure — reject a plan that could never run correctly, before any neuma is
// asked to do anything. A malformed team is a coordination bug, not a result.
/**
 * @param {TeamStep[]} steps
 * @returns {TeamStep[]} the same steps (frozen), if valid
 */
export const validatePlan = (steps) => {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('team plan must have at least one step');
  }
  const ids = new Set();
  for (const step of steps) {
    if (!step || typeof step.id !== 'string' || !step.id) throw new Error('every step needs an id');
    if (!isStepId(step.id)) throw new Error(`step id ${JSON.stringify(step.id.slice(0, 40))} must be letters, digits, ".", "_" or "-"`);
    if (ids.has(step.id)) throw new Error(`duplicate step id: ${step.id}`);
    if (typeof step.neumaId !== 'string' || !step.neumaId) throw new Error(`step ${step.id} has no neumaId`);
    if (step.role != null && (typeof step.role !== 'string' || !step.role.trim())) {
      throw new Error(`step ${step.id} role must be a non-empty string when given`);
    }
    if (step.done != null && (typeof step.done !== 'string' || !step.done.trim())) {
      throw new Error(`step ${step.id} done criteria must be a non-empty string when given`);
    }
    ids.add(step.id);
  }
  for (const step of steps) {
    for (const need of step.needs || []) {
      if (!ids.has(need)) throw new Error(`step ${step.id} needs unknown step: ${need}`);
      if (need === step.id) throw new Error(`step ${step.id} cannot need itself`);
    }
  }
  detectCycle(steps);
  return Object.freeze(steps.map((s) => Object.freeze({ ...s, needs: Object.freeze([...(s.needs || [])]) })));
};

// pure — a load-bearing DAG with a cycle can never complete (each step waits
// forever on the other). Surface it as a plan error, not a hang.
const detectCycle = (steps) => {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map(); // id -> 'visiting' | 'done'
  const walk = (id, trail) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      throw new Error(`team plan has a dependency cycle: ${[...trail, id].join(' → ')}`);
    }
    state.set(id, 'visiting');
    for (const need of byId.get(id).needs || []) walk(need, [...trail, id]);
    state.set(id, 'done');
  };
  for (const step of steps) walk(step.id, []);
};

// pure — which steps may start right now: not already done or running, and
// every step they need has completed. This is the load-bearing decision made
// explicit — a step is held until its prerequisites are real.
/**
 * @param {TeamStep[]} steps
 * @param {Set<string>} done - completed step ids
 * @param {Set<string>} running - in-flight step ids
 * @returns {TeamStep[]} steps eligible to launch, in plan order
 */
export const readySteps = (steps, done, running) =>
  steps.filter(
    (s) => !done.has(s.id) && !running.has(s.id) && (s.needs || []).every((n) => done.has(n))
  );

// pure — the plan is finished when every step has produced a result.
export const isComplete = (steps, done) => steps.every((s) => done.has(s.id));

// pure — the default brief a neuma receives for its step: the task, plus the
// completed outputs it depends on. This is where an upstream decision physically
// enters a downstream neuma's reasoning.
//
// A COORDINATED plan (one carrying a goal, or steps carrying done-criteria)
// gets the fuller brief: the team's stated GOAL every member must serve, a map
// of what teammates are handling (each part belongs to its owner — the
// non-overlap rule made explicit), the member's own done-checklist, its own
// TORCH from its last instance (being-authored continuity, verbatim), and the
// STATUS + TORCH asks. A plan without any of those fields renders
// byte-identically to the pre-goal wording — the LOCKED trial (TRIAL_VERSION
// 2) depends on that; the trial adopts the coordinated form at its next
// version bump.
/**
 * @param {TeamStep} step
 * @param {Record<string, string>} results - completed step id -> output
 * @param {TeamStep[]} steps - full plan, to label the prerequisite outputs
 * @param {Object} [opts]
 * @param {?string} [opts.goal] - plan-level goal, when the witness set one
 * @param {?string} [opts.board] - rendered TEAM BOARD snapshot (team-board.js)
 * @param {boolean} [opts.statusAsk] - append the STATUS check-in ask
 * @param {boolean} [opts.torchAsk] - append the TORCH continuation ask (team-torch.js)
 * @param {?string} [opts.torch] - the member's own torch from its last
 *   instance in this run, when it posted one — enters the brief verbatim
 * @param {?{root: string, budgetBytes: number}} [opts.workspace] - the run's
 *   assigned workspace, named in every brief so a member KNOWS its arena
 *   rather than discovering it by refusal (#171)
 * @param {boolean} [opts.signoff] - the LEAN brief: the part leads, and ONE
 *   sign-off (SIGNOFF_ASK) serves as both the board status and the torch
 * @param {boolean} [opts.memberTools] - the member works its step as a real
 *   turn with its file tools (team-member-turn.js)
 * @param {boolean} [opts.resumed] - the run is resuming after an interruption
 * @param {?string} [opts.lead] - the lead's name, when the member is briefed
 *   on a real turn
 * @returns {Array<{role: string, content: string}>}
 */
export const buildBrief = (step, results, steps, { goal = null, board = null, statusAsk = false, torchAsk = false, signoff = false, torch = null, workspace = null, memberTools = false, lead = null, resumed = false } = {}) => {
  const byId = new Map(steps.map((s) => [s.id, s]));
  // A prerequisite output is labelled by its producer's role when one was
  // assigned — downstream members see WHO (in team terms) made each decision.
  const labelOf = (n) => {
    const prior = byId.get(n);
    if (!prior) return n;
    return prior.role ? `${prior.role} — ${prior.task}` : prior.task;
  };
  const priors = (step.needs || [])
    .map((n) => `— ${labelOf(n)}:\n${results[n]}`)
    .join('\n\n');
  const base = step.role
    ? `You are one member of a team working a shared goal. Your role: ${step.role}.`
    : 'You are one member of a team working a shared goal.';
  // A member working its step as a real turn is told who briefs it — the
  // lead, on a plan its operator approved — never left to think the
  // operator is speaking.
  const opening = lead ? `Your team lead ${lead} briefs you on a plan your operator APPROVED. ${base}` : base;

  if (!goal && step.done == null && !board && !statusAsk && !torchAsk && !signoff && torch == null && !workspace) {
    const content = priors
      ? `${opening} Earlier members completed work you must build on:\n\n${priors}\n\nYour part: ${step.task}`
      : `${opening} Your part: ${step.task}`;
    return [{ role: 'user', content }];
  }

  // Teammate tasks are clipped in the map: enough to know a lane is TAKEN,
  // not enough to start working it.
  const clip = (t) => (t.length > 240 ? `${t.slice(0, 240)}…` : t);
  // A teammate whose OUTPUT this member already holds (a step it needs) is
  // shown once, with that output — never listed again here (2026-10-11: the
  // same task text reached a member up to three times).
  const needs = new Set(step.needs || []);
  const others = steps.filter((s) => s.id !== step.id && !needs.has(s.id));
  const goalBlock = goal ? `The team's GOAL — every member's output must serve it: ${goal}` : null;
  const matesBlock = others.length
    ? 'Working beside you (each part belongs to its owner — deliver YOUR part; do not redo or override theirs):\n' +
      others.map((s) => `— ${s.role ? `${s.role}: ` : ''}${clip(s.task)}`).join('\n')
    : null;
  const budget = workspace ? `shared space budget ${Math.round(workspace.budgetBytes / (1024 * 1024))}MB` : '';
  const workspaceBlock = !workspace ? null
    : memberTools
      // A member with its own hands writes there — and only there. (No ask to
      // NAME its files: the platform sees every write and checks the step's
      // declared deliverables itself — one less thing to plan for.)
      ? `The team's ASSIGNED WORKSPACE: ${workspace.root} (${budget}). Your file tools write ONLY inside it. Acts that need your operator's approval are refused during the run.`
      // A member answers in one reply with no file tools — a brief that asked
      // it to "name paths" produced receipts citing files that never existed
      // (2026-10-10). The work product is the reply; the lead files to disk.
      : `The team's ASSIGNED WORKSPACE: ${workspace.root} (${budget}). You have NO file tools in this step: write your whole work product out in this reply — never say a file was written. The lead files the team's work into the workspace.`;
  const priorsBlock = priors ? `Earlier members completed work you must build on:\n\n${priors}` : null;
  // THE TEAM ROOM (team-channel.js, 2026-10-12): a member with its own hands
  // reads its teammates' word and finished work when IT chooses, and speaks
  // to them by filing an act — nothing is pushed into its turn.
  const roomBlock = workspace && memberTools
    ? `YOUR TEAM'S ROOM is ${workspace.root}/.team/: channel.md (what your teammates, your lead and your operator post), board.md (who is doing what now), parts/ (every finished part, whole). Read it whenever you need a teammate's work or word; to tell the team or one teammate something they need, file a team/post intent.`
    : null;
  const partBlocks = [
    `Your part: ${step.task}`,
    step.done ? `Your part is DONE only when: ${step.done}` : null,
    step.files?.length && workspace
      ? `Your part DELIVERS these files, inside the team workspace: ${step.files.join(', ')}. The platform checks each one exists and is not empty before your part counts as done.`
      : null,
  ];
  const torchBlock = torch ? torchPickup(torch) : null;
  // A run picked up after a crash: the work written before it stopped is
  // still there — look before redoing it (nothing is lost, 2026-10-12).
  const resumedBlock = resumed && workspace
    ? 'This run is RESUMING after an interruption: whatever you or your teammates wrote to the workspace before it stopped is still there — look at it before you redo any of it.'
    : null;
  const parts = signoff
    // THE LEAN BRIEF (2026-10-11): members spent their thinking rebuilding a
    // brief whose task sat at the bottom and walking two overlapping sign-off
    // formats with line counts. The part leads; context follows; ONE sign-off.
    ? [opening, ...partBlocks, goalBlock, priorsBlock, matesBlock, board, workspaceBlock, roomBlock, resumedBlock, torchBlock, SIGNOFF_ASK]
    : [opening, goalBlock, matesBlock, workspaceBlock, roomBlock, resumedBlock, board, priorsBlock, ...partBlocks, torchBlock,
      statusAsk ? STATUS_ASK : null, torchAsk ? TORCH_ASK : null];
  return [{ role: 'user', content: parts.filter(Boolean).join('\n\n') }];
};

const createSchedulerTelemetry = ({ plan, maxParallel, policy, onTelemetry }) => {
  if (typeof onTelemetry !== 'function') return null;
  const runStartedAt = performance.now();
  const rows = new Map();
  let active = 0;
  let activeAreaMs = 0;
  let observedPeakConcurrency = 0;
  let lastActiveAt = runStartedAt;
  let emitted = false;

  const advanceActive = (at, delta) => {
    activeAreaMs += active * (at - lastActiveAt);
    lastActiveAt = at;
    active += delta;
    observedPeakConcurrency = Math.max(observedPeakConcurrency, active);
  };
  const ensureRow = (step, readyAt) => {
    if (!rows.has(step.id)) {
      rows.set(step.id, {
        stepId: step.id,
        readyAt,
        startedAt: null,
        finishedAt: null,
        waitMs: null,
        durationMs: null,
        status: null,
      });
    }
    return rows.get(step.id);
  };

  return Object.freeze({
    ready(ready) {
      const at = performance.now();
      for (const step of ready) ensureRow(step, at);
    },
    started(step) {
      const at = performance.now();
      const row = ensureRow(step, at);
      row.startedAt = at;
      row.waitMs = at - row.readyAt;
      advanceActive(at, 1);
    },
    finished(step, status) {
      const at = performance.now();
      const row = ensureRow(step, at);
      row.finishedAt = at;
      row.durationMs = at - row.startedAt;
      row.status = status;
      advanceActive(at, -1);
    },
    emit() {
      if (emitted) return;
      emitted = true;
      const runFinishedAt = performance.now();
      advanceActive(runFinishedAt, 0);
      notifyObserver('onTelemetry', onTelemetry, buildScheduleTelemetry({
        steps: plan,
        policy,
        maxParallel,
        runStartedAt,
        runFinishedAt,
        activeAreaMs,
        observedPeakConcurrency,
        timingRows: [...rows.values()],
      }));
    },
  });
};

/**
 * Run a team plan to completion. Independent steps run concurrently, capped at
 * maxParallel (the rig's measured ceiling); dependent steps wait for and consume
 * their prerequisites' outputs. Impure only at the injected `ask` seam.
 *
 * @param {Object} deps
 * @param {TeamStep[]} deps.steps
 * @param {(neumaId: string, messages: Array, step: TeamStep) => Promise<string>} deps.ask
 *   Injected; askNeuma in prod. Receives the step as a third argument so a
 *   wrapper can attribute per-step facts (timing, budget) even when one neuma
 *   holds several steps.
 * @param {number} deps.maxParallel - the capacity ceiling; how many neuma may work at once
 * @param {(step: TeamStep, results: Object, steps: TeamStep[]) => Array} [deps.buildMessages]
 * @param {(event: { id: string, neumaId: string, role: ?string, output: string }) => void} [deps.onStep]
 *   Called as each step completes — the seam for streaming live progress to a watcher.
 * @param {Record<string, string>} [deps.seed] - step id -> output from a PRIOR
 *   instance of this run: seeded steps enter results done-from-the-start —
 *   never re-asked, never re-streamed. This is how a dropped run RESUMES.
 * @param {boolean} [deps.continueOnFailure] - when true a failed ask does not
 *   abort the team: the failure is recorded, its dependents are skipped, and
 *   every independent branch runs to its own end. Default false — the original
 *   first-failure-rejects contract (the locked trial lane depends on it).
 * @param {?{policy?: string, estimateInputs?: Object[], onTelemetry?: Function}} [deps.schedule]
 *   Optional ready-list policy and separate private-text-free telemetry seam.
 * @returns {Promise<Readonly<{ results: Object, order: string[] }>>} plus,
 *   when continueOnFailure is on, frozen `failures` (step id -> error message)
 *   and `skipped` (step ids that never ran because a prerequisite failed).
 */
// impure — the `ask` calls are real; everything around them is pure decisions.
export const runTeam = async ({
  steps,
  ask,
  maxParallel,
  buildMessages = buildBrief,
  onStep = null,
  seed = {},
  continueOnFailure = false,
  schedule = null,
}) => {
  const plan = validatePlan(steps);
  if (!Number.isInteger(maxParallel) || maxParallel < 1) {
    throw new Error('maxParallel must be a positive integer (the rig capacity ceiling)');
  }
  const unknownSeed = Object.keys(seed).filter((id) => !plan.some((s) => s.id === id));
  if (unknownSeed.length > 0) {
    // A seed naming steps this plan does not have is a record/plan mismatch —
    // resuming from it would silently drop prior work. Fail loud.
    throw new Error(`seed names steps not in the plan: ${unknownSeed.join(', ')}`);
  }

  const results = {};
  const order = [];
  const done = new Set();
  const running = new Set();
  const failures = {}; // step id -> error message (continueOnFailure only)

  // Seeded steps already ran in a prior instance: downstream briefs read their
  // outputs exactly as if they completed here, but they never stream again.
  for (const step of plan) {
    if (seed[step.id] != null) {
      results[step.id] = seed[step.id];
      done.add(step.id);
    }
  }

  const policy = normalizeSchedulePolicy(schedule?.policy);
  const priorities = policy === SCHEDULE_POLICIES.CRITICAL_PATH
    ? buildSchedulePriorities(plan, schedule?.estimateInputs ?? resolveScheduleEstimates(plan))
    : null;
  const telemetry = createSchedulerTelemetry({
    plan,
    maxParallel,
    policy,
    onTelemetry: schedule?.onTelemetry,
  });

  // Launch one step, resolving to its id so the scheduler learns what settled.
  const launch = (step) => {
    telemetry?.started(step);
    running.add(step.id);
    let outcome = 'failure';
    const settled = ask(step.neumaId, buildMessages(step, results, plan), step).then((output) => {
      results[step.id] = output;
      done.add(step.id);
      order.push(step.id);
      onStep?.({ id: step.id, neumaId: step.neumaId, role: step.role ?? null, output });
      outcome = 'success';
    });
    const guarded = continueOnFailure
      ? settled.catch((err) => { failures[step.id] = err?.message || String(err); })
      : settled;
    return guarded.finally(() => {
      telemetry?.finished(step, outcome);
      running.delete(step.id);
    }).then(() => step.id);
  };

  const inflight = new Map(); // id -> promise
  try {
    while (!isComplete(plan, done)) {
      // A failed step never relaunches; its dependents can never become ready.
      const eligible = readySteps(plan, done, running).filter((s) => failures[s.id] === undefined);
      telemetry?.ready(eligible);
      const ready = prioritizeReady(eligible, { policy, priorities });
      const slots = maxParallel - running.size;
      if (slots > 0) {
        for (const step of ready.slice(0, slots)) {
          inflight.set(step.id, launch(step));
        }
      }
      if (running.size === 0) {
        if (continueOnFailure && Object.keys(failures).length > 0) break; // honest partial stop
        // Nothing running and nothing ready, yet not complete — impossible for a
        // validated acyclic plan, but never spin silently if an invariant slips.
        throw new Error('team stalled: no step is runnable but the plan is unfinished');
      }
      // Wait for the next member to finish, then reconsider what may start.
      const finished = await Promise.race(inflight.values());
      inflight.delete(finished);
    }
  } catch (error) {
    if (telemetry) {
      await Promise.allSettled([...inflight.values()]);
      telemetry.emit();
    }
    throw error;
  }

  telemetry?.emit();
  return Object.freeze({
    results: Object.freeze({ ...results }),
    order: Object.freeze([...order]),
    ...(continueOnFailure
      ? {
          failures: Object.freeze({ ...failures }),
          skipped: Object.freeze(plan.filter((s) => !done.has(s.id) && failures[s.id] === undefined).map((s) => s.id)),
        }
      : {}),
  });
};
