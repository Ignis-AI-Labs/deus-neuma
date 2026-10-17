/**
 * Team LIVE routes — the operator's hands on a team that is working now.
 *
 * GET  /live            — every run this wallet owns that is working, as the
 *                         window paints it (board, torches, who leads). A
 *                         window that opens late, or after a reload, starts
 *                         here; the portal frames carry it from there.
 * POST /live/:id/stop   — body { stepId? }: stop the whole run, or one
 *                         member. The stop reaches the decode (team-run-live).
 * POST /live/:id/resume — pick a crashed, failed or stopped run up where it
 *                         stopped: its finished parts stand, the rest runs.
 * POST /live/:id/steer  — body { stepId, note }: the operator's guidance to
 *                         one member — a working member continues its part
 *                         with it, a waiting one reads it when it starts.
 * POST /live/:id/channel — body { text, to? }: the operator's word in the
 *                         TEAM CHANNEL (team-channel.js) — to everyone or one
 *                         member, read when they look; it never cuts a
 *                         member's work (the steer does that).
 * POST /live/:id/tune   — body { concurrency?, clock?, checkIn?, stepId? }: the
 *                         operator's hand on the run's WIDTH and CLOCKS
 *                         (team-run-tune.js, #577) — how many parts work at
 *                         once, and how long the run or one part may work.
 * GET  /runs/:id/log/:stepId?from=n — ONE member's work log for its part
 *                         (team-part-log.js): every attempt, its reasoning,
 *                         its acts and what they returned, its words — live
 *                         while it works, whole after; `from` reads on from
 *                         the entries a window already holds.
 *
 * Mounted by team-routes.js behind its requireAuth. Owner-scoped: someone
 * else's run reads as absent, never as forbidden-but-real.
 */
import { Router } from 'express';
import { liveRunsFor, stopRun, steerStep, ownedRun } from '../services/team-run-live.js';
import { postToChannel } from '../services/team-channel.js';
import { tuneRun } from '../services/team-run-tune.js';
import { setMemberTurn, resumeTeamRun } from '../services/intents/team-run.js';
import { runMemberTurn } from '../services/team-member-turn.js';
import { readRun } from '../services/team-run-store.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';

/** One read of a member's log returns at most this many entries; `next` reads on. */
export const PART_LOG_PAGE = 400;

// Members of a lead's run work their steps as REAL turns with their own tools.
// Wired here, in the routes layer, because the turn pipeline reaches back into
// the intents — the intent cannot import it without closing a cycle.
setMemberTurn(runMemberTurn);

const router = Router();

router.get('/live', (req, res) => {
  res.json({ runs: liveRunsFor(req.walletAddress) });
});

router.post('/live/:id/stop', (req, res) => {
  const stepId = req.body?.stepId;
  if (stepId != null && (typeof stepId !== 'string' || !stepId.trim())) {
    return res.status(400).json({ error: 'stepId, when given, names one step of the run' });
  }
  const outcome = stopRun({ id: req.params.id, wallet: req.walletAddress, stepId: stepId ?? null });
  if (!outcome.ok) return res.status(404).json({ error: outcome.reason });
  res.json({ ok: true });
});

router.post('/live/:id/steer', (req, res) => {
  const { stepId, note } = req.body || {};
  if (typeof stepId !== 'string' || !stepId.trim()) return res.status(400).json({ error: 'stepId names the member\'s step' });
  if (typeof note !== 'string') return res.status(400).json({ error: 'note is the guidance, in words' });
  const outcome = steerStep({ id: req.params.id, wallet: req.walletAddress, stepId, note });
  if (!outcome.ok) return res.status(outcome.reason === 'no such run is working' ? 404 : 409).json({ error: outcome.reason });
  res.json({ ok: true, cut: outcome.cut });
});

// The operator in the TEAM CHANNEL — a word to the whole team, or one member.
router.post('/live/:id/channel', (req, res) => {
  const entry = ownedRun(req.params.id, req.walletAddress);
  if (!entry) return res.status(404).json({ error: 'no such run is working' });
  const { text, to } = req.body || {};
  const posted = postToChannel(entry, { from: 'your operator', to: typeof to === 'string' ? to : null, text });
  if (!posted.ok) return res.status(409).json({ error: posted.reason });
  res.json({ ok: true, message: posted.message });
});

// THE OPERATOR'S HAND on a working run's width and clocks (#577).
router.post('/live/:id/tune', (req, res) => {
  const entry = ownedRun(req.params.id, req.walletAddress);
  if (!entry) return res.status(404).json({ error: 'no such run is working' });
  const { concurrency, clock, checkIn, stepId } = req.body || {};
  if (stepId != null && (typeof stepId !== 'string' || !stepId.trim())) {
    return res.status(400).json({ error: 'stepId, when given, names one step of the run' });
  }
  const outcome = tuneRun(entry, {
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(clock !== undefined ? { clock } : {}),
    ...(checkIn !== undefined ? { checkIn } : {}),
    stepId: stepId ?? null,
    by: 'your operator',
  });
  if (!outcome.ok) return res.status(400).json({ error: outcome.reason });
  res.json(outcome);
});

// RESUME — the operator picks a crashed, failed or stopped run up where it
// stopped: same record, same workspace, finished parts standing (2026-10-12).
router.post('/live/:id/resume', async (req, res) => {
  const outcome = await resumeTeamRun({ id: req.params.id, wallet: req.walletAddress });
  if (!outcome.ok) return res.status(outcome.status || 409).json({ error: outcome.reason });
  res.json({ ok: true, runId: outcome.runId });
});

// ONE MEMBER, SEPARATELY (Design note, 2026-10-12: […]). The log lives in the
// member's own encrypted lane; the run record names whose lane — and is the
// owner's gate: someone else's run reads as absent.
router.get('/runs/:id/log/:stepId', async (req, res) => {
  const record = await readRun(req.params.id, req.walletAddress);
  const step = record?.steps?.find((s) => s.id === req.params.stepId);
  if (!step) return res.status(404).json({ error: 'no such part of a run of yours' });
  let entries;
  try {
    entries = await neumaWorkspace.readTeamLog(step.neumaId, record.id, step.id);
  } catch (err) {
    return res.status(500).json({ error: `the part's log could not be read (${err.message})` });
  }
  const from = Math.max(0, Number.parseInt(req.query.from, 10) || 0);
  const page = entries.slice(from, from + PART_LOG_PAGE);
  res.json({
    stepId: step.id,
    neumaId: step.neumaId,
    member: record.names?.[step.neumaId] || step.neumaId,
    task: step.task,
    total: entries.length,
    from,
    next: from + page.length,
    entries: page,
  });
});

export default router;
