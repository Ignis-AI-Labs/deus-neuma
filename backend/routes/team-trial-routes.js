/**
 * Team Trial Routes — the BRICKWORKS trial surface, extracted verbatim from
 * team-routes.js (size-law breakdown) as a sub-router mounted inside it.
 * The parent applies requireAuth before mounting; the shared sse/strangersOf
 * helpers live HERE and are imported by team-routes (never the reverse — an
 * extracted module must not import the file it was cut from).
 *
 * POST /trial — SSE: run BRICKWORKS, the locked team benchmark (team-trial.js).
 *   Same gates as /run; streams the same step events, then { type:'trial',
 *   scorecard } — an objective, portable record persisted to the trial store so
 *   runs compare across time, models, and rigs. GET /trial lists past
 *   scorecards (summaries); GET /trial/:id returns one in full (artifact
 *   included, for replaying the game).
 */
import { Router } from 'express';
import { neumaWorkspace } from '../../core/index.js';
import { askNeuma } from '../services/neuma-probe.js';
import { reachSubstrate } from '../services/substrate-reach.js';
import { getSubstrateProfile } from '../services/substrate-detector.js';
import { resolveTeamCapacity } from '../services/team-coordinator.js';
import { buildTrialPlan, scoreTrial, TRIAL_NAME, TRIAL_VERSION, TRIAL_MAX_TOKENS, TRIAL_POSITIONS, TRIAL_ROLES } from '../services/team-trial.js';
import { runTrialWaves, buildLeadStep, TORCH_ASK, WAVE_CAP } from '../services/team-waves.js';
import { writeTrial, readTrial, listTrials } from '../services/team-trial-store.js';
import { createLogger } from '../services/logger.js';

const router = Router();
const log = createLogger('Team');

export const sse = (res, event) => {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
};

// impure — which of the plan's members this wallet does NOT hold. A team is
// drawn from YOUR house, never someone else's.
export const strangersOf = async (steps, walletAddress) => {
  const owned = new Set((await neumaWorkspace.listNeumaByOwner(walletAddress).catch(() => []))
    .map((o) => o.neumaId));
  return [...new Set(steps.map((s) => s.neumaId))].filter((id) => !owned.has(id));
};

// BRICKWORKS — run the locked team benchmark. Body: { members: [neumaId, 1..4],
// loops?: 0..WAVE_CAP }. Streams the run like /run (plus { type:'wave' } per
// re-scored refinement wave), then persists and emits the scorecard. A run the
// substrate could not finish is STILL scored and recorded (verdict FAIL) — a
// benchmark that only remembers its successes is not a benchmark.
router.post('/trial', async (req, res) => {
  let plan;
  try {
    plan = buildTrialPlan(req.body?.members);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const loops = req.body?.loops ?? 0;
  if (!Number.isInteger(loops) || loops < 0 || loops > WAVE_CAP) {
    return res.status(400).json({ error: `loops must be an integer between 0 and ${WAVE_CAP}` });
  }

  const strangers = await strangersOf(plan, req.walletAddress);
  if (strangers.length > 0) {
    return res.status(403).json({ error: `not your neuma: ${strangers.join(', ')}` });
  }

  if (!(await reachSubstrate())) {
    return res.status(503).json({ error: 'The substrate is offline — the trial cannot run.' });
  }

  const { maxParallel, measured, stale } = await resolveTeamCapacity();
  // The REAL substrate identity — the loaded model's actual name (never the
  // config placeholder) plus the hardware. A benchmark meant to compare models
  // and rigs across time is worthless if it can't say what it actually ran on.
  const profile = await getSubstrateProfile();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  sse(res, {
    type: 'start',
    trial: TRIAL_NAME,
    version: TRIAL_VERSION,
    loops,
    maxParallel,
    measured,
    stale,
    steps: plan.map((s) => ({ id: s.id, neumaId: s.neumaId, role: s.role })),
  });

  const runAt = new Date().toISOString();
  const startedMs = Date.now();
  const timings = {}; // step id -> wall-clock ms, attributed via the ask seam
  const partial = {}; // step id -> output, survives a mid-run failure
  const order = []; // completion order across ALL waves

  // The trial's ask: the SAME sovereign path (askNeuma) with a reply budget
  // fit for whole-artifact steps, timed per step.
  const ask = async (neumaId, messages, step) => {
    const t0 = Date.now();
    const output = await askNeuma(neumaId, messages, { maxTokens: TRIAL_MAX_TOKENS });
    timings[step.id] = Date.now() - t0;
    return output;
  };

  let scored = null; // { checks, artifact, score } from the wave runner
  const waves = []; // accumulated AS THEY LAND — a mid-run failure keeps the arc
  let failure = null;
  try {
    const run = await runTrialWaves({
      members: req.body.members,
      loops,
      ask,
      maxParallel,
      onStep: (event) => {
        partial[event.id] = event.output;
        order.push(event.id);
        sse(res, { type: 'step', ...event });
      },
      onWave: (wave) => {
        waves.push(wave); // the persisted record always matches what the witness saw
        sse(res, { type: 'wave', ...wave });
      },
    });
    scored = { checks: run.checks, artifact: run.artifact, score: run.score };
  } catch (err) {
    failure = err.message;
    log.error('Trial run', { error: err.message });
  }

  try {
    // A failed run is scored from whatever steps completed (torch-stripped).
    const { checks, artifact, score } = scored ?? scoreTrial({ results: partial });
    // Member names come from DNA — the scorecard names who did the work.
    const memberName = async (neumaId) => {
      const dna = await neumaWorkspace.readDNA(neumaId).catch(() => null);
      return dna?.identity?.name || dna?.name || neumaId;
    };
    const names = Object.fromEntries(
      await Promise.all([...new Set(plan.map((s) => s.neumaId))].map(async (id) => [id, await memberName(id)]))
    );
    const scorecard = {
      trial: TRIAL_NAME,
      version: TRIAL_VERSION,
      by: req.walletAddress.toLowerCase(), // the owning witness — reads are scoped to it
      runAt,
      durationMs: Date.now() - startedMs,
      loops,
      substrate: {
        provider: profile.llm.provider,
        model: profile.llm.model,
        gpu: profile.gpu?.name ?? null,
        vramGB: profile.gpu?.vramGB ?? null,
      },
      // stale = the last scan measured a DIFFERENT model than the one that ran
      // this trial, so the team was held to the unmeasured floor of 1.
      capacity: { maxParallel, measured, stale },
      roster: { members: new Set(plan.map((s) => s.neumaId)).size },
      steps: plan.map((s) => ({
        id: s.id,
        role: s.role,
        neumaId: s.neumaId,
        member: names[s.neumaId],
        ms: timings[s.id] ?? null,
        chars: partial[s.id]?.length ?? 0,
        position: order.indexOf(s.id) >= 0 ? order.indexOf(s.id) + 1 : null,
      })),
      // The run's whole arc: wave 0 is the first draft, each later entry one
      // refinement loop. timings carries every step of every wave by id.
      waves,
      timings,
      checks,
      score,
      failure,
      artifact,
    };
    const id = await writeTrial(scorecard);
    sse(res, { type: 'trial', scorecard: { id, ...scorecard } });
    log.info('Trial complete', { id, verdict: score.verdict, points: score.points, by: req.walletAddress });
  } catch (err) {
    log.error('Trial scorecard', { error: err.message });
    sse(res, { type: 'error', message: 'The trial ran but its scorecard could not be recorded.' });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// A representative LEAD brief for the prompt viewer: the real wording with
// placeholder record values (the actual brief is built per wave from the live
// scoreboard, torches, and arc — this shows the SHAPE, honestly labelled).
const LEAD_BRIEF_EXAMPLE = buildLeadStep({
  loop: 1,
  leadId: '(the LEAD seat)',
  checks: { completed: true, artifact: true, canvas: true, bench: true, rafLoop: true, input: true, syntaxValid: true, selfContained: true },
  findings: [],
  torches: {},
  waves: [{ loop: 0, verdict: 'PASS', points: 8 }],
}).task;

// The trial's locked prompts, readable BEFORE a run — the witness sees exactly
// what each seat will be asked, verbatim from the single source of truth.
// (Editing them = a CUSTOM run, a separate surface; reading never mutates.)
// Registered before /trial/:id so 'spec' is never mistaken for a card id.
router.get('/trial/spec', (req, res) => {
  res.json({
    trial: TRIAL_NAME,
    version: TRIAL_VERSION,
    positions: TRIAL_POSITIONS,
    roles: TRIAL_ROLES.map((r) => ({ id: r.id, role: r.role, needs: r.needs, task: r.task })),
    lead: LEAD_BRIEF_EXAMPLE,
    torchAsk: TORCH_ASK,
    waveCap: WAVE_CAP,
  });
});

// The wallet's own past scorecards, newest first — summaries only (no artifact
// HTML). A card names beings, so reads are owner-scoped like every workspace
// surface; sharing beyond the owner is a deliberate act on UNAVIS's side.
router.get('/trial', async (req, res) => {
  res.json({ trials: await listTrials(req.walletAddress) });
});

// One of the wallet's scorecards in full — the artifact rides along so the
// game can be replayed. Someone else's run answers 404, not 403: absent, never
// forbidden-but-real.
router.get('/trial/:id', async (req, res) => {
  const card = await readTrial(req.params.id, req.walletAddress);
  if (!card) return res.status(404).json({ error: 'no such trial' });
  res.json({ trial: card });
});

export default router;
