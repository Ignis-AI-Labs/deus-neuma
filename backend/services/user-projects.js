/**
 * User projects — a named working context in the witness's own realm.
 *
 * A project is the durable core. It binds MANY folders (each a plain directory
 * or a git repository — a repo is just a folder that carries a `.git`), plus a
 * set of pinned chats and shared files, into a single switchable context. One
 * of the attached folders is the CURRENT WORKING FOLDER (`folder`) — the cwd
 * the terminal opens in and the file-explorer focuses. A folder belongs to at
 * most one project (single-ownership); moving it is a "reconnect". Stored per
 * wallet, beside the chat logs, at:
 *   <realmRoot>/<wallet>/projects.json
 *     { activeProjectId, projects: [ { id, name, folder, createdAt,
 *                                      folders: [ {path, addedAt} ],
 *                                      pinnedChats: [ {neumaId, companionName,
 *                                                      sessionId, label, addedAt} ],
 *                                      sharedFiles: [ {path, addedAt} ] } ] }
 *
 * `folder` (the working folder) is always one of `folders[]`. Legacy projects
 * with only `folder` are migrated on read, so older readers that reach for
 * `folder` keep working unchanged. Reuses user-realm's walletDir so the
 * per-wallet traversal guard is shared, not reimplemented. IO is isolated.
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { walletDir, writeJsonAtomic } from './user-realm.js';

const projectsFile = (wallet) => path.join(walletDir(wallet), 'projects.json');

const emptyStore = () => ({ activeProjectId: null, projects: [] });

// The two channels a project can live in: NEUMA projects belong to one being
// (the witness's focus channel), HOUSE projects are the collective repository
// every member of the house works in. Exported: the route validates with the
// same constants — one source of truth, no drift.
export const CHANNELS = new Set(['neuma', 'house']);
export const NEUMA_ID_RE = /^[a-zA-Z0-9_-]+$/;

// pure — bring a stored project to the multi-folder shape without losing data.
// A legacy project has only `folder`; seed `folders[]` from it. Keep `folder`
// (the working folder) pinned to a member of `folders[]` so the cwd is always
// valid; if it drifted, fall back to the first attached folder.
// Channel migration on read: projects from before channels existed read as
// HOUSE (they were always visible wallet-wide — never per-being).
const normalizeProject = (p) => {
  const folders = Array.isArray(p.folders) && p.folders.length
    ? p.folders
    : (p.folder ? [{ path: p.folder, addedAt: p.createdAt ?? null }] : []);
  const paths = folders.map((f) => f.path);
  const folder = p.folder && paths.includes(p.folder) ? p.folder : (paths[0] ?? null);
  // Channel migration on read: projects from before channels existed read as
  // HOUSE (they were always visible wallet-wide — never per-being); a neuma
  // record whose neumaId can't be honored degrades to HOUSE too, so it is
  // never invisible in both registers.
  const channel = CHANNELS.has(p.channel) && (p.channel !== 'neuma' || NEUMA_ID_RE.test(String(p.neumaId || '')))
    ? p.channel
    : 'house';
  const neumaId = channel === 'neuma' ? p.neumaId : null;
  return { ...p, folders, folder, channel, neumaId };
};

/** Read the wallet's project store; a missing file is an empty store. */
// impure
export const readProjectStore = async (wallet) => {
  try {
    const raw = await fs.readFile(projectsFile(wallet), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      activeProjectId: parsed.activeProjectId ?? null,
      projects: (Array.isArray(parsed.projects) ? parsed.projects : []).map(normalizeProject),
    };
  } catch (err) {
    if (err.code === 'ENOENT') return emptyStore();
    throw err;
  }
};

// impure — atomic via the shared realm writer: a sibling temp file renamed
// over the store, so a reader can never observe a half-written file.
const writeProjectStore = async (wallet, store) => writeJsonAtomic(projectsFile(wallet), store);

// impure — per-wallet mutation queue. Every mutator below is read-modify-write
// on ONE json file; two racing (parallel API calls, two desk windows) lose
// updates or tear the file — seen live: a torn projects.json (valid store plus
// a trailing brace) made every subsequent read of the witness's projects throw.
// Chaining a wallet's mutations makes each one see the store the last one wrote.
const storeQueues = new Map();
const withStoreQueue = (wallet, task) => {
  const key = String(wallet).toLowerCase();
  const tail = storeQueues.get(key) ?? Promise.resolve();
  const run = tail.then(task, task);
  // The queue survives a failed mutation (errors still surface to the caller).
  storeQueues.set(key, run.catch(() => {}));
  return run;
};

/** The wallet's currently-active project, or null. */
// impure
export const getActiveProject = async (wallet) => {
  const store = await readProjectStore(wallet);
  return store.projects.find((p) => p.id === store.activeProjectId) ?? null;
};

/**
 * Create a project. The first project a wallet makes becomes active.
 * Channel: 'neuma' (belongs to one being — neumaId required) or 'house'
 * (the collective repository). An omitted channel is inferred: a given
 * neumaId means NEUMA, otherwise HOUSE (matching how pre-channel projects
 * behaved — visible wallet-wide).
 * @returns {Promise<Object>} the new project
 */
// impure
export const createProject = (wallet, { name, folder, channel, neumaId = null }) => withStoreQueue(wallet, async () => {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Project name required');
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Project folder must be an absolute path');
  const resolvedChannel = channel ?? (neumaId ? 'neuma' : 'house');
  if (!CHANNELS.has(resolvedChannel)) throw new Error('Invalid channel — must be neuma or house');
  if (resolvedChannel === 'neuma' && !NEUMA_ID_RE.test(String(neumaId || ''))) {
    // Typed refusal — the route maps the code, never the prose.
    const err = new Error('A neuma project requires the being it belongs to (neumaId)');
    err.code = 'NEUMA_ID_REQUIRED';
    throw err;
  }
  const store = await readProjectStore(wallet);
  const resolved = path.resolve(folder);
  // Uphold single-ownership at the create path too, not only on addFolder: a
  // folder already claimed by another project is a reconnect, not a new project.
  const owner = ownerOf(store, resolved);
  if (owner) {
    const err = new Error('Folder already belongs to another project');
    err.conflict = owner.id;
    throw err;
  }
  const createdAt = new Date().toISOString();
  const project = {
    id: crypto.randomBytes(8).toString('hex'),
    name: name.trim(),
    folder: resolved,
    channel: resolvedChannel,
    neumaId: resolvedChannel === 'neuma' ? neumaId : null,
    createdAt,
    folders: [{ path: resolved, addedAt: createdAt }],
    pinnedChats: [],
    sharedFiles: [],
  };
  store.projects.push(project);
  if (!store.activeProjectId) store.activeProjectId = project.id;
  await writeProjectStore(wallet, store);
  return project;
});

/** Delete a project; if it was active, activate the first remaining (or null). */
// impure
export const deleteProject = (wallet, id) => withStoreQueue(wallet, async () => {
  const store = await readProjectStore(wallet);
  store.projects = store.projects.filter((p) => p.id !== id);
  if (store.activeProjectId === id) store.activeProjectId = store.projects[0]?.id ?? null;
  await writeProjectStore(wallet, store);
  return store;
});

/** Set (or clear, with null) the active project. */
// impure
export const setActiveProject = (wallet, id) => withStoreQueue(wallet, async () => {
  const store = await readProjectStore(wallet);
  if (id !== null && !store.projects.some((p) => p.id === id)) throw new Error('Unknown project');
  store.activeProjectId = id;
  await writeProjectStore(wallet, store);
  return store;
});

// pure — the one project that owns this folder path (single-ownership), or null.
const ownerOf = (store, resolved) =>
  store.projects.find((p) => p.folders.some((f) => f.path === resolved)) ?? null;

/**
 * Which project (if any) a folder is already attached to. Drives the
 * switch-vs-reconnect prompt: opening a folder bound to a DIFFERENT project
 * asks the witness to switch to it or reconnect it here.
 * @returns {Promise<{id, name, isActive}|null>}
 */
// impure
export const findProjectByFolder = async (wallet, folderPath) => {
  if (typeof folderPath !== 'string' || !folderPath.trim()) return null;
  const resolved = path.resolve(folderPath);
  const store = await readProjectStore(wallet);
  const owner = ownerOf(store, resolved);
  return owner ? { id: owner.id, name: owner.name, isActive: owner.id === store.activeProjectId } : null;
};

/**
 * Attach a folder to a project. The folder must be an existing directory and
 * must not already belong to another project — that case is a reconnect, not
 * an add, so it is refused with a `.conflict` project id the caller can surface.
 * Dedup within the project. Does not change the working folder.
 * @returns {Promise<Object>} the updated project
 */
// impure
export const addFolder = (wallet, id, folderPath) => withStoreQueue(wallet, async () => {
  if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) throw new Error('folder must be an absolute path');
  const resolved = path.resolve(folderPath);
  const store = await readProjectStore(wallet);
  const project = store.projects.find((p) => p.id === id);
  if (!project) throw new Error('Unknown project');
  const owner = ownerOf(store, resolved);
  if (owner && owner.id !== id) {
    const err = new Error('Folder already belongs to another project');
    err.conflict = owner.id;
    throw err;
  }
  if (!project.folders.some((f) => f.path === resolved)) {
    project.folders.push({ path: resolved, addedAt: new Date().toISOString() });
    await writeProjectStore(wallet, store);
  }
  return project;
});

/**
 * Detach a folder from a project. A project must keep at least one folder, so
 * removing the last one is refused. If the removed folder was the working
 * folder, the working folder falls back to the first remaining. Idempotent.
 * @returns {Promise<Object>} the updated project
 */
// impure
export const removeFolder = (wallet, id, folderPath) => withStoreQueue(wallet, async () => {
  const resolved = path.resolve(folderPath);
  const store = await readProjectStore(wallet);
  const project = store.projects.find((p) => p.id === id);
  if (!project) throw new Error('Unknown project');
  if (!project.folders.some((f) => f.path === resolved)) return project;
  if (project.folders.length <= 1) throw new Error('A project must keep at least one folder');
  project.folders = project.folders.filter((f) => f.path !== resolved);
  if (project.folder === resolved) project.folder = project.folders[0].path;
  await writeProjectStore(wallet, store);
  return project;
});

/**
 * Set the working folder (cwd) — the folder the terminal opens in and the
 * stream is "in". Must be one of the project's attached folders.
 * @returns {Promise<Object>} the updated project
 */
// impure
export const setWorkingFolder = (wallet, id, folderPath) => withStoreQueue(wallet, async () => {
  const resolved = path.resolve(folderPath);
  const store = await readProjectStore(wallet);
  const project = store.projects.find((p) => p.id === id);
  if (!project) throw new Error('Unknown project');
  if (!project.folders.some((f) => f.path === resolved)) throw new Error('folder is not attached to this project');
  project.folder = resolved;
  await writeProjectStore(wallet, store);
  return project;
});

/**
 * Move a folder to a project, detaching it from whichever project held it (the
 * "reconnect" arm of the collision prompt). The folder becomes the target's
 * working folder. Refused only if it is the sole folder of its current owner —
 * that would leave a project folderless; delete that project instead.
 * @returns {Promise<Object>} the target project
 */
// impure
export const reconnectFolder = (wallet, toId, folderPath) => withStoreQueue(wallet, async () => {
  if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) throw new Error('folder must be an absolute path');
  const resolved = path.resolve(folderPath);
  const store = await readProjectStore(wallet);
  const target = store.projects.find((p) => p.id === toId);
  if (!target) throw new Error('Unknown project');
  const owner = ownerOf(store, resolved);
  if (owner && owner.id !== toId) {
    if (owner.folders.length <= 1) throw new Error('Cannot move the only folder of another project');
    owner.folders = owner.folders.filter((f) => f.path !== resolved);
    if (owner.folder === resolved) owner.folder = owner.folders[0].path;
  }
  if (!target.folders.some((f) => f.path === resolved)) {
    target.folders.push({ path: resolved, addedAt: new Date().toISOString() });
  }
  target.folder = resolved;
  await writeProjectStore(wallet, store);
  return target;
});

/** Pin a chat to a project (dedup by neumaId+sessionId). */
// impure
export const pinChat = (wallet, id, { neumaId, companionName, sessionId, label }) => withStoreQueue(wallet, async () => {
  if (!neumaId || !sessionId) throw new Error('neumaId and sessionId required');
  const store = await readProjectStore(wallet);
  const project = store.projects.find((p) => p.id === id);
  if (!project) throw new Error('Unknown project');
  const already = project.pinnedChats.some((c) => c.sessionId === sessionId && c.neumaId === neumaId);
  if (!already) {
    project.pinnedChats.push({ neumaId, companionName: companionName || null, sessionId, label: label || sessionId, addedAt: new Date().toISOString() });
    await writeProjectStore(wallet, store);
  }
  return project;
});

/** Unpin a chat from a project. */
// impure
export const unpinChat = (wallet, id, sessionId, neumaId) => withStoreQueue(wallet, async () => {
  const store = await readProjectStore(wallet);
  const project = store.projects.find((p) => p.id === id);
  if (!project) throw new Error('Unknown project');
  project.pinnedChats = project.pinnedChats.filter((c) => !(c.sessionId === sessionId && c.neumaId === neumaId));
  await writeProjectStore(wallet, store);
  return project;
});

// pure — the absolute path of a file the witness offers as project context,
// proven to live INSIDE the project folder. A project's folder is already a
// trusted Files root; shared files must stay within it so this can never be
// turned into an arbitrary-read primitive (path traversal, symlink-escape by
// literal `..`). Returns the resolved absolute path or throws.
const resolveSharedPath = (project, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('file path required');
  const folder = path.resolve(project.folder);
  // Accept an absolute path or one relative to the project folder.
  const resolved = path.resolve(folder, filePath);
  if (resolved !== folder && !resolved.startsWith(folder + path.sep)) {
    throw new Error('file must live inside the project folder');
  }
  return resolved;
};

/**
 * Add a file to a project's shared context (dedup by resolved path). The file
 * must exist and live inside the project folder. Stores the ABSOLUTE path so
 * the turn assembler reads it without re-deriving the folder.
 * @returns {Promise<Object>} the updated project
 */
// impure
export const addSharedFile = (wallet, id, filePath) => withStoreQueue(wallet, async () => {
  const store = await readProjectStore(wallet);
  const project = store.projects.find((p) => p.id === id);
  if (!project) throw new Error('Unknown project');
  const resolved = resolveSharedPath(project, filePath);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isFile()) throw new Error('file not found in the project folder');
  // Beyond the lexical guard: a symlink can sit lexically inside the folder yet
  // point OUTSIDE it, and stat/readFile follow it. Resolve BOTH real paths and
  // re-check containment so a shared file can never read through a symlink
  // escape. (A later repoint of the link is a TOCTOU we accept: the folder is
  // already the witness's own trusted read root — this grants no new reach.)
  const [realFolder, realTarget] = await Promise.all([fs.realpath(project.folder), fs.realpath(resolved)]);
  if (realTarget !== realFolder && !realTarget.startsWith(realFolder + path.sep)) {
    throw new Error('file must live inside the project folder');
  }
  if (!Array.isArray(project.sharedFiles)) project.sharedFiles = [];
  if (!project.sharedFiles.some((f) => f.path === resolved)) {
    project.sharedFiles.push({ path: resolved, addedAt: new Date().toISOString() });
    await writeProjectStore(wallet, store);
  }
  return project;
});

/** Remove a file from a project's shared context (matched by resolved path). */
// impure
export const removeSharedFile = (wallet, id, filePath) => withStoreQueue(wallet, async () => {
  const store = await readProjectStore(wallet);
  const project = store.projects.find((p) => p.id === id);
  if (!project) throw new Error('Unknown project');
  // Resolve leniently: a file removed from disk (resolveSharedPath still works
  // on a non-existent path) must still be unlistable. Fall back to raw match.
  let resolved;
  try { resolved = resolveSharedPath(project, filePath); } catch { resolved = filePath; }
  project.sharedFiles = (project.sharedFiles || []).filter((f) => f.path !== resolved && f.path !== filePath);
  await writeProjectStore(wallet, store);
  return project;
});
