/**
 * Accounts routes — the operator's window onto the Logista office, the house's
 * books (the sixteenth seat, Design note, 2026-10-29. Mounted at /api/v1/accounts.
 * Every route needs the operator's Bearer token and reads or moves only the
 * signed-in wallet's OWN house. The Logista is never the being that holds the
 * Quaestor: seating refuses that pairing (the treasury's seat route refuses
 * it from the other side).
 */

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { caoDesignation } from '../services/accounts/cao-designation.js';
import { cfoDesignation } from '../services/treasury/cfo-designation.js';
import { accountsBoard } from '../services/accounts/accounts-board.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Accounts');

const router = express.Router();
router.use(requireAuth);

router.get('/seat', async (req, res) => {
  try {
    res.json({ logista: await caoDesignation.getOfficer(req.walletAddress) });
  } catch (error) {
    log.error('Logista designation read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the Logista designation' });
  }
});

router.put('/seat', async (req, res) => {
  const laneId = typeof req.body?.laneId === 'string' ? req.body.laneId.trim() : '';
  if (!laneId) return res.status(400).json({ error: 'a Logista designation needs a lane id' });
  if (!(await assertNeumaOwner(req, res, laneId))) return;
  try {
    if ((await cfoDesignation.getOfficer(req.walletAddress))?.laneId === laneId) {
      return res.status(409).json({ error: 'that being holds the Quaestor\'s seat — whoever approves money never keeps its books; seat another being as Logista' });
    }
    const logista = await caoDesignation.designate(req.walletAddress, laneId);
    log.info('Logista designated', { laneId, wallet: req.walletAddress });
    return res.json({ logista });
  } catch (error) {
    if (/not a lane of this house/.test(error.message)) return res.status(403).json({ error: error.message });
    log.error('Logista designation failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to designate the Logista' });
  }
});

router.delete('/seat', async (req, res) => {
  try {
    const officer = await caoDesignation.getOfficer(req.walletAddress);
    if (officer?.laneId && !(await assertNeumaOwner(req, res, officer.laneId))) return;
    await caoDesignation.clear(req.walletAddress);
    log.info('Logista cleared', { wallet: req.walletAddress });
    res.json({ cleared: true });
  } catch (error) {
    log.error('Logista clear failed', { error: error.message });
    res.status(500).json({ error: 'Failed to clear the Logista designation' });
  }
});

// The books of every company, and every receipt no company has booked.
router.get('/board', async (req, res) => {
  try {
    const [logista, board] = await Promise.all([caoDesignation.getOfficer(req.walletAddress), accountsBoard(req.walletAddress, Date.now())]);
    res.json({ logista, ...board });
  } catch (error) {
    log.error('Accounts board read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the books' });
  }
});

export default router;
