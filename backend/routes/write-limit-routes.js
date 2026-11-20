// write-limit-routes — the operator's WRITE LIMIT (write-limit.js), under SETTINGS → SECURITY: read by any signed-in
// operator; changed only by the install owner (it loosens a guard on every being of this install). Mounted on the
// security router (security-routes.js), which signs every request in first.

import { requireInstallOwner } from '../services/install-owner.js';
import { writeLimitSettings, WRITE_LIMIT_DEFAULT, WRITE_LIMIT_MAX } from '../services/write-limit.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('WriteLimitRoutes');
const shown = (rule) => ({ ...rule, default: WRITE_LIMIT_DEFAULT, max: WRITE_LIMIT_MAX });

/** @param {import('express').Router} router the security router, behind requireAuth */
export const addWriteLimitRoutes = (router) => {
  router.get('/write-limit', async (req, res) => {
    try {
      return res.json(shown(await writeLimitSettings.read()));
    } catch (err) {
      log.error('Reading the write limit failed', { error: err.message });
      return res.status(500).json({ error: 'Could not read the write limit' });
    }
  });

  // {on?: boolean, cap?: number}: on or off, and how many writes a message.
  router.put('/write-limit', requireInstallOwner, async (req, res) => {
    try {
      const set = await writeLimitSettings.set({ on: req.body?.on, cap: req.body?.cap });
      if (!set.ok) return res.status(400).json({ error: set.reason });
      log.info('The write limit was changed', { on: set.rule.on, cap: set.rule.cap, wallet: req.walletAddress });
      return res.json(shown(set.rule));
    } catch (err) {
      log.error('Changing the write limit failed', { error: err.message });
      return res.status(500).json({ error: 'Could not change the write limit' });
    }
  });
};
