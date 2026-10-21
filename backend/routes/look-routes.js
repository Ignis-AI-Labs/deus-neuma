// Look routes — the witness's cosmetic dress (Settings > LOOK).
// Auth-gated; the store validates every color at the boundary. The dress is
// the machine's (one look.json), so only the install owner changes it.

import express from 'express';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { createLogger } from '../services/logger.js';
import { lookSettings } from '../services/look-settings.js';

const router = express.Router();
const log = createLogger('Look');

router.use(requireAuth);

const STATUS_OF_CODE = Object.freeze({
  LOOK_INVALID_THEME: 400,
  LOOK_INVALID_NAME: 400,
  LOOK_PRESET_CAP: 400,
  LOOK_UNKNOWN_PRESET: 404,
});

const refuse = (res, error) => {
  const status = STATUS_OF_CODE[error.code];
  if (!status) return false;
  res.status(status).json({ error: error.message, code: error.code });
  return true;
};

// GET / — the active dress + the witness's saved presets
router.get('/', async (req, res) => {
  try {
    res.json(await lookSettings.read());
  } catch (error) {
    log.error('Look read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the look' });
  }
});

// PUT /theme — set the active dress; null restores stock LINE & CYCLE
router.put('/theme', requireInstallOwner, async (req, res) => {
  try {
    const { theme } = req.body || {};
    res.json(await lookSettings.setTheme(theme === undefined ? null : theme));
  } catch (error) {
    if (refuse(res, error)) return;
    log.error('Look theme set failed', { error: error.message });
    res.status(500).json({ error: 'Could not set the look' });
  }
});

// POST /presets — save the current knobs under a name
router.post('/presets', requireInstallOwner, async (req, res) => {
  try {
    const { name, theme } = req.body || {};
    res.json(await lookSettings.addPreset(name, theme));
  } catch (error) {
    if (refuse(res, error)) return;
    log.error('Look preset save failed', { error: error.message });
    res.status(500).json({ error: 'Could not save the preset' });
  }
});

// DELETE /presets/:id — remove one saved preset
router.delete('/presets/:id', requireInstallOwner, async (req, res) => {
  try {
    res.json(await lookSettings.removePreset(req.params.id));
  } catch (error) {
    if (refuse(res, error)) return;
    log.error('Look preset delete failed', { error: error.message });
    res.status(500).json({ error: 'Could not delete the preset' });
  }
});

export default router;
