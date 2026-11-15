/**
 * Position routes — every position of the signed-in operator's house in one
 * read (Design note, 2026-11-14: each position gets one hub holding everything it
 * handles). Mounted at /api/v1/positions.
 *
 *   GET /               {positions, members, gaps} — each position: who holds
 *                       it, its functions, what waits on the operator for it,
 *                       the connections it needs and whether each is on
 *   GET /:office/eyes   {eyes} — what the seat's holder reads at the top of
 *                       its turn (null when nobody holds the seat)
 *
 * Read-only: a seat is filled, a decision answered and a connection switched
 * through its own route, where every check that act needs already stands. The
 * house is the caller's wallet.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { positionsBoard, positionEyes } from '../services/positions/position-board.js';
import { positionOf } from '../services/positions/position-map.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Positions');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await positionsBoard(req.walletAddress));
  } catch (error) {
    log.error('the positions board could not be read', { error: error.message });
    res.status(500).json({ error: 'Failed to read the house positions' });
  }
});

router.get('/:office/eyes', async (req, res) => {
  if (!positionOf(req.params.office)) return res.status(404).json({ error: 'No such position' });
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.json({ eyes: await positionEyes(req.walletAddress, req.params.office) });
  } catch (error) {
    log.error('a position briefing could not be read', { office: req.params.office, error: error.message });
    return res.status(500).json({ error: 'Failed to read what this position is told' });
  }
});

export default router;
