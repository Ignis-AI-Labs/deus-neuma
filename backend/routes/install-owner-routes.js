/**
 * Install owner routes — who owns this computer, and the owner's co-owners
 * (install-owner.js holds the law; Design note, 2026-10-19.
 *
 *   GET    /api/v1/install-owner                 the caller's standing + the owner record
 *   POST   /api/v1/install-owner/co-owners       { wallet } — the owner adds a co-owner
 *   DELETE /api/v1/install-owner/co-owners/:wallet           — the owner removes one
 *
 * Naming co-owners is the owner's alone (a co-owner cannot name another), and
 * only at this computer's own desk.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { readInstallOwner, standingIn, changeCoOwner, requireInstallOwnerOf } from '../services/install-owner.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('InstallOwnerRoutes');
const router = Router();
const ownerAtDesk = requireInstallOwnerOf({ ownerOnly: true });

router.use(requireAuth);

const view = (record, wallet) => ({
  standing: standingIn(record, wallet),
  owner: record?.owner ?? null,
  coOwners: record?.coOwners ?? [],
});

router.get('/', async (req, res) => {
  try {
    res.json(view(await readInstallOwner(), req.walletAddress));
  } catch (error) {
    log.error('install owner read failed', { error: error.message });
    res.status(500).json({ error: 'Could not tell who owns this computer' });
  }
});

const coOwnerChange = (add) => async (req, res) => {
  try {
    const wallet = add ? req.body?.wallet : req.params.wallet;
    const record = await changeCoOwner({ wallet, add });
    log.info(add ? 'co-owner added' : 'co-owner removed', { by: req.walletAddress, wallet: String(wallet).toLowerCase() });
    res.json(view(record, req.walletAddress));
  } catch (error) {
    if (error.code === 'BAD_WALLET') return res.status(400).json({ error: error.message });
    log.error('co-owner change failed', { error: error.message });
    return res.status(500).json({ error: 'Could not change the co-owners' });
  }
};

router.post('/co-owners', ownerAtDesk, coOwnerChange(true));
router.delete('/co-owners/:wallet', ownerAtDesk, coOwnerChange(false));

export default router;
