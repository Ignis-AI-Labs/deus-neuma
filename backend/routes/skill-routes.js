// Skill routes — The Craft's operator surface (#22 S4).
//
// GET  /skills          — the installed library (menu + provenance)
// POST /skills/install  — ingest a Claude-format plugin directory from a
//                         local path (e.g. a cloned shadow-clone repo or a
//                         Claude marketplace cache dir). Auth-gated: install
//                         reads arbitrary operator-named paths, so only the
//                         authenticated witness may point it anywhere; the
//                         library is the machine's, so only its install owner.

import { Router } from 'express';
import os from 'os';
import path from 'path';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { skillService } from '../services/skill-service.js';
import { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Skills');
const router = Router();

/** True when dir is base or nested under base. */
const isUnderBase = (dir, base) => {
  const rel = path.relative(path.resolve(base), path.resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Skill install may only read plugin dirs under project, workspaces home, or
 * the operator home (W2-009) — not arbitrary absolute paths like /etc.
 */
const isAllowedSkillInstallPath = (pluginDir) => {
  const resolved = path.resolve(pluginDir);
  const bases = [process.cwd(), os.homedir()];
  try {
    const house = getWorkspacesRoot();
    if (house) bases.push(house);
  } catch { /* ignore */ }
  return bases.some((b) => isUnderBase(resolved, b));
};

router.get('/skills', requireAuth, async (req, res) => {
  try {
    const [skills, findings] = await Promise.all([
      skillService.listSkills(),
      skillService.validate(),
    ]);
    res.json({ success: true, root: skillService.root, skills, findings });
  } catch (error) {
    log.error('skill list failed', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to read the skills library' });
  }
});

router.post('/skills/install', requireAuth, requireInstallOwner, async (req, res) => {
  const pluginDir = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
  if (!pluginDir || !path.isAbsolute(pluginDir)) {
    return res.status(400).json({ success: false, error: 'path must be an absolute directory path' });
  }
  if (!isAllowedSkillInstallPath(pluginDir)) {
    return res.status(403).json({
      success: false,
      error: 'path must be under project, workspaces home, or operator home',
    });
  }
  try {
    const report = await skillService.installPluginFromPath(pluginDir, {
      force: req.body?.force === true,
    });
    res.json({ success: true, ...report });
  } catch (error) {
    log.error('plugin install failed', { pluginDir, error: error.message });
    // The reason is operator-actionable (not a plugin, collisions, bad
    // manifest) — surface it rather than a generic 500 mystery.
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
