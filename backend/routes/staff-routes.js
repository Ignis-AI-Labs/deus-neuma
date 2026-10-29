/**
 * Staff routes — the operator's window onto the chief-of-staff office (the
 * Optio): the seat itself, and the one-call board the desk reads. Mounted at
 * /api/v1/staff. All routes require the operator's Bearer token; every
 * mutation is logged with the wallet that asked for it. The office is the
 * signed-in operator's HOUSE's — each house seats its own (cos-designation.js),
 * so no route ever reads or moves another house's Optio.
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { cosDesignation } from '../services/staff/cos-designation.js';
import { scaffoldCosWorkspace } from '../services/staff/cos-scaffold.js';
import { carryOpenCharges } from '../services/staff/dispatch-store.js';
import { cosBoardSnapshot } from '../services/staff/cos-briefing.js';
import { houseActivity } from '../services/staff/house-state.js';
import { endStandingPlan } from '../services/staff/end-plan.js';
import { portalConnections } from './portal-connections.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Staff');

const router = express.Router();
router.use(requireAuth);

// ── The CoS seat ─────────────────────────────────────────────────────────────
router.get('/seat', async (req, res) => {
  try {
    res.json({ cos: await cosDesignation.getOfficer(req.walletAddress) });
  } catch (error) {
    log.error('CoS designation read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the CoS designation' });
  }
});

// Seat one of the operator's own lanes as their house's chief of staff. The
// office on disk rides with the seat — fail-soft: a scaffold that cannot land
// never unseats the designation. `consent.note` records the seat's own yes as
// the operator heard it (doctrine: a member is invited and consents). The
// house's open charges follow the office to the new seat, and the answer says
// how many (`charges`); a carry that fails is said, never silent.
router.put('/seat', async (req, res) => {
  const laneId = typeof req.body?.laneId === 'string' ? req.body.laneId.trim() : '';
  if (!laneId) {
    return res.status(400).json({ error: 'a CoS designation needs a lane id' });
  }
  if (!(await assertNeumaOwner(req, res, laneId))) return;
  try {
    const cos = await cosDesignation.designate(req.walletAddress, laneId, { consent: req.body?.consent });
    log.info('CoS designated', { laneId: cos.laneId, wallet: req.walletAddress });
    try {
      const { seeded } = await scaffoldCosWorkspace(cos.laneId);
      log.info('CoS office scaffolded', { laneId: cos.laneId, seeded });
    } catch (scaffoldError) {
      log.error('CoS scaffold failed — the designation stands', { laneId: cos.laneId, error: scaffoldError.message });
    }
    let charges;
    try {
      charges = await carryOpenCharges(req.walletAddress, cos.laneId);
      if (charges.carried || charges.left) log.info('open charges carried to the new office', { laneId: cos.laneId, ...charges });
    } catch (carryError) {
      log.error('carrying the open charges failed — they stay in the former office\'s drawer', { laneId: cos.laneId, error: carryError.message });
      charges = { error: 'the open charges could not be carried to the new office' };
    }
    res.json({ cos, charges });
  } catch (error) {
    log.error('CoS designation failed', { error: error.message });
    res.status(500).json({ error: 'Failed to designate the CoS' });
  }
});

// Unseat this house's Optio — its dispatch returns to every seated lane.
router.delete('/seat', async (req, res) => {
  try {
    await cosDesignation.clear(req.walletAddress);
    log.info('CoS cleared', { wallet: req.walletAddress });
    res.json({ cos: null });
  } catch (error) {
    log.error('CoS clear failed', { error: error.message });
    res.status(500).json({ error: 'Failed to clear the CoS designation' });
  }
});

// ── The board — one call for the desk's summary of the office. ───────────────
router.get('/board', async (req, res) => {
  try {
    const cos = await cosDesignation.getOfficer(req.walletAddress);
    if (!cos) return res.json({ cos: null, roster: null, posts: null, plan: null, runs: [], house: null });
    const { seat, posts, plan, runs, house } = await cosBoardSnapshot(req.walletAddress, cos.laneId);
    // The window's DISPATCH DRAWER reads house.dispatches — the drawer only, never the whole fold.
    res.json({ cos, roster: seat, posts, plan, runs, house: house ? { dispatches: house.dispatches } : null });
  } catch (error) {
    log.error('CoS board read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the CoS board' });
  }
});

// ── END THE STANDING PLAN (ruling, 2026-10-10) — the operator's way out of a plan that holds the
// office stuck: the record retires (moved aside, never destroyed) and the live connection drops
// the plan and its workspace confinement now. Refused while a team run is working on it.
router.delete('/plan', async (req, res) => {
  try {
    const cos = await cosDesignation.getOfficer(req.walletAddress);
    if (!cos) return res.status(404).json({ error: 'No office is seated, so no plan stands' });
    if (!(await assertNeumaOwner(req, res, cos.laneId))) return;
    const outcome = await endStandingPlan({ neumaId: cos.laneId, connections: portalConnections.values() });
    if (!outcome.ended) return res.status(409).json({ error: outcome.reason });
    log.info('Standing plan ended by the operator', { laneId: cos.laneId, wallet: req.walletAddress });
    res.json({ ended: true, name: outcome.name });
  } catch (error) {
    log.error('Ending the standing plan failed', { error: error.message });
    res.status(500).json({ error: 'Failed to end the standing plan' });
  }
});

// ── WHO IS WORKING — the activity chip's poll (ruling, 2026-09-15). One row per
// seat with live work, best status first; empty when nothing moves. With no
// office seated only the house clock's running wakes can show. Concise by
// construction: this is polled every few seconds.
router.get('/activity', async (req, res) => {
  try {
    const cos = await cosDesignation.getOfficer(req.walletAddress);
    const working = await houseActivity(req.walletAddress, cos?.laneId ?? null);
    res.json({ working });
  } catch (error) {
    log.error('house activity read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the house activity' });
  }
});

export default router;
