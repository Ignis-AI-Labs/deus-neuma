// Connection routes — the CONNECTIONS panel's reads and the install owner's switches
// (services/connections/connection-switches.js). A flip is a deliberate act: only the install owner
// makes it, at this computer's own desk, and it is logged with the wallet that made it.

import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { connectionStates, isSwitchedConnection, setConnection } from '../services/connections/connection-switches.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('ConnectionRoutes');
const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  try {
    res.json({ connections: await connectionStates() });
  } catch (error) {
    log.error('connections read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the connections' });
  }
});

router.put('/:id', requireAuth, requireInstallOwner, async (req, res) => {
  const { id } = req.params;
  const on = req.body?.on;
  if (!isSwitchedConnection(id)) return res.status(404).json({ error: `no switch named ${id}` });
  if (typeof on !== 'boolean') return res.status(400).json({ error: 'on must be a boolean' });
  try {
    await setConnection(id, on);
    log.info('Connection switched', { id, on, wallet: req.walletAddress });
    res.json({ connections: await connectionStates() });
  } catch (error) {
    log.error('connection switch failed', { id, error: error.message });
    res.status(500).json({ error: 'Failed to save the switch' });
  }
});

export default router;
