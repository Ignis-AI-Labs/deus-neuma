// /api/v1/model-server — set up a local model server for a person who has none.
// The plan is read from this machine (GET /plan); the install owner starts the setup
// (POST /install), the screen polls its progress (GET /status), and may stop it (POST /cancel).
// Before it starts, the install owner may choose the folder the models go in (POST /home).
// An NVIDIA driver older than its card needs keeps the model on the processor; the install owner
// may choose to use the graphics card anyway, or go back (POST /gpu-driver).
// Which setup runs is model-server-setup.js: the house's llama.cpp engine on Linux with an NVIDIA
// card (managed-engine.js), Ollama everywhere else (managed-ollama.js).
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { chooseGpuAnyway } from '../services/managed-ollama.js';
import { cancelJob, chooseHome, jobStatus, planView, startJob } from '../services/model-server-setup.js';
import { createLogger } from '../services/logger.js';

const router = express.Router();
const log = createLogger('ModelServerRoutes');
router.use(requireAuth);

router.get('/plan', async (req, res) => {
  try {
    res.json(await planView());
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

router.post('/home', requireInstallOwner, async (req, res) => {
  try {
    const view = await chooseHome(req.body?.home);
    log.info('model folder chosen', { home: view.homePath, wallet: req.walletAddress });
    res.json(view);
  } catch (err) {
    if (err.code === 'MODEL_HOME') return res.status(400).json({ error: err.message });
    log.error('model folder choice failed', { error: err.message });
    return res.status(500).json({ error: 'The folder could not be kept.' });
  }
});

router.get('/status', (req, res) => {
  res.json({ job: jobStatus() });
});

router.post('/cancel', requireInstallOwner, (req, res) => {
  res.json({ cancelled: cancelJob(), job: jobStatus() });
});

router.post('/gpu-driver', requireInstallOwner, async (req, res) => {
  const use = req.body?.useGpuAnyway;
  if (typeof use !== 'boolean') return res.status(400).json({ error: 'useGpuAnyway must be true or false.' });
  try {
    const guard = await chooseGpuAnyway(use, req.walletAddress || null);
    log.info('graphics driver choice', { useGpuAnyway: use, wallet: req.walletAddress, hold: guard.hold });
    return res.json({ guard });
  } catch (err) {
    log.error('graphics driver choice failed', { error: err.message });
    return res.status(500).json({ error: 'The choice could not be kept.' });
  }
});

export default router;
