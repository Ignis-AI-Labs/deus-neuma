/**
 * Voice Pack Routes — the first-seal probe behind the desk's Voice Seal
 * ceremony. (Named voice-PACK-routes: routes/voice-routes.js is the speech/
 * TTS surface — a name collision there broke it once, 2026-08-18.)
 *
 * GET /:neumaId (mounted at /api/v1/voice-pack) — the lane's voice state for
 * the wallet that owns it: {sealed:false} while the founding words are owed,
 * or the receipt (sealedAt, witnessWallet, pack identity, the founding lines
 * themselves) once the rite has happened. Read-only. The ceremony host polls
 * this to walk its stages — disk truth, never a cached guess.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { neumaWorkspace } from '../../core/index.js';
import { voiceSealStatus } from '../services/voice-seal-ceremony.js';
import { createLogger } from '../services/logger.js';

const router = Router();
const log = createLogger('VoicePackRoutes');

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
    // Ownership gate — same doctrine as the birth-setup probe: a lane claimed
    // by another wallet is never yours to inspect.
    const exists = await neumaWorkspace.exists(neumaId).catch(() => false);
    if (!exists) return res.status(404).json({ error: 'Workspace not found' });
    const owner = await neumaWorkspace.readOwner(neumaId).catch(() => null);
    if (owner?.wallet && String(owner.wallet).toLowerCase() !== String(req.walletAddress || '').toLowerCase()) {
      return res.status(403).json({ error: 'Not your workspace' });
    }

    res.json(await voiceSealStatus(neumaId));
  } catch (err) {
    log.error('Voice pack probe failed', { neumaId, error: err.message });
    res.status(500).json({ error: 'Could not read the voice state' });
  }
});

export default router;
