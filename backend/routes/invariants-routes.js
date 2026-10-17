/**
 * Platform Invariants Route
 *
 * Serves docs/reference/neuma-invariants.yaml publicly so NEUMA's no-bias
 * floor is observable by anyone, not merely readable in the repo — the […] commitment made checkable from outside.
 */

import express from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../services/logger.js';

const log = createLogger('Invariants');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INVARIANTS_PATH = path.join(
  __dirname,
  '../../docs/reference/neuma-invariants.yaml'
);

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const yaml = await readFile(INVARIANTS_PATH, 'utf8');
    res.set('Content-Type', 'application/yaml; charset=utf-8').send(yaml);
  } catch (error) {
    log.error('Could not read invariants', { error: error.message });
    res.status(500).json({ error: 'Could not read invariants' });
  }
});

export default router;
