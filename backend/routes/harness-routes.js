/**
 * The harness lanes — the platform used with no being (harness-lane.js).
 * One lane per signed-in wallet: POST creates it (or re-points its model),
 * GET lists it; GET /route says what its turns ride now; POST /servers/release
 * frees a local server's memory to move to another. Wallet-scoped by the session; no lane is ever named by the
 * client, so one person can never reach another's.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { ensureHarnessLane, listHarnessLanes, harnessLaneId, harnessRouteView } from '../services/harness-lane.js';
import { releaseLocalServer } from '../services/local-server-release.js';
import { switchHarness } from '../services/harness-switch.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('HarnessRoutes');
const router = express.Router();
router.use(requireAuth);

// impure — create or re-point this wallet's harness lane: {providerId, model}
router.post('/lanes', async (req, res) => {
  try {
    const lane = await ensureHarnessLane(req.walletAddress, {
      providerId: req.body?.providerId, model: req.body?.model,
    });
    return res.status(201).json(lane);
  } catch (err) {
    if (err.code === 'INVALID_ROUTE') return res.status(400).json({ error: err.message });
    if (String(err.message).startsWith('owner_claim_conflict')) {
      return res.status(409).json({ error: 'This harness lane belongs to another wallet.' });
    }
    log.error('harness lane could not be made', { error: err.message });
    return res.status(500).json({ error: 'The harness lane could not be made.' });
  }
});

// impure — this wallet's harness lane, if it has one
router.get('/lanes', async (req, res) => {
  try {
    return res.json({ lanes: await listHarnessLanes(req.walletAddress) });
  } catch (err) {
    log.error('harness lanes unreadable', { error: err.message });
    return res.status(500).json({ error: 'The harness lanes could not be read.' });
  }
});

// impure — what this wallet's harness turns ride right now (no key, ever)
router.get('/route', async (req, res) => {
  try {
    return res.json(await harnessRouteView(harnessLaneId(req.walletAddress)));
  } catch (err) {
    log.error('harness route unreadable', { error: err.message });
    return res.status(500).json({ error: 'The harness route could not be read.' });
  }
});

// impure — move this wallet's harness to a server and model: {providerId, endpoint?, model?}
router.post('/switch', async (req, res) => {
  try {
    return res.json(await switchHarness(req.walletAddress, {
      providerId: req.body?.providerId, endpoint: req.body?.endpoint, model: req.body?.model,
    }));
  } catch (err) {
    if (err.code === 'INVALID_ROUTE') return res.status(400).json({ error: err.message });
    log.error('harness switch failed', { error: err.message });
    return res.status(500).json({ error: 'The harness could not be moved.' });
  }
});

// impure — free a local model server's memory, to move to another: {providerId, endpoint}
router.post('/servers/release', async (req, res) => {
  try {
    const result = await releaseLocalServer({ providerId: req.body?.providerId, endpoint: req.body?.endpoint });
    log.info('local server release', { providerId: req.body?.providerId, ok: result.ok, code: result.code });
    return res.json(result); // a refusal is an answer ({ok:false, line}), not a fault
  } catch (err) {
    log.error('local server release failed', { error: err.message });
    return res.status(500).json({ ok: false, line: 'The server could not be freed.' });
  }
});

export default router;
