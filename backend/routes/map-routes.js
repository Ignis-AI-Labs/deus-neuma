/**
 * Map routes — the architecture map of a folder the witness works in.
 * Auth-gated. The scan target is decided in order: an explicit `?folder=`
 * (the window's focus) — an UNTRUSTED client path that must clear
 * resolveFocusPath (the one focus-path containment chokepoint: inside the
 * opened explorer roots, symlinks resolved, an existing directory; anything
 * else is a flat 403, never an existence oracle) — else the NEUMA repo
 * itself. The scan never reaches outside
 * folders the witness has already opened. `?findings=1` reports what is NEW
 * since the repo's committed baseline (the CLI's compiler's bargain, #391);
 * `?findings=1&full=1` is the whole plan-ready backlog, and a repo with no
 * baseline gets the full report unasked.
 */
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { resolveFocusPath } from '../services/user-files.js';
// Off the event loop: a scan is seconds of CPU (scan-offthread.js).
import { scanArchitectureOffThread as scanArchitecture, scanCheckOffThread as scanCheck, scanFindingsOffThread as scanFindings } from '../services/mapview/scan-offthread.js';

const router = express.Router();
const log = createLogger('Map');

// No focus → the map defaults to the NEUMA repo itself
// (the app's own home — it always exists and is always worth seeing).
// Anchored to this file, not process.cwd(), so the default survives wherever
// the backend is launched from. Server-decided only.
const HOME_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

router.use(requireAuth);

// GET / — architecture map (?findings=1 for the report). `?folder=` scans the
// window's focus folder (containment-checked); with none, the honest default:
// the NEUMA repo, flagged as such.
router.get('/', async (req, res) => {
  try {
    const requested = req.query.folder;
    const focused = requested !== undefined ? resolveFocusPath(requested) : null;
    if (requested !== undefined && focused === null) {
      return res.status(403).json({ error: 'Folder outside the opened roots' });
    }
    const folder = focused || HOME_REPO;
    const stat = await fs.stat(folder).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return res.status(404).json({ error: 'No folder to map — open a folder first.' });
    }
    const wantFindings = req.query.findings === '1' || req.query.findings === 'true';
    if (wantFindings) {
      // Delta by default (#391) — the same compiler's bargain the CLI keeps:
      // only findings NEW since the repo's committed baseline. The full
      // backlog stays reachable behind ?full=1; a repo with no baseline gets
      // the full report, the honest reading when nothing was ever accepted.
      const wantFull = req.query.full === '1' || req.query.full === 'true';
      if (!wantFull) {
        const check = await scanCheck(folder);
        if (check.baselined) return res.json(check);
      }
      return res.json(await scanFindings(folder));
    }
    const graph = await scanArchitecture(folder);
    const projectInfo = focused
      ? { name: path.basename(focused), focus: true }
      : { name: 'neuma', default: true };
    return res.json({ project: projectInfo, graph });
  } catch (err) {
    log.error('Architecture scan failed', { error: err?.message });
    return res.status(500).json({ error: 'Failed to map the project.' });
  }
});

export default router;
