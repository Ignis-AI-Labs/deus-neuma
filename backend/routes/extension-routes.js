/**
 * EXTENSIONS — the house's checked third-party MCP servers. Mounted at
 * /api/v1/extensions. Reading the shelf needs a signed-in operator; every
 * change is the install owner's, because an extension runs on this computer
 * for every house it serves.
 *
 *   GET    /                    the catalog, what is installed, each one's last security check
 *   POST   /:id/install         install the pinned version, scripts off, then check it (refused = 422)
 *   POST   /:id/check           check it again now
 *   PUT    /:id/keys/:name      give it one of the keys its entry names ({value}; empty clears)
 *   POST   /:id/on · /:id/off   switch it on or off (off stops it at once)
 *   DELETE /:id                 remove it, keys included
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { createLogger } from '../services/logger.js';
import { extensionById } from '../services/extensions/extension-catalog.js';
import { ExtensionRefused } from '../services/extensions/extension-install.js';
import {
  extensionShelf, addExtension, checkExtension, giveExtensionKey, switchExtension, dropExtension,
} from '../services/extensions/extension-manage.js';

const log = createLogger('Extensions');
const router = express.Router();
router.use(requireAuth);

// Every route below names a catalog extension; anything else is not ours to touch.
const known = (req, res, next) => (extensionById(req.params.id) ? next() : res.status(404).json({ error: `no extension ${req.params.id} in the catalog` }));

const answer = (res, fn) => fn().then((body) => res.json(body ?? { ok: true })).catch((error) => {
  if (error instanceof ExtensionRefused) return res.status(422).json({ error: error.message, ...(error.detail ?? {}) });
  log.warn('extension change refused', { error: error.message });
  return res.status(400).json({ error: error.message });
});

router.get('/', (req, res) => answer(res, extensionShelf));

router.post('/:id/install', requireInstallOwner, known, (req, res) => answer(res, async () => {
  log.info('extension install asked', { id: req.params.id, wallet: req.walletAddress });
  return addExtension(req.params.id);
}));
router.post('/:id/check', requireInstallOwner, known, (req, res) => answer(res, () => checkExtension(req.params.id)));
router.put('/:id/keys/:name', requireInstallOwner, known, express.json({ limit: '16kb' }),
  (req, res) => answer(res, async () => ({ keys: await giveExtensionKey(req.params.id, req.params.name, req.body?.value) })));
router.post('/:id/on', requireInstallOwner, known, (req, res) => answer(res, () => switchExtension(req.params.id, true)));
router.post('/:id/off', requireInstallOwner, known, (req, res) => answer(res, () => switchExtension(req.params.id, false)));
router.delete('/:id', requireInstallOwner, known, (req, res) => answer(res, async () => ({ removed: await dropExtension(req.params.id) })));

export default router;
