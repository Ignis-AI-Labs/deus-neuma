// titling-routes — naming chats in batch as a job (titling-jobs.js): start it, read how far it has
// got, stop it. One-on-ones of the caller's own neuma only (each lane's ownership checked, as the
// workspace routes check it), or the caller's councils. The single-request routes stay as they were
// (POST /workspace/:id/sessions/autotitle, /user/realm/council-labels/autotitle).
import { Router } from 'express';
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { verifyLaneOwnership } from '../services/lane-ownership.js';
import { default as workspace } from '../../core/workspace/neuma-workspace.js';
import { cancelTitlingJob, startTitlingJob, titlingJob } from '../services/titling-jobs.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('TitlingRoutes');
const ID = /^[a-zA-Z0-9_-]+$/;
const ids = (v) => (v === undefined || v === null ? null : Array.isArray(v) && v.every((x) => ID.test(String(x))) ? v.map(String) : false);

const router = Router();
router.use(requireAuth);
router.use(express.json());

// POST /jobs {kind: 'chats', neumaIds, sessionIds?, force?} | {kind: 'councils', councilIds?, force?}
router.post('/jobs', async (req, res) => {
  const { kind, force } = req.body || {};
  const neumaIds = ids(req.body?.neumaIds);
  const sessionIds = ids(req.body?.sessionIds);
  const councilIds = ids(req.body?.councilIds);
  if (kind !== 'chats' && kind !== 'councils') return res.status(400).json({ error: 'kind is chats or councils' });
  if (neumaIds === false || sessionIds === false || councilIds === false) return res.status(400).json({ error: 'ids must be arrays of plain ids' });
  if (kind === 'chats' && !neumaIds?.length) return res.status(400).json({ error: 'name the neuma whose chats to title' });
  if (kind === 'chats') {
    for (const neumaId of neumaIds) {
      const owned = await verifyLaneOwnership({ workspace, neumaId, wallet: req.walletAddress });
      if (!owned.ok) return res.status(owned.reason === 'not-owner' ? 403 : 404).json({ error: `not your neuma: ${neumaId}` });
    }
  }
  try {
    const started = await startTitlingJob({ wallet: req.walletAddress, kind, neumaIds: neumaIds ?? [], sessionIds, councilIds, force: force === true });
    // a job already running is the answer: the desk follows it rather than starting a second
    return started.running
      ? res.json({ job: started.running, alreadyRunning: true })
      : res.status(202).json({ job: started.job });
  } catch (error) {
    log.error('titling job did not start', { error: error.message });
    return res.status(500).json({ error: `titling did not start: ${error.message}` });
  }
});

router.get('/jobs/:jobId', (req, res) => {
  const job = titlingJob(req.walletAddress, req.params.jobId);
  return job ? res.json({ job }) : res.status(404).json({ error: 'no such titling job' });
});

router.delete('/jobs/:jobId', (req, res) => {
  const job = cancelTitlingJob(req.walletAddress, req.params.jobId);
  return job ? res.json({ job }) : res.status(404).json({ error: 'no such titling job' });
});

export default router;
