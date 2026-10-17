/**
 * User files routes — the witness browses and edits their own filesystem from
 * the desk (the VS Code-style explorer). Auth-gated. Every path is validated
 * server-side against the chosen roots; the client tree is never trusted.
 */
import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { requireAuth } from '../services/auth.js';

import { createLogger } from '../services/logger.js';
import { getRoots, setRoots, listDir, readFile, writeFile, writeBinary, resolveBinaryFile, UPLOAD_MAX_BYTES, createEntry, renamePath, deletePath, resolveFocusPath, withRootsLock } from '../services/user-files.js';
import { startFilesWatchers, syncFilesWatchers, stopFilesWatchers } from '../services/files-watcher.js';
import { detectRepo } from '../services/repo-detect.js';
import { readGitStatus } from '../services/git-status.js';
import { saveFileSettings } from '../services/user-files-settings.js';
import { browseDir, listDrives, createDirIn } from '../services/fs-browse.js';
import { recordRecent, listRecents } from '../services/user-recents.js';

const router = express.Router();
const log = createLogger('UserFiles');

// A native browser download (the drag-out's DownloadURL, any raw link) and an
// EventSource (the live watch lane) cannot carry an Authorization header — so
// for /raw and /events ONLY, a ?token= query is mapped into the header BEFORE
// requireAuth: the portal's own law (the WS token rides a query param), same
// verification, nothing else loosened. EXPORTED for server.js to mount at the
// APP level too: several routers mount at /api/v1 with blanket router-level
// requireAuth and see every /api/v1/* request FIRST — mapped at this router
// alone, the token arrived too late and both lanes 401'd on the real server
// (the desk deaf to external changes, Design note, 2026-08-16. Both path shapes are
// named so the one middleware serves both mounts.
const HEADERLESS_LANES = new Set(['/raw', '/events', '/api/v1/user/files/raw', '/api/v1/user/files/events']);
export const mapLaneQueryToken = (req, res, next) => {
  if (HEADERLESS_LANES.has(req.path) && !req.headers.authorization && typeof req.query.token === 'string' && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
};
router.use(mapLaneQueryToken);
router.use(requireAuth);

// GET /roots — the folders the witness has opened
router.get('/roots', (req, res) => {
  res.json({ roots: getRoots() });
});

// POST /roots — open a folder: add an absolute, existing, writable directory
router.post('/roots', async (req, res) => {
  try {
    const { root } = req.body || {};
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      return res.status(400).json({ error: 'root must be an absolute path' });
    }
    const resolved = path.resolve(root);
    if (resolved === path.resolve(os.homedir())) {
      return res.status(422).json({ error: 'Home is not a browse root — open a specific folder' });
    }
    const st = await fs.stat(resolved).catch(() => null);
    if (!st || !st.isDirectory()) {
      return res.status(422).json({ error: 'Path is not an existing directory' });
    }

    try {
      const probe = path.join(resolved, '.neuma-probe');
      await fs.writeFile(probe, 'probe');
      await fs.rm(probe);
    } catch (error) {
      return res.status(422).json({ error: `Folder is not writable: ${error.code || error.message}` });
    }
    // D9: the whole read-modify-write rides the roots lock — two windows
    // opening folders in parallel must both land (no lost update).
    const roots = await withRootsLock(async () => {
      setRoots(Array.from(new Set([...getRoots(), resolved])));
      await saveFileSettings({ roots: getRoots() });
      return getRoots();
    });
    // Best-effort: remember this folder for the picker's RECENT list, but a
    // recents failure must never fail the open itself.
    await recordRecent(req.walletAddress, resolved).catch((e) => log.warn('Recents skipped', { error: e.message }));
    syncFilesWatchers(roots); // the live watch follows the roots (no-op unless a desk is listening)
    log.info('Browse root opened', { root: resolved });
    res.json({ roots });
  } catch (error) {
    log.error('Open folder failed', { error: error.message });
    res.status(500).json({ error: 'Could not open the folder' });
  }
});

// DELETE /roots — close a folder (remove a root). Empty is allowed.

router.delete('/roots', async (req, res) => {
  try {
    const { root } = req.body || {};
    if (typeof root !== 'string') return res.status(400).json({ error: 'root required' });
    const resolved = path.resolve(root);
    const roots = await withRootsLock(async () => {
      setRoots(getRoots().filter((r) => r !== resolved));
      await saveFileSettings({ roots: getRoots() });
      return getRoots();
    });
    syncFilesWatchers(roots); // a closed folder is no longer watched
    res.json({ roots });
  } catch (error) {
    log.error('Close folder failed', { error: error.message });
    res.status(500).json({ error: 'Could not close the folder' });
  }
});

// ── THE LIVE WATCH LANE ─────────────────────────────────────────────────────
// GET /events — an SSE stream of `files:changed` frames from the real
// fs.watch on every opened root (Design note, 2026-08-15: […]). Its own lane beside the portal, the terminal's own-socket
// precedent — desk state, not consciousness telemetry. Watchers run LAZILY:
// the first subscriber starts them, the last one leaving stops them, so a
// closed desk costs no inotify handles and a test importing this router
// watches nothing.
const sseClients = new Set();
const deliverFrame = (frame) => {
  const data = `data: ${JSON.stringify(frame)}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch { /* a dying stream must not break the loop */ }
  }
};

router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': live\n\n'); // opens the stream through any buffering proxy
  sseClients.add(res);
  if (sseClients.size === 1) startFilesWatchers(getRoots(), deliverFrame);
  req.on('close', () => {
    sseClients.delete(res);
    if (sseClients.size === 0) stopFilesWatchers();
  });
});

// GET /browse?path=[&files=1] — navigate the disk to CHOOSE a folder (dirs
// only) or, with files=1, a file (dirs + files). Not root-contained: this is
// how a root/file is picked. Defaults to the home dir.
router.get('/browse', async (req, res) => {
  try {
    res.json(await browseDir(req.query.path, { includeFiles: req.query.files === '1' }));
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404
      : error.code === 'EACCES' || error.code === 'EPERM' ? 403
      : error.code === 'ENOTDIR' ? 400
      : 500;
    if (status === 500) log.error('Browse failed', { error: error.message });
    res.status(status).json({ error: error.message });
  }
});

// POST /browse/mkdir — create a folder at the browsed location (the picker's
// NEW FOLDER). Un-contained like /browse itself: this is how a place is MADE
// before it becomes a root or the house's ground — auth is the gate, the
// witness's own disk the reach.
router.post('/browse/mkdir', async (req, res) => {
  try {
    const { parent, name } = req.body || {};
    res.json(await createDirIn(parent, name));
  } catch (error) {
    // Witness mistakes are 400-class; anything unexpected is a LOGGED 500 —
    // surfaced-to-client is not the same as logged (Rule 3).
    const status = error.code === 'ENOENT' ? 404
      : error.code === 'EACCES' || error.code === 'EPERM' ? 403
      : error.code === 'EINVAL' || error.code === 'ENOTDIR' || error.code === 'EEXIST' ? 400
      : 500;
    if (status === 500) log.error('Mkdir failed', { error: error.message });
    res.status(status).json({ error: error.message });
  }
});

// GET /folder-info?path= — git classification ({ isRepo, branch }) for a
// folder the witness has opened (bare-folder branch badges). The path is
// UNTRUSTED and clears resolveFocusPath — the one focus-path containment
// chokepoint — FIRST: anything outside the opened roots (or not an existing
// directory) is a flat 403, so this never becomes a repo/branch oracle over
// the wider disk. detectRepo itself never throws (hostile .git is bounded).
router.get('/folder-info', async (req, res) => {
  try {
    const real = resolveFocusPath(req.query.path);
    if (!real) return res.status(403).json({ error: 'Path outside allowed roots' });
    res.json(await detectRepo(real));
  } catch (err) {
    log.error('Folder info failed', { error: err.message });
    res.status(500).json({ error: 'Could not read folder info' });
  }
});

// GET /git-status?path= — the working-tree truth of an opened repo (branch,
// ahead/behind, per-path badge letters) for the explorer's git decorations.
// Same containment law as /folder-info: resolveFocusPath FIRST, a flat 403
// on escape — never a git-state oracle over the wider disk. The probe is
// bounded (timeout + maxBuffer, GIT_OPTIONAL_LOCKS=0); a subprocess failure
// is an honest 500 and the tree shows no badges, never invented state.
router.get('/git-status', async (req, res) => {
  try {
    const real = resolveFocusPath(req.query.path);
    if (!real) return res.status(403).json({ error: 'Path outside allowed roots' });
    res.json(await readGitStatus(real));
  } catch (err) {
    log.error('Git status failed', { error: err.message });
    res.status(500).json({ error: 'Could not read git status' });
  }
});

// GET /git-status-many?path=a&path=b — every opened root's truth in ONE
// metered call. The tree used to spend one call per root per refresh: 16
// roots on the live desk, re-probed on every churn flush, was ~160 calls a
// minute and starved the shared rate bucket (TOO MANY REQUESTS on uploads
// and plane verbs, live 2026-09-25). Same containment law per path; an
// escaped or failed path answers null (no badges), never an oracle.
const GIT_STATUS_MANY_MAX = 64;
router.get('/git-status-many', async (req, res) => {
  const asked = [].concat(req.query.path ?? []).filter((p) => typeof p === 'string');
  if (asked.length === 0 || asked.length > GIT_STATUS_MANY_MAX) {
    return res.status(400).json({ error: `Name between 1 and ${GIT_STATUS_MANY_MAX} paths` });
  }
  const entries = await Promise.all([...new Set(asked)].map(async (p) => {
    const real = resolveFocusPath(p);
    if (!real) return [p, null];
    try { return [p, await readGitStatus(real)]; } catch (err) {
      log.error('Git status failed', { error: err.message });
      return [p, null];
    }
  }));
  res.json({ statuses: Object.fromEntries(entries) });
});

// GET /recents — the witness's recently-opened folders (per wallet), for the picker
router.get('/recents', async (req, res) => {
  try {
    res.json({ recents: await listRecents(req.walletAddress) });
  } catch (error) {
    log.error('Recents failed', { error: error.message });
    res.status(500).json({ error: 'Could not read recent folders' });
  }
});

// GET /drives — the witness's mounted drives, for the picker's device jumps
router.get('/drives', async (req, res) => {
  try {
    res.json({ drives: await listDrives() });
  } catch (error) {
    log.error('Drives failed', { error: error.message });
    res.status(500).json({ error: 'Could not list drives' });
  }
});

// Containment is a client error (403). A missing path is 404. A path that
// exists but cannot be served as text — a directory, a FIFO, a socket, a
// device — is the caller asking for the wrong thing (422). Anything else is
// genuinely unexpected: the client gets a stable sentence, and the real errno
// and absolute path go to the log instead of over the wire (#241).
const CONTAINED = /outside allowed roots|must be absolute|Symlink target/;
const readErr = (res, label, error) => {
  if (CONTAINED.test(error.message)) return res.status(403).json({ error: error.message });
  if (error.code === 'ENOENT') return res.status(404).json({ error: 'No such path' });
  if (error.code === 'NOT_A_TEXT_FILE') return res.status(422).json({ error: error.message });
  if (error.code === 'ENOTDIR') return res.status(422).json({ error: 'Not a directory' });
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    return res.status(403).json({ error: 'Permission denied' });
  }
  log.error(`${label} failed`, { error: error.message, code: error.code });
  return res.status(500).json({ error: `Could not ${label}` });
};

// GET /list?path= — a directory's children (dirs, then files, then special)
router.get('/list', async (req, res) => {
  try {
    res.json({ entries: await listDir(req.query.path) });
  } catch (error) {
    readErr(res, 'list that folder', error);
  }
});

// GET /read?path= — a text file's contents for the editor
router.get('/read', async (req, res) => {
  try {
    res.json(await readFile(req.query.path));
  } catch (error) {
    readErr(res, 'read that file', error);
  }
});

// PUT /write — save the editor's contents back to disk. With expectedMtimeMs
// the save is conditional: disk moved since the buffer was read → 409 CONFLICT
// and nothing is written (#235); the client offers the operator the choice.
router.put('/write', async (req, res) => {
  try {
    const { path: filePath, content, expectedMtimeMs } = req.body || {};
    res.json(await writeFile(filePath, content, expectedMtimeMs));
  } catch (error) {
    if (/outside allowed roots|must be absolute/.test(error.message)) {
      return res.status(403).json({ error: error.message });
    }
    if (error.code === 'CONFLICT') {
      return res.status(409).json({ error: error.message, code: 'CONFLICT' });
    }
    log.error('Write failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// Containment violations are a client/security error (403); everything else a
// 400 with the server's reason (already-exists, parent-missing, etc.).
const CONTAINMENT = /outside allowed roots|must be absolute|Symlink target/;
const fsErr = (res, log, label, error) => {
  if (CONTAINMENT.test(error.message)) return res.status(403).json({ error: error.message });
  log.error(`${label} failed`, { error: error.message });
  return res.status(400).json({ error: error.message });
};

// THE TWO-WAY BRIDGE (Design note, 2026-07-28: drag files from the OS file manager
// into the Explorer, and back out — both ways inside the open roots, never
// past them.

// GET /raw?path= — one file's bytes, for the browser's drag-out (DownloadURL)
// and any DOWNLOAD act. Streamed from the contained real path; the ?token=
// mapping above is how a native download authenticates at all.
router.get('/raw', async (req, res) => {
  try {
    const { real, size } = await resolveBinaryFile(req.query.path);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(real))}`,
    });
    fsSync.createReadStream(real).pipe(res);
  } catch (error) {
    if (CONTAINMENT.test(error.message)) return res.status(403).json({ error: error.message });
    res.status(error.message === 'Path does not exist' ? 404 : 400).json({ error: error.message });
  }
});

// POST /upload?path=<dir>&name=<file> — raw bytes land inside the folder.
// No multipart parser: the body IS the file (one drop = one request), the
// name rides the query and is sanitized to a plain basename server-side.
router.post('/upload', express.raw({ type: () => true, limit: UPLOAD_MAX_BYTES }), async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'the upload carried no bytes' });
    }
    const landed = await writeBinary(req.query.path, req.query.name, req.body);
    log.info('Upload landed', { path: landed.path, size: landed.size, renamed: landed.renamed, wallet: req.walletAddress });
    res.status(201).json(landed);
  } catch (error) {
    fsErr(res, log, 'Upload', error);
  }
});

// POST /create — new empty file or folder
router.post('/create', async (req, res) => {
  try {
    const { path: targetPath, kind } = req.body || {};
    res.json(await createEntry(targetPath, kind));
  } catch (error) {
    fsErr(res, log, 'Create', error);
  }
});

// POST /rename — rename or move within the open roots
router.post('/rename', async (req, res) => {
  try {
    const { from, to } = req.body || {};
    res.json(await renamePath(from, to));
  } catch (error) {
    fsErr(res, log, 'Rename', error);
  }
});

// DELETE /entry — delete a file or folder (recursive for folders)
router.delete('/entry', async (req, res) => {
  try {
    const { path: targetPath } = req.body || {};
    res.json(await deletePath(targetPath));
  } catch (error) {
    fsErr(res, log, 'Delete', error);
  }
});

export default router;
