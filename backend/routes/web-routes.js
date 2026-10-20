// Web access routes — the operator's master switch for being internet egress.
// The switch is machine-wide (data/settings/web-access.json via
// web-settings.js); flipping it is a deliberate act, so it is logged with
// the wallet that made it — and only the install owner makes it, at this
// computer's own desk (install-owner.js). Reads report the EFFECTIVE state (a persisted ON
// under the operator's env kill-switch reports enabled: false, envLocked:
// true — never a switch that looks on while the rig is dark).

import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { webSettings } from '../services/web-settings.js';
import { activeSearchBackends } from '../services/web-search.js';
import { isBrowserRunConfigured } from '../services/browser-run.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('WebRoutes');
const router = Router();

const statePayload = async () => ({
  enabled: await webSettings.isEnabled(),
  envLocked: webSettings.isEnvLocked(),
  searchBackend: activeSearchBackends().join('+'),
  pageReader: isBrowserRunConfigured() ? 'direct+kitesurf' : 'direct',
});

router.get('/web-access', requireAuth, async (req, res) => {
  try {
    res.json(await statePayload());
  } catch (error) {
    log.error('web-access read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read web access state' });
  }
});

router.put('/web-access', requireAuth, requireInstallOwner, async (req, res) => {
  try {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    await webSettings.setEnabled(enabled);
    log.info('Web access toggled', { enabled, wallet: req.walletAddress });
    res.json(await statePayload());
  } catch (error) {
    log.error('web-access write failed', { error: error.message });
    res.status(500).json({ error: 'Failed to persist web access state' });
  }
});

export default router;
