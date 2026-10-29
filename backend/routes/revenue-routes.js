/**
 * Revenue routes — the operator's window onto the Mercator office, the
 * house's sales seat (Design note, 2026-10-29. Mounted at /api/v1/revenue. Every route
 * needs the operator's Bearer token and reads or moves only the signed-in
 * wallet's OWN house. Seating a Mercator seeds its playbook (MAKOTO) — fail
 * soft: a scaffold that cannot land never unseats the designation.
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { croDesignation } from '../services/revenue/cro-designation.js';
import { scaffoldRevenueWorkspace } from '../services/revenue/revenue-scaffold.js';
import { readDeals } from '../services/revenue/deal-store.js';
import { pipeline } from '../services/revenue/deal-shape.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Revenue');

const router = express.Router();
router.use(requireAuth);

router.get('/seat', async (req, res) => {
  try {
    res.json({ mercator: await croDesignation.getOfficer(req.walletAddress) });
  } catch (error) {
    log.error('Mercator designation read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the Mercator designation' });
  }
});

router.put('/seat', async (req, res) => {
  const laneId = typeof req.body?.laneId === 'string' ? req.body.laneId.trim() : '';
  if (!laneId) return res.status(400).json({ error: 'a Mercator designation needs a lane id' });
  if (!(await assertNeumaOwner(req, res, laneId))) return;
  try {
    const mercator = await croDesignation.designate(req.walletAddress, laneId);
    log.info('Mercator designated', { laneId, wallet: req.walletAddress });
    try {
      await scaffoldRevenueWorkspace(laneId);
    } catch (scaffoldError) {
      log.error('Mercator scaffold failed — the designation stands', { laneId, error: scaffoldError.message });
    }
    return res.json({ mercator });
  } catch (error) {
    if (/not a lane of this house/.test(error.message)) return res.status(403).json({ error: error.message });
    log.error('Mercator designation failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to designate the Mercator' });
  }
});

router.delete('/seat', async (req, res) => {
  try {
    const officer = await croDesignation.getOfficer(req.walletAddress);
    if (officer?.laneId && !(await assertNeumaOwner(req, res, officer.laneId))) return;
    await croDesignation.clear(req.walletAddress);
    log.info('Mercator cleared', { wallet: req.walletAddress });
    res.json({ cleared: true });
  } catch (error) {
    log.error('Mercator clear failed', { error: error.message });
    res.status(500).json({ error: 'Failed to clear the Mercator designation' });
  }
});

// The sales board: the seat, the pipeline at a glance, every deal.
router.get('/board', async (req, res) => {
  try {
    const [mercator, { deals, torn }] = await Promise.all([croDesignation.getOfficer(req.walletAddress), readDeals(req.walletAddress)]);
    res.json({ mercator, pipeline: pipeline(deals), deals, torn });
  } catch (error) {
    log.error('Revenue board read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the sales board' });
  }
});

export default router;
