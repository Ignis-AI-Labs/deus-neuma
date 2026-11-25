// lead-run-routes — the operator's own hand on the LEAD RUN (sales/lead-run.js; mounted inside lead-engine-routes.js,
// behind its auth): start one for an audience, see where it stands, stop it.
import express from 'express';
import { startLeadRun, stopLeadRun, clearLeadRun, leadRunOf, leadRunsOf, runRoom } from '../services/sales/lead-run.js';
import { readRunHistory, readRunLines } from '../services/sales/lead-run-record.js';
import { readRunStanding } from '../services/sales/lead-run-standing.js';
import { startListGather, listGathersOf, LIST_SOURCES } from '../services/sales/list-gather.js';
import { salesIntents } from '../services/intents/sales-acts.js';
import { readPipelineReview } from '../services/sales/pipeline-review-read.js';
import { STAGES, STANDARD } from '../services/sales/pipeline-standard.js';
import { readSchedule, setSchedule, makeSetting } from '../services/sales/lead-run-schedule.js';
import { readSegments } from '../services/sales/sales-store.js';
import { makeGoal, readGoal, setGoal } from '../services/sales/send-goal.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('LeadRunRoutes');
const router = express.Router();

// run: the one to show first; runs: every one standing (several audiences can be worked at once); room: how many may work at once.
const standing = (wallet) => ({ run: leadRunOf(wallet), runs: leadRunsOf(wallet), room: runRoom() });
router.get('/run', (req, res) => res.json(standing(req.walletAddress)));

// {segment, leads?, credits?} — the run answers at once and works beside everything else.
router.post('/run', async (req, res) => {
  const started = await startLeadRun(req.walletAddress, { segmentId: req.body?.segment, want: req.body?.leads, credits: req.body?.credits }, { intents: salesIntents }).catch((err) => ({ ok: false, reason: err.message }));
  if (!started.ok) return res.status(409).json({ error: started.reason });
  log.info('A lead run was started by the operator', { run: started.run.id, segment: started.run.segmentId, want: started.run.want });
  return res.json({ ok: true, ...standing(req.walletAddress), run: started.run });
});

// {id?} — one run by its id, or every run working.
router.post('/run/stop', (req, res) => (stopLeadRun(req.walletAddress, req.body?.id ? String(req.body.id) : null) ? res.json({ ok: true, ...standing(req.walletAddress) }) : res.status(409).json({ error: 'no such lead run is working' })));

// Where each approved audience stands for a run, and its one next step in words (lead-run-standing.js).
router.get('/run/standing', async (req, res) => {
  try {
    const running = new Set(leadRunsOf(req.walletAddress).filter((r) => r.active).map((r) => r.segmentId));
    return res.json({ audiences: await readRunStanding(req.walletAddress, { running }), lists: LIST_SOURCES, gathers: listGathersOf(req.walletAddress) });
  } catch (error) { log.error('The audiences\' standing could not be read', { error: error.message }); return res.status(500).json({ error: 'Could not read where the audiences stand' }); }
});

// THE WEEKLY SENDING GOAL (sales/send-goal.js): GET reads it; PUT {weekly, campaigns: [id]} sets it (weekly 0 takes it away).
router.get('/send-goal', async (req, res) => {
  try { return res.json({ goal: await readGoal(req.walletAddress) }); } catch (error) { log.error('The sending goal could not be read', { error: error.message }); return res.status(500).json({ error: 'Could not read the sending goal' }); }
});
router.put('/send-goal', async (req, res) => {
  let goal;
  try { goal = makeGoal(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  try { await setGoal(req.walletAddress, goal); return res.json({ ok: true, goal: await readGoal(req.walletAddress) }); } catch (error) { log.error('The sending goal could not be set', { error: error.message }); return res.status(500).json({ error: 'Could not set the sending goal' }); }
});

// THE DAILY LEAD RUN (lead-run-schedule.js): each audience's own setting. GET reads them; PUT {segment, on, leads?, credits?, hour?} sets one.
router.get('/run/schedule', async (req, res) => {
  try { return res.json({ schedule: await readSchedule(req.walletAddress) }); } catch (error) { log.error('The daily lead runs could not be read', { error: error.message }); return res.status(500).json({ error: 'Could not read the daily lead runs' }); }
});
router.put('/run/schedule', async (req, res) => {
  let setting;
  try { setting = makeSetting({ ...req.body, segmentId: req.body?.segment }); } catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const segment = (await readSegments(req.walletAddress)).find((s) => s.id === setting.segmentId);
    if (!segment) return res.status(404).json({ error: 'that is not one of this house\'s audiences' });
    if (setting.on && segment.state !== 'approved') return res.status(409).json({ error: `"${segment.name}" is ${segment.state}, not approved — approve it before it runs by itself` });
    await setSchedule(req.walletAddress, setting);
    log.info('A daily lead run was set by the operator', { segment: setting.segmentId, on: setting.on, leads: setting.leads, credits: setting.credits, hour: setting.hour });
    return res.json({ ok: true, schedule: await readSchedule(req.walletAddress) });
  } catch (error) { log.error('The daily lead run could not be set', { error: error.message }); return res.status(500).json({ error: 'Could not set the daily lead run' }); }
});

// THE PIPELINE REVIEW (pipeline-review.js): leads graded at every stage against the written standard. ?segment names
// one audience and answers whole (every lead, every failed check with its companies); without it, one line an
// audience: the counts, no rows. ?run: only the leads one run filed. ?size: how many of the newest (25).
router.get('/review', async (req, res) => {
  try {
    const one = req.query.segment ? String(req.query.segment) : null;
    const reviews = await readPipelineReview(req.walletAddress, { segmentId: one, run: req.query.run ? String(req.query.run) : null, size: req.query.size });
    const light = (r) => ({ ...r, rows: undefined, stages: r.stages.map((s) => ({ ...s, checks: s.checks.map((c) => ({ ...c, examples: undefined })) })) });
    return res.json({ reviews: one ? reviews : reviews.map(light), stages: STAGES, standard: STANDARD.map((c) => ({ id: c.id, stage: c.stage, must: c.must, says: c.says })) });
  } catch (error) { log.error('The pipeline review could not be read', { error: error.message }); return res.status(500).json({ error: 'Could not read the pipeline review' }); }
});

// {segment, source} — gather for an audience from a free public list, as many as it gives, on this press (list-gather.js).
router.post('/gather-list', async (req, res) => {
  const started = await startListGather(req.walletAddress, { segmentId: String(req.body?.segment ?? ''), source: req.body?.source }, { intents: salesIntents }).catch((err) => ({ ok: false, reason: err.message }));
  if (!started.ok) return res.status(409).json({ error: started.reason });
  log.info('A list gather was started by the operator', { segment: started.gather.segmentId, source: started.gather.source });
  return res.json({ ok: true, gather: started.gather, gathers: listGathersOf(req.walletAddress) });
});

// {id?} — clear one finished run off the desk, or every finished one. Its record stays (GET /runs).
router.post('/run/clear', (req, res) => { const cleared = clearLeadRun(req.walletAddress, req.body?.id ? String(req.body.id) : null); return res.json({ ok: true, cleared, ...standing(req.walletAddress) }); });

// EVERY run on record, newest first (cleared from the desk or not, from before a restart or not), and every line one said.
router.get('/runs', async (req, res) => {
  try { return res.json({ runs: await readRunHistory(req.walletAddress) }); } catch (error) { log.error('The run history could not be read', { error: error.message }); return res.status(500).json({ error: 'Could not read the past runs' }); }
});
router.get('/runs/:id/lines', async (req, res) => {
  try { return res.json({ lines: await readRunLines(req.walletAddress, String(req.params.id)) }); } catch (error) { log.error('A run\'s lines could not be read', { error: error.message }); return res.status(500).json({ error: 'Could not read what that run did' }); }
});

export default router;
