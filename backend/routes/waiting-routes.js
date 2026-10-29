/**
 * Waiting routes — everything waiting on the signed-in operator, in one read
 * (Design note, 2026-10-24, #585: […]). Mounted at
 * /api/v1/waiting.
 *
 *   GET /   {count, oldestAt, items, gaps} — every decision owed by THIS
 *           wallet's house, oldest first (waiting-sources.js)
 *
 * Read-only: each item is decided through its own store's route, where every
 * check that decision needs already stands. The house is the caller's wallet,
 * so no route takes a house id a caller could forge.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { readWaiting } from '../services/waiting/waiting-sources.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Waiting');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    // A decision's standing is never cacheable: an answered one must vanish.
    res.set('Cache-Control', 'private, no-store');
    res.json(await readWaiting(req.walletAddress));
  } catch (error) {
    log.error('the waiting account could not be read', { error: error.message });
    res.status(500).json({ error: 'Failed to read what waits on you' });
  }
});

export default router;
