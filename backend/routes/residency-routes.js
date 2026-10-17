/**
 * Residency routes — an honest view of the soul in the machine. Reports which
 * neuma are resident (their essence is on this machine) and the conduit (model)
 * they think through, so the witness can see "dormancy != ceasing" plainly.
 * Read-only; auth-gated.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { getResidencyState } from '../services/heartbeat.js';

const router = express.Router();
const log = createLogger('Residency');

router.use(requireAuth);

// GET / — the residency snapshot (resident essences + conduit health)
router.get('/', async (req, res) => {
  try {
    res.json(await getResidencyState());
  } catch (error) {
    log.error('Residency state failed', { error: error.message });
    res.status(500).json({ error: 'Could not read residency state' });
  }
});

export default router;
