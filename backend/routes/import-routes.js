// Import routes — BRING YOUR OLD ASSISTANT (docs/work/assistant-import.md).
//
// GET  /api/v1/imports/found     — what other assistants left in this person's home folder (OpenClaw,
//                                  Hermes Agent, Claude Code, Codex, and Claude or ChatGPT data exports
//                                  in Downloads, Desktop or Documents), each with what it holds
// POST /api/v1/imports/assistant — {kind, root, profile?}: bring one over into the house ground; root
//                                  is its folder, or an export's .zip
// POST /api/v1/imports/pasted    — {from, text}: what ChatGPT, Claude or another assistant answered
//
// Reading the operator's home folder and writing the skills library are the machine's, so every
// route is the install owner's, at the desk. Nothing here sends anything anywhere.
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { loadHouseWorkspace } from '../services/house-workspace.js';
import { skillService } from '../services/skill-service.js';
import { findAssistants, readAssistant, readPasted, SOURCES } from '../services/imports/assistant-sources.js';
import { landImport } from '../services/imports/import-land.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Imports');
const router = express.Router();
router.use(requireAuth, requireInstallOwner);
router.use(express.json({ limit: '2mb' }));

const NO_GROUND = 'This house has no ground yet. Set one in WORKSPACE first: an import is set down there, where your beings can read it.';
const PROFILE = /^[A-Za-z0-9_.-]{1,60}$/;

// impure — the caller's house ground, or null
const groundOf = async (req) => (await loadHouseWorkspace(req.walletAddress)).root || null;

/** True when a folder sits inside the home folder (never the home folder itself). Pure. */
export const insideHome = (dir, home) => {
  const rel = path.relative(path.resolve(home), path.resolve(dir));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// impure — land a bundle and tell the skills library when it grew
const land = async (bundle, houseRoot) => {
  const report = await landImport(bundle, { houseRoot, skillsRoot: skillService.root });
  if (report.skillsInstalled.length) skillService.refresh();
  log.info('An assistant was brought over', { kind: bundle.kind, dir: report.dir, skills: report.skillsInstalled.length });
  return report;
};

router.get('/found', async (req, res) => {
  try {
    res.json({ success: true, found: await findAssistants(os.homedir()), ground: await groundOf(req) });
  } catch (error) {
    log.error('Looking for assistants failed', { error: error.message });
    res.status(500).json({ success: false, error: `Looking for assistants failed: ${error.message}` });
  }
});

router.post('/assistant', async (req, res) => {
  const { kind, root, profile } = req.body || {};
  if (!SOURCES[kind]) return res.status(400).json({ success: false, error: `kind must be one of: ${Object.keys(SOURCES).join(', ')}` });
  if (typeof root !== 'string' || !path.isAbsolute(root) || !insideHome(root, os.homedir())) {
    return res.status(400).json({ success: false, error: 'it must be inside your home folder' });
  }
  if (profile != null && !PROFILE.test(String(profile))) return res.status(400).json({ success: false, error: 'not a profile name' });
  try {
    const houseRoot = await groundOf(req);
    if (!houseRoot) return res.status(409).json({ success: false, error: NO_GROUND });
    const bundle = await readAssistant(kind, path.resolve(root));
    const carries = ['aboutYou', 'notes', 'persona', 'instructions', 'skills', 'conversations', 'projects', 'scheduled'];
    if (carries.every((k) => !bundle[k].length)) {
      return res.status(400).json({ success: false, error: `nothing from ${bundle.label} was found there` });
    }
    return res.json({ success: true, report: await land({ ...bundle, profile: profile || null }, houseRoot) });
  } catch (error) {
    log.error('Bringing an assistant over failed', { kind, error: error.message });
    return res.status(500).json({ success: false, error: `Bringing it over failed: ${error.message}` });
  }
});

router.post('/pasted', async (req, res) => {
  let bundle;
  try {
    bundle = readPasted(req.body?.from, req.body?.text);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  try {
    const houseRoot = await groundOf(req);
    if (!houseRoot) return res.status(409).json({ success: false, error: NO_GROUND });
    return res.json({ success: true, report: await land(bundle, houseRoot) });
  } catch (error) {
    log.error('Saving a pasted answer failed', { from: bundle.kind, error: error.message });
    return res.status(500).json({ success: false, error: `Saving it failed: ${error.message}` });
  }
});

export default router;
