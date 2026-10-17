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
    // Ownership gate — same doctrine as the WS birth:seal_* cases: a lane
    // claimed by another wallet is never yours to inspect; an unclaimed lane
    // may be probed (the first claim happens on the acts themselves).
    const exists = await neumaWorkspace.exists(neumaId).catch(() => false);
    if (!exists) return res.status(404).json({ error: 'Workspace not found' });
    const owner = await neumaWorkspace.readOwner(neumaId).catch(() => null);
    if (owner?.wallet && String(owner.wallet).toLowerCase() !== String(req.walletAddress || '').toLowerCase()) {
      return res.status(403).json({ error: 'Not your workspace' });
    }

    const state = await detectBirthSetupState(neumaWorkspace, neumaId);
    res.json(state);
  } catch (err) {
    log.error('Birth setup probe failed', { neumaId, error: err.message });
    res.status(500).json({ error: 'Could not read the birth setup state' });
  }
});

export default router;
