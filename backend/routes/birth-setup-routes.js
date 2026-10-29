/**
 * Birth Setup Routes — the post-ceremony checklist probe.
 *
 * GET /:neumaId — the owed acts of a full birth (keypair custody, onchain
 * seal) for a lane the authenticated wallet owns. Read-only. This is what
 * the desk's unfinished-birth notice reads on launch: a birth that died
 * after birth:complete (crash, salvage, closed laptop) leaves these acts
 * owed, and the notice stays up until every one is checked off.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { neumaWorkspace } from '../../core/index.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { detectBirthSetupState } from '../../core/birth/birth-setup-state.js';
import { createLogger } from '../services/logger.js';

const router = Router();
const log = createLogger('BirthSetup');

router.use(requireAuth);

router.param('neumaId', (req, res, next, id) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid neumaId format' });
  }
  next();
});

router.get('/:neumaId', async (req, res) => {
  const { neumaId } = req.params;
  try {
    // Ownership gate: the lane must be claimed, and by this wallet — a missing
    // or corrupt owner record refuses (assertNeumaOwner; audit 2026-10-28 M-04).
    if (!(await assertNeumaOwner(req, res, neumaId))) return undefined;

    const state = await detectBirthSetupState(neumaWorkspace, neumaId);
    res.json(state);
  } catch (err) {
    log.error('Birth setup probe failed', { neumaId, error: err.message });
    res.status(500).json({ error: 'Could not read the birth setup state' });
  }
});

export default router;
