// Voice engine lifecycle routes — launch/stop/status for local Python sidecars.
//
// Separate from voice-routes.js (which is provider config + synthesis) because
// engine lifecycle is a distinct concern: these routes manage processes, not
// audio. Both are mounted under /api/v1/voice. Starting, stopping and
// fetching engines acts on the machine, so it is the install owner's.

import { Router } from 'express';
import { spawn } from 'child_process';
import { mkdirSync, createWriteStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import {
  launch, stop, getStatus, listStatus, healthCheck, shutdownAll,
  isUvAvailable, engineReadiness, uvBin,
} from '../services/voice/engine-manager.js';

import { voiceHelperEnvironment } from '../services/voice/engine-process.js';
import { createLogger } from '../services/logger.js';
import { withStoredHfToken } from '../services/stored-secrets.js';
const log = createLogger('Voice.Engines');

const router = Router();
router.use(requireAuth);

// Engine id is untrusted and reaches both a filesystem path (download log) and a
// spawned process arg — validate it to a strict slug so `..`, slashes, and shell
// metacharacters can never get through (Rule 8). Mirrors the companion guard.
// It starts with a letter or digit: an id like `--all-local` would reach the
// downloader as an option (audit 2026-10-28 L-01).
const VALID_ENGINE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
router.param('id', (req, res, next, id) => {
  if (!VALID_ENGINE_ID.test(id)) {
    return res.status(400).json({ error: 'invalid engine id format' });
  }
  next();
});

// backend/routes → repo root is TWO levels up. Three was a real defect: the
// downloader spawned into a nonexistent /repos/voice-engines and every
// route-driven download died at birth (witnessed on the GB10, 2026-07-15).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOG_DIR = path.join(REPO_ROOT, 'voice-engines', '_logs');

// --- Status ---

router.get('/local', (_req, res) => {
  res.json({ engines: listStatus() });
});

router.get('/local/:id', async (req, res) => {
  const status = getStatus(req.params.id);
  if (!status) return res.status(404).json({ error: 'unknown local engine' });
  // Name what stands between this machine and the engine, so a surface can
  // prompt the exact install instead of failing into a bare error.
  const uvAvailable = await isUvAvailable();
  res.json({
    ...status,
    uvAvailable,
    readiness: engineReadiness({ uvAvailable, downloaded: status.downloaded }),
  });
});

router.get('/local/:id/health', async (req, res) => {
  const result = await healthCheck(req.params.id);
  res.json(result);
});

// --- Launch / stop ---

router.post('/local/:id/launch', requireInstallOwner, async (req, res) => {
  const { timeoutMs, skipSync } = req.body || {};
  try {
    const status = await launch(req.params.id, {
      timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : 180_000,
      skipSync: skipSync === true,
    });
    res.json(status);
  } catch (err) {
    log.error('launch route failed', { engineId: req.params.id, err: err.message });
    res.status(400).json({ error: err.message });
  }
});

router.post('/local/:id/stop', requireInstallOwner, (req, res) => {
  if (!getStatus(req.params.id)) return res.status(404).json({ error: 'unknown local engine' });
  const status = stop(req.params.id);
  res.json(status);
});

// --- Download management ---
//
// In-process tracker for downloader runs. One download per engine at a time.

const _downloads = new Map();

router.post('/local/:id/download', requireInstallOwner, (req, res) => {
  const engineId = req.params.id;
  const existing = _downloads.get(engineId);
  if (existing?.state === 'running') {
    return res.status(409).json({ error: 'download already running', download: existing });
  }

  const downloaderDir = path.join(REPO_ROOT, 'voice-engines', '_downloader');
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `${engineId}.download.log`);
  const logStream = createWriteStream(logFile, { flags: 'w' });

  const proc = spawn(uvBin(), ['run', 'download.py', engineId], {
    cwd: downloaderDir,
    env: voiceHelperEnvironment(withStoredHfToken(process.env), engineId),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.pipe(logStream);
  proc.stderr?.pipe(logStream);

  const entry = {
    engineId,
    state: 'running',
    pid: proc.pid,
    startedAt: new Date().toISOString(),
    logFile,
  };
  _downloads.set(engineId, entry);

  // A machine without uv fires 'error' (ENOENT), never 'exit' — unhandled it
  // would crash the whole backend on the witness's first install click.
  proc.on('error', (err) => {
    const cur = _downloads.get(engineId);
    if (cur) {
      cur.state = 'failed';
      cur.error = err.code === 'ENOENT' ? 'uv is not installed on this machine' : err.message;
      cur.finishedAt = new Date().toISOString();
    }
    logStream.end();
    log.error('download could not start', { engineId, err: err.message });
  });

  proc.on('exit', (code) => {
    const cur = _downloads.get(engineId);
    if (cur) {
      cur.state = code === 0 ? 'succeeded' : 'failed';
      cur.exitCode = code;
      cur.finishedAt = new Date().toISOString();
    }
    logStream.end();
    log.info('download finished', { engineId, code });
  });

  res.json({ ok: true, download: entry });
});

router.get('/local/:id/download/status', (req, res) => {
  const entry = _downloads.get(req.params.id);
  if (!entry) return res.json({ state: 'idle' });
  res.json(entry);
});

router.post('/shutdown-all', requireInstallOwner, (_req, res) => {
  shutdownAll();
  res.json({ ok: true });
});

export default router;
