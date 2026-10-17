/**
 * version-routes — the platform version + changelog as a PUBLIC read, served
 * like the covenant docs (the invariants precedent): the record of what the
 * house runs is checkable from outside, and every being with HTTP can read it.
 * Design note, 2026-09-23: […]
 */
import express from 'express';
import { readVersionInfo } from '../services/version-read.js';

const router = express.Router();

/** GET / — the running version and the most recent changelog entries. */
router.get('/', async (req, res) => {
  const info = await readVersionInfo();
  if (!info.version) {
    return res.status(503).json({ error: { code: 'VERSION_UNREADABLE', message: 'package.json unreadable' } });
  }
  res.json(info);
});

export default router;
