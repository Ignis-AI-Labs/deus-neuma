// /api/v1/model-server — set up a local model server for a person who has none.
// The plan is read from this machine (GET /plan); the install owner starts the setup
// (POST /install), the screen polls its progress (GET /status), and may stop it (POST /cancel).
// The work is managed-ollama.js; the decisions are managed-ollama-plan.js.
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { cancelJob, currentPlan, installHome, jobStatus, startJob } from '../services/managed-ollama.js';
import { createLogger } from '../services/logger.js';

const router = express.Router();
const log = createLogger('ModelServerRoutes');
router.use(requireAuth);

router.get('/plan', async (req, res) => {
  try {
    res.json({ plan: await currentPlan(), job: jobStatus(), home: installHome() });
  } catch (err) {
    log.error('plan failed', { error: err.message });
    res.status(500).json({ error: 'The machine could not be read for a setup plan.' });
  }
});

router.post('/install', requireInstallOwner, async (req, res) => {
  try {
    res.json({ job: await startJob() });
  } catch (err) {
    log.error('install failed to start', { error: err.message });
    res.status(500).json({ error: 'The setup could not start.' });
  }
});

router.get('/status', (req, res) => {
  res.json({ job: jobStatus() });
});

router.post('/cancel', requireInstallOwner, (req, res) => {
  res.json({ cancelled: cancelJob(), job: jobStatus() });
});

export default router;
