/**
 * User projects routes — a named working context (folder + terminal cwd +
 * pinned chats) the witness switches between. Auth-gated; everything is keyed
 * to req.walletAddress. Activating or creating a project also ensures its
 * folder is an open file-explorer root, so Files and Terminal are immediately
 * pointed at it (focus, don't clobber — other roots stay).
 */
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import {
  readProjectStore, createProject, deleteProject, setActiveProject,
  getActiveProject, pinChat, unpinChat, addSharedFile, removeSharedFile,
  addFolder, removeFolder, setWorkingFolder, reconnectFolder, findProjectByFolder,
  CHANNELS, NEUMA_ID_RE,
} from '../services/user-projects.js';
import { enrichFolders } from '../services/repo-detect.js';
import { getRoots, setRoots, withRootsLock } from '../services/user-files.js';
import { saveFileSettings } from '../services/user-files-settings.js';
import { recordRecent } from '../services/user-recents.js';
import { passesInstallOwner } from '../services/install-owner.js';
import { verifyLaneOwnership } from '../services/lane-ownership.js';
import { isWithin } from '../services/ground-roots.js';
import { realOf } from '../services/explorer-walls.js';
import neumaWorkspace, { getWitnessesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const router = express.Router();
const log = createLogger('UserProjects');

router.use(requireAuth);

// Add a project's folders to the open file-explorer roots (idempotent) so the
// Files tree and the terminal cwd resolve to them. Never removes existing
// roots. Records each as recent (best-effort) so the picker can surface them.
// The opened-folder list is the machine's, so only its owner, at its desk,
// adds to it; a guest's project stands on its own record, and the explorer
// opens a guest's own projects' folders for that house alone (explorer-ground.js).
const ensureRoots = async (req, folders) => {
  const resolved = folders.map((f) => path.resolve(f));
  if (await passesInstallOwner(req)) {
    // D9: ride the shared roots lock — this read-modify-write races the
    // explorer's own POST/DELETE /roots across desk windows.
    await withRootsLock(async () => {
      setRoots(Array.from(new Set([...getRoots(), ...resolved])));
      await saveFileSettings({ roots: getRoots() });
    });
  }
  for (const r of resolved) {
    await recordRecent(req.walletAddress, r).catch((e) => log.warn('Recents skipped', { error: e.message }));
  }
};

const FOREIGN_LANE = "That folder is a being's lane your house does not hold — a project folder in a lane must be your own being's.";

// impure — the lane ids a folder is, or stands inside: its first segment below
// a lanes root, read on the path as typed and where its links lead.
const lanesOf = (folder) => {
  const grounds = [getWorkspacesRoot(), getWitnessesRoot()].map((g) => path.resolve(g));
  const asked = path.resolve(folder);
  return [...new Set([asked, realOf(asked)].flatMap((candidate) => grounds
    .filter((ground) => candidate !== ground && isWithin(candidate, ground))
    .map((ground) => path.relative(ground, candidate).split(path.sep)[0])))];
};

// impure — does this folder lie in a lane the caller does not own? A folder
// beside the lanes that is no lane (a house ground) is the caller's to use.
const inForeignLane = async (wallet, folder) => {
  for (const neumaId of lanesOf(folder)) {
    const { ok, reason } = await verifyLaneOwnership({ workspace: neumaWorkspace, neumaId, wallet });
    if (!ok && reason !== 'not-found') return true;
  }
  return false;
};

// pure — every folder path a project attaches, for root registration.
const folderPaths = (project) => (project.folders || []).map((f) => f.path);

// Enrich a project's folders with live git classification (isRepo + branch) so
// the UI can badge repos without storing — and thus staling — that state.
// impure
const enrichProject = async (project) => ({
  ...project,
  folders: await enrichFolders(project.folders),
});

// GET / — the wallet's projects + which is active (folders git-enriched)
router.get('/', async (req, res) => {
  try {
    const store = await readProjectStore(req.walletAddress);
    const projects = await Promise.all(store.projects.map(enrichProject));
    res.json({ ...store, projects });
  } catch (error) {
    log.error('List projects', { error: error.message });
    res.status(500).json({ error: 'Failed to read projects' });
  }
});

// GET /folders/resolve?path= — which project (if any) already owns this folder.
// The switch-vs-reconnect prompt reads this before attaching an opened folder.
router.get('/folders/resolve', async (req, res) => {
  try {
    const binding = await findProjectByFolder(req.walletAddress, req.query.path);
    res.json({ binding });
  } catch (error) {
    log.error('Resolve folder', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// POST / — create a project pointing at an existing folder
router.post('/', async (req, res) => {
  try {
    const { name, folder, channel, neumaId } = req.body || {};
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) {
      return res.status(400).json({ error: 'folder must be an absolute path' });
    }
    if (channel !== undefined && !CHANNELS.has(channel)) {
      return res.status(400).json({ error: 'Invalid channel — must be neuma or house' });
    }
    if (neumaId !== undefined && neumaId !== null && !NEUMA_ID_RE.test(String(neumaId))) {
      return res.status(400).json({ error: 'Invalid neumaId format' });
    }
    const st = await fs.stat(path.resolve(folder)).catch(() => null);
    if (!st || !st.isDirectory()) {
      return res.status(422).json({ error: 'Project folder is not an existing directory' });
    }
    if (await inForeignLane(req.walletAddress, folder)) return res.status(403).json({ error: FOREIGN_LANE });
    const project = await createProject(req.walletAddress, { name, folder, channel, neumaId });
    await ensureRoots(req, folderPaths(project));
    log.info('Project created', { name: project.name, channel: project.channel });
    res.json({ project });
  } catch (error) {
    // A folder already owned by another project → the switch-vs-reconnect path.
    if (error.conflict) return res.status(409).json({ error: error.message, conflictProjectId: error.conflict });
    if (error.code === 'NEUMA_ID_REQUIRED') return res.status(400).json({ error: error.message });
    log.error('Create project', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// POST /:id/activate — make this the active project (re-points Files + Terminal)
router.post('/:id/activate', async (req, res) => {
  try {
    await setActiveProject(req.walletAddress, req.params.id);
    const project = await getActiveProject(req.walletAddress);
    if (project) await ensureRoots(req, folderPaths(project));
    res.json({ activeProjectId: req.params.id, project: project && await enrichProject(project) });
  } catch (error) {
    log.error('Activate project', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// DELETE /:id — remove a project
router.delete('/:id', async (req, res) => {
  try {
    res.json(await deleteProject(req.walletAddress, req.params.id));
  } catch (error) {
    log.error('Delete project', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// Validate a candidate folder is an absolute path to an existing directory,
// and in no other house's lane. Returns an { status, error } to send, or null
// when it is good to attach.
// impure
const rejectBadFolder = async (wallet, folder) => {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) {
    return { status: 400, error: 'folder must be an absolute path' };
  }
  const st = await fs.stat(path.resolve(folder)).catch(() => null);
  if (!st || !st.isDirectory()) return { status: 422, error: 'folder is not an existing directory' };
  if (await inForeignLane(wallet, folder)) return { status: 403, error: FOREIGN_LANE };
  return null;
};

// POST /:id/folders — attach a folder (or repo) to a project
router.post('/:id/folders', async (req, res) => {
  try {
    const { path: folder } = req.body || {};
    const bad = await rejectBadFolder(req.walletAddress, folder);
    if (bad) return res.status(bad.status).json({ error: bad.error });
    const project = await addFolder(req.walletAddress, req.params.id, path.resolve(folder));
    await ensureRoots(req, folderPaths(project));
    res.json({ project: await enrichProject(project) });
  } catch (error) {
    // A cross-project collision carries the owning project id so the UI can
    // offer switch-vs-reconnect instead of a dead-end error.
    if (error.conflict) return res.status(409).json({ error: error.message, conflictProjectId: error.conflict });
    log.error('Add folder', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// DELETE /:id/folders — detach a folder from a project
router.delete('/:id/folders', async (req, res) => {
  try {
    const { path: folder } = req.body || {};
    if (typeof folder !== 'string' || !folder.trim()) return res.status(400).json({ error: 'path required' });
    const project = await removeFolder(req.walletAddress, req.params.id, folder);
    res.json({ project: await enrichProject(project) });
  } catch (error) {
    log.error('Remove folder', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// POST /:id/cwd — set the working folder (must be attached); re-points terminal
router.post('/:id/cwd', async (req, res) => {
  try {
    const { path: folder } = req.body || {};
    if (typeof folder !== 'string' || !folder.trim()) return res.status(400).json({ error: 'path required' });
    const project = await setWorkingFolder(req.walletAddress, req.params.id, folder);
    res.json({ project: await enrichProject(project) });
  } catch (error) {
    log.error('Set working folder', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// POST /:id/folders/reconnect — move a folder here (the reconnect prompt arm)
router.post('/:id/folders/reconnect', async (req, res) => {
  try {
    const { path: folder } = req.body || {};
    const bad = await rejectBadFolder(req.walletAddress, folder);
    if (bad) return res.status(bad.status).json({ error: bad.error });
    const project = await reconnectFolder(req.walletAddress, req.params.id, path.resolve(folder));
    await ensureRoots(req, folderPaths(project));
    res.json({ project: await enrichProject(project) });
  } catch (error) {
    log.error('Reconnect folder', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// POST /:id/chats — pin a chat to a project
router.post('/:id/chats', async (req, res) => {
  try {
    const { neumaId, companionName, sessionId, label } = req.body || {};
    res.json({ project: await pinChat(req.walletAddress, req.params.id, { neumaId, companionName, sessionId, label }) });
  } catch (error) {
    log.error('Pin chat', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// DELETE /:id/chats — unpin a chat
router.delete('/:id/chats', async (req, res) => {
  try {
    const { sessionId, neumaId } = req.body || {};
    res.json({ project: await unpinChat(req.walletAddress, req.params.id, sessionId, neumaId) });
  } catch (error) {
    log.error('Unpin chat', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// POST /:id/files — add a file (inside the project folder) to shared context
router.post('/:id/files', async (req, res) => {
  try {
    const { path: filePath } = req.body || {};
    res.json({ project: await addSharedFile(req.walletAddress, req.params.id, filePath) });
  } catch (error) {
    log.error('Add shared file', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// DELETE /:id/files — remove a file from shared context
router.delete('/:id/files', async (req, res) => {
  try {
    const { path: filePath } = req.body || {};
    res.json({ project: await removeSharedFile(req.walletAddress, req.params.id, filePath) });
  } catch (error) {
    log.error('Remove shared file', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

export default router;
