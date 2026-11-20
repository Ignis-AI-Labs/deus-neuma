// system-dictation-routes — dictation in every app (system-dictation.js): what it needs here and
// whether it is on (any signed-in desk reads), and turning it on or off or choosing its key (the
// install owner at the desk only: it reads this computer's keyboard and types into its windows).
import { Router } from 'express';
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { HOLD_KEYS } from '../services/system-dictation/input-events.js';
import {
  readSystemDictation, saveSystemDictation, systemDictationListening, systemDictationReadiness,
} from '../services/system-dictation/system-dictation.js';

const router = Router();
router.use(requireAuth);

const keys = Object.entries(HOLD_KEYS).map(([id, k]) => ({ id, label: k.label }));

router.get('/', async (_req, res) => {
  res.json({ ...readSystemDictation(), listening: systemDictationListening(), keys, readiness: await systemDictationReadiness() });
});

router.put('/', requireInstallOwner, express.json(), async (req, res) => {
  const { on, key } = req.body || {};
  if (typeof on !== 'boolean') return res.status(400).json({ error: 'on must be true or false' });
  if (key !== undefined && !HOLD_KEYS[key]) return res.status(400).json({ error: `key is one of ${Object.keys(HOLD_KEYS).join(', ')}` });
  const saved = await saveSystemDictation({ on, key });
  return res.json({ ...saved, keys, readiness: await systemDictationReadiness() });
});

export default router;
