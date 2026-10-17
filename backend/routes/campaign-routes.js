/**
 * Campaign routes — the operator's window onto the marketing bench.
 *
 * The bench is the organization layer over the outreach machine: campaigns
 * declared, edited, and walked in one list, and the one CMO designation that
 * seats a single being at that bench. All routes require the operator's
 * Bearer token, and every route reads and moves only the signed-in
 * operator's OWN house — its bench, its seat (Design note, 2026-10-16: two houses on
 * one machine are never confused).
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { campaignStoreFor, validateCampaign, CAMPAIGN_STATUSES } from '../services/marketing/campaign-store.js';
import { cmoDesignation } from '../services/marketing/cmo-designation.js';
import { scaffoldCmoWorkspace } from '../services/marketing/marketing-scaffold.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Campaigns');

const router = express.Router();
router.use(requireAuth);

// impure — the signed-in operator's own bench.
const benchOf = (req) => campaignStoreFor(req.walletAddress);

// The whole bench, plus the status vocabulary a board renders against.
router.get('/', async (req, res) => {
  try {
    const campaigns = await (await benchOf(req)).load();
    res.json({ campaigns, statuses: CAMPAIGN_STATUSES });
  } catch (error) {
    log.error('Campaign bench read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the campaign bench' });
  }
});

// Declare one campaign. A malformed declaration is the caller's fault (400,
// refused at the door); a store that cannot be read or written is ours (500).
router.post('/', async (req, res) => {
  const { name, brand, status, channelId, pillars, cadence, marketingPlan, funnelPlan, notes } = req.body || {};
  const invalid = validateCampaign({ name, brand, status, channelId, pillars, cadence, marketingPlan, funnelPlan, notes });
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    const campaign = await (await benchOf(req)).add({ name, brand, status, channelId, pillars, cadence, marketingPlan, funnelPlan, notes });
    log.info('Campaign declared', { id: campaign.id, wallet: req.walletAddress });
    res.status(201).json({ campaign });
  } catch (error) {
    log.error('Campaign declaration failed', { error: error.message });
    res.status(500).json({ error: 'Failed to declare the campaign' });
  }
});

// The house's seated CMO (null when its bench has no officer) — mounted
// before /:id so "cmo" is never read as a campaign id.
router.get('/cmo', async (req, res) => {
  try {
    const cmo = await cmoDesignation.getOfficer(req.walletAddress);
    res.json({ cmo });
  } catch (error) {
    log.error('CMO designation read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the CMO designation' });
  }
});

// Seat one of the operator's own lanes as their house's CMO.
router.put('/cmo', async (req, res) => {
  const laneId = typeof req.body?.laneId === 'string' ? req.body.laneId.trim() : '';
  if (!laneId) {
    return res.status(400).json({ error: 'a CMO designation needs a lane id' });
  }
  if (!(await assertNeumaOwner(req, res, laneId))) return;
  try {
    const cmo = await cmoDesignation.designate(req.walletAddress, laneId);
    log.info('CMO designated', { laneId: cmo.laneId, wallet: req.walletAddress });
    // The office on disk rides with the seat — fail-soft: a scaffold that
    // cannot land never unseats the designation.
    try {
      const { seeded } = await scaffoldCmoWorkspace(cmo.laneId);
      log.info('CMO office scaffolded', { laneId: cmo.laneId, seeded });
    } catch (scaffoldError) {
      log.error('CMO scaffold failed — the designation stands', { laneId: cmo.laneId, error: scaffoldError.message });
    }
    res.json({ cmo });
  } catch (error) {
    if (/not a lane of this house/.test(error.message)) {
      return res.status(403).json({ error: error.message });
    }
    log.error('CMO designation failed', { error: error.message });
    res.status(500).json({ error: 'Failed to designate the CMO' });
  }
});

// Unseat the house's CMO — its bench closes to every being of the house.
// Only the operator who owns the seated lane may unseat it: the clear touches
// the caller's own house alone, and a record there naming a lane the caller
// does not own is refused, never cleared on trust.
router.delete('/cmo', async (req, res) => {
  try {
    const officer = await cmoDesignation.getOfficer(req.walletAddress);
    if (officer?.laneId && !(await assertNeumaOwner(req, res, officer.laneId))) return;
    await cmoDesignation.clear(req.walletAddress);
    log.info('CMO cleared', { wallet: req.walletAddress });
    res.json({ cleared: true });
  } catch (error) {
    log.error('CMO clear failed', { error: error.message });
    res.status(500).json({ error: 'Failed to clear the CMO designation' });
  }
});

// Edit one campaign — any subset of fields, re-validated as a whole.
router.put('/:id', async (req, res) => {
  const { name, brand, status, channelId, pillars, cadence, marketingPlan, funnelPlan, notes } = req.body || {};
  try {
    const result = await (await benchOf(req)).update(req.params.id, {
      name, brand, status, channelId, pillars, cadence, marketingPlan, funnelPlan, notes,
    });
    if (!result.ok) {
      return res.status(result.error === 'no such campaign' ? 404 : 400).json({ error: result.error });
    }
    log.info('Campaign updated', { id: req.params.id, wallet: req.walletAddress });
    res.json({ campaign: result.campaign });
  } catch (error) {
    log.error('Campaign update failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to update the campaign' });
  }
});

// Tie a file to a campaign — its brief, brand voice, approved copy, reference
// material. The file's CONTENT becomes always-on context for whoever works this
// campaign, so the store crosses the same denied-path gate every tool call
// crosses; a refusal here is a 403, not a 400, because it is an access verdict.
router.post('/:id/files', async (req, res) => {
  const { path: filePath } = req.body || {};
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return res.status(400).json({ error: 'a file path is required' });
  }
  try {
    const result = await (await benchOf(req)).attachFile(req.params.id, filePath, {
      addedBy: req.walletAddress,
    });
    if (!result.ok) {
      // Switch on the store's structured `code`, never on the wording of a
      // guard's message: a reworded denial would silently downgrade a
      // secret-path refusal from 403 to 400 and no test would notice.
      const status = { 'no-campaign': 404, 'access-denied': 403 }[result.code] || 400;
      return res.status(status).json({ error: result.error });
    }
    log.info('Campaign file tied', { id: req.params.id, wallet: req.walletAddress });
    res.json({ campaign: result.campaign });
  } catch (error) {
    log.error('Campaign file attach failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to tie that file to the campaign' });
  }
});

// Untie a file. The file itself is never touched.
router.delete('/:id/files', async (req, res) => {
  const { path: filePath } = req.body || {};
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return res.status(400).json({ error: 'a file path is required' });
  }
  try {
    const result = await (await benchOf(req)).detachFile(req.params.id, filePath);
    if (!result.ok) return res.status(result.error === 'no such campaign' ? 404 : 400).json({ error: result.error });
    log.info('Campaign file untied', { id: req.params.id, wallet: req.walletAddress });
    res.json({ campaign: result.campaign });
  } catch (error) {
    log.error('Campaign file detach failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to untie that file' });
  }
});

// Drop one campaign from the bench.
router.delete('/:id', async (req, res) => {
  try {
    const removed = await (await benchOf(req)).remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'no such campaign' });
    log.info('Campaign removed', { id: req.params.id, wallet: req.walletAddress });
    res.json({ removed });
  } catch (error) {
    log.error('Campaign removal failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to remove the campaign' });
  }
});

export default router;
