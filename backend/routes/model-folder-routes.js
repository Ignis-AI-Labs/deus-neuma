/**
 * Model-folder routes — the operator's AUTHORIZED MODEL FOLDERS (the folder
 * law: a chosen folder both lists and authorizes its models, and names which
 * serving engines may load from it — model-folder-authority.js). Machine
 * settings, auth-gated; own module rather than a growth ring on llm-routes
 * (decomposition-first).
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { readModelFolders, setModelFolders, FOLDER_SERVERS } from '../services/model-folder-authority.js';

const router = Router();
const log = createLogger('ModelFolders');

router.use(requireAuth);

// GET / — the chosen folders (the env-root default when never set)
router.get('/', async (req, res) => {
  try {
    res.json({ folders: await readModelFolders(), servers: FOLDER_SERVERS });
  } catch (error) {
    log.error('folders read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the model folders' });
  }
});

// PUT / — replace the chosen folders: { folders: [{ path, servers? }] }
router.put('/', async (req, res) => {
  try {
    res.json({ folders: await setModelFolders(req.body?.folders), servers: FOLDER_SERVERS });
  } catch (error) {
    if (/folder|list|unique|engine|absolute/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    log.error('folders write failed', { error: error.message });
    res.status(500).json({ error: 'Could not set the model folders' });
  }
});

export default router;
