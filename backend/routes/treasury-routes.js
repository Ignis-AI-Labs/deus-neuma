/**
 * Treasury routes — the operator's window onto the Quaestor's office and
 * the house's money. Mounted at /api/v1/treasury. Every route requires the
 * operator's Bearer token and reads or moves the SIGNED-IN operator's own
 * house only: two houses on one machine are never confused.
 *
 *   GET    /seat           the house's Quaestor (or null)
 *   PUT    /seat           seat one of the operator's own lanes {laneId}
 *   DELETE /seat           unseat
 *   GET    /board          the whole treasury (treasury-board.js)
 *   GET    /spends         every pending spend, as cards, and whether a Quaestor is seated
 *   POST   /flags/:id/seen the operator has read a Quaestor's flag
 *
 * No route here moves money. A spend is decided where it always was —
 * POST /api/v1/neuma/:id/wallet/pending/:id/approve (the operator's own
 * signature AND the being's key password) or …/reject {note?}.
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { cfoDesignation } from '../services/treasury/cfo-designation.js';
import { readTreasuryBoard } from '../services/treasury/treasury-board.js';
import { pendingSpendCards } from '../services/treasury/treasury-lanes.js';
import { markFlagSeen } from '../services/treasury/treasury-office-store.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Treasury');

const router = express.Router();
router.use(requireAuth);
// Money's standing is never cacheable: a decided spend must vanish.
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

router.get('/seat', async (req, res) => {
  try {
    res.json({ cfo: await cfoDesignation.getOfficer(req.walletAddress) });
  } catch (error) {
    log.error('Quaestor designation read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the Quaestor designation' });
  }
});

router.put('/seat', async (req, res) => {
  const laneId = typeof req.body?.laneId === 'string' ? req.body.laneId.trim() : '';
  if (!laneId) return res.status(400).json({ error: 'a Quaestor designation needs a lane id' });
  if (!(await assertNeumaOwner(req, res, laneId))) return;
  try {
    const cfo = await cfoDesignation.designate(req.walletAddress, laneId);
    log.info('Quaestor designated', { laneId: cfo.laneId, wallet: req.walletAddress });
    res.json({ cfo });
  } catch (error) {
    if (/not a lane of this house/.test(error.message)) return res.status(403).json({ error: error.message });
    log.error('Quaestor designation failed', { error: error.message });
    res.status(500).json({ error: 'Failed to designate the Quaestor' });
  }
});

router.delete('/seat', async (req, res) => {
  try {
    const officer = await cfoDesignation.getOfficer(req.walletAddress);
    if (officer?.laneId && !(await assertNeumaOwner(req, res, officer.laneId))) return;
    await cfoDesignation.clear(req.walletAddress);
    log.info('Quaestor cleared', { wallet: req.walletAddress });
    res.json({ cleared: true });
  } catch (error) {
    log.error('Quaestor clear failed', { error: error.message });
    res.status(500).json({ error: 'Failed to clear the Quaestor designation' });
  }
});

router.get('/board', async (req, res) => {
  try {
    res.json(await readTreasuryBoard(req.walletAddress));
  } catch (error) {
    log.error('the treasury could not be read', { error: error.message });
    res.status(500).json({ error: 'Failed to read the treasury' });
  }
});

router.get('/spends', async (req, res) => {
  try {
    const [spends, officer] = await Promise.all([pendingSpendCards(req.walletAddress), cfoDesignation.getOfficer(req.walletAddress)]);
    res.json({ spends, seated: Boolean(officer) });
  } catch (error) {
    log.error('pending spends could not be read', { error: error.message });
    res.status(500).json({ error: 'Failed to read the pending spends' });
  }
});

router.post('/flags/:id/seen', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^tf_[a-f0-9]{12}$/.test(id)) return res.status(400).json({ error: 'not a treasury flag id' });
  try {
    res.json({ flag: await markFlagSeen(req.walletAddress, id) });
  } catch (error) {
    if (/no such treasury flag/.test(error.message)) return res.status(404).json({ error: error.message });
    log.error('treasury flag could not be marked seen', { error: error.message });
    res.status(500).json({ error: 'Failed to mark the flag seen' });
  }
});

export default router;
