/**
 * Tripwire routes — the decoy watch and the clipboard swap report, mounted at
 * /api/v1/cso/tripwire (cso-routes.js applies requireAuth).
 *
 * The decoys are the machine's: only the install owner, at the desk, turns
 * them on or off or releases a frozen program. Any signed-in operator reads
 * the state, and reports a swapped clipboard address into their own house.
 */

import express from 'express';
import { tripwire } from '../services/security/tripwire/tripwire.js';
import { clipboardFinding } from '../services/security/tripwire/tripwire-findings.js';
import { fileToHouse } from '../services/security/tripwire/tripwire-filing.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { houseKey } from '../services/staff/cos-designation.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Tripwire');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    res.json(await tripwire.status());
  } catch (error) {
    log.error('decoy watch status failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the decoy watch' });
  }
});

router.put('/', requireInstallOwner, async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be true or false' });
  }
  if (!tripwire.supported) {
    return res.status(409).json({ error: 'The decoy watch runs on Linux only for now.' });
  }
  try {
    await tripwire.setEnabled(req.body.enabled);
    log.warn('Operator switched the decoy watch', { wallet: req.walletAddress, enabled: req.body.enabled });
    res.json(await tripwire.status());
  } catch (error) {
    log.error('decoy watch switch failed', { error: error.message });
    res.status(500).json({ error: 'Could not switch the decoy watch' });
  }
});

router.post('/release', requireInstallOwner, async (req, res) => {
  const pid = Number(req.body?.pid);
  if (!Number.isInteger(pid) || pid <= 1) return res.status(400).json({ error: 'a release needs a process id' });
  try {
    const resumed = await tripwire.release(pid);
    log.warn('Operator released a frozen program', { wallet: req.walletAddress, pid, resumed });
    res.json({ resumed, ...(await tripwire.status()) });
  } catch (error) {
    log.error('release failed', { error: error.message });
    res.status(500).json({ error: 'Could not release that program' });
  }
});

router.post('/clipboard', async (req, res) => {
  const finding = clipboardFinding({ copied: req.body?.copied, found: req.body?.found, at: Date.now() });
  const house = houseKey(req.walletAddress);
  if (!finding || !house) return res.status(400).json({ error: 'a swap report needs the address copied and the different address found' });
  try {
    const entry = await fileToHouse(finding, house);
    log.warn('A copied address was replaced on the clipboard', { wallet: req.walletAddress });
    res.json({ filed: Boolean(entry) });
  } catch (error) {
    log.error('clipboard swap report failed', { error: error.message });
    res.status(500).json({ error: 'Could not file the swap' });
  }
});

export default router;
