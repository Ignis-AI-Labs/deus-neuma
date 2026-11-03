// Vision routes — the operator's image-input switch. Reads are authenticated;
// changes belong only to the install owner at the local desk.

import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { visionSettings } from '../services/vision-settings.js';
import { expireRuntimeModelCaches } from '../services/llm-runtime-cache.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('VisionRoutes');
const router = Router();

const payload = async () => ({
  enabled: await visionSettings.isEnabled(),
  envLocked: visionSettings.isEnvLocked(),
});

router.get('/', requireAuth, async (req, res) => {
  try {
    res.json(await payload());
  } catch (error) {
    log.error('vision read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read vision state' });
  }
});

router.put('/', requireAuth, requireInstallOwner, async (req, res) => {
  try {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
    await visionSettings.setEnabled(enabled);
    expireRuntimeModelCaches();
    log.info('Vision toggled', { enabled, wallet: req.walletAddress });
    res.json(await payload());
  } catch (error) {
    log.error('vision write failed', { error: error.message });
    res.status(500).json({ error: 'Failed to persist vision state' });
  }
});

export default router;
