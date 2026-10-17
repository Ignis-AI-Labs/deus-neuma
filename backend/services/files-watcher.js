// files-watcher — the desk's eyes on the operator's opened roots.
//
// Design note, 2026-08-15: […]
// The desk's own acts already announce themselves (editor saves, being tool
// acts); this service covers everything EXTERNAL — the terminal, git, another
// process — with a real recursive fs.watch per opened root (Node 24 / Linux).
//
// Events fold for one debounce window into a single frame:
//   { paths: [file paths], bulk: [roots whose subtree churned], git: bool }
// A `.git/` internal change never ships its path — it collapses to the git
// flag (the tree does not re-list .git plumbing; the badges re-probe). A burst
// past MAX_PATHS collapses to the root in `bulk` (an npm install is one
// […], not five thousand rows).
//
// The transport is INJECTED (a sink function) — services never import routes.
// Lifecycle is the caller's: watchers run only while someone is listening.

import { execFile } from 'child_process';
import { promisify } from 'util';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { createLogger } from './logger.js';
import { invalidateGitStatusCache } from './git-status.js';
import { createFilesWatchWalk, isIgnoredWatchDir, pruneIgnoredWatches } from './files-watch-walk.js';

const execFileAsync = promisify(execFile);

const log = createLogger('FilesWatcher');

export const FLUSH_MS = 300;
export const MAX_PATHS = 24;

// Names whose churn carries no refresh value — dependency trees, build
// output, tool caches. An `npm install` fires thousands of events under
// node_modules; every flush window would then cost a bulk re-list of the
// root and O(expanded) list calls, for rows the operator is not looking at.
// Extend only for churn actually observed: a source directory that happens
// to share one of these names goes quiet in the live view.
const NOISE_DIRECTORY_NAMES = new Set([
  'node_modules', '.cache', 'dist', 'coverage', 'release', 'test-results',
  '.venv', '__pycache__',
]);

/**
 * What one raw watch event means for the frame being folded. Pure.
 * @param {string} root - the watched root (absolute)
 * @param {string|null} filename - the event's relative filename (may be null)
 * @returns {{kind: 'git'}|{kind: 'noise'}|{kind: 'path', path: string}|{kind: 'bulk'}}
 */
export const classifyChange = (root, filename) => {
  if (typeof filename !== 'string' || filename.length === 0) return { kind: 'bulk' };
  const parts = filename.split(path.sep);
  if (parts.includes('.git')) return { kind: 'git' };
  if (parts.some((part) => NOISE_DIRECTORY_NAMES.has(part))) return { kind: 'noise' };
  return { kind: 'path', path: path.join(root, filename) };
};

/**
 * The minimal cover of the wanted roots: a root contained in another wanted
 * root is already served by the parent's recursive watcher — watching both
 * doubles every inotify descriptor under the child and delivers every event
 * twice. (Observed live: an operator's roots held a repo plus three of its
 * own subdirectories.) Pure.
 * @param {string[]} roots
 * @returns {string[]} roots not contained in any other wanted root
 */
export const outerRoots = (roots) => {
  const all = [...new Set(roots || [])];
  return all.filter((root) => !all.some((other) =>
    other !== root && root.startsWith(other + path.sep)));
};

/**
 * Roots the watch may actually register. Drops missing paths (ENOENT noise)
 * and the operator's home directory: watching home costs the 4096-dir cap
 * and swallows every folder under it via outerRoots, so nothing useful is
 * live. Pure over the given list plus one stat per candidate.
 * @param {string[]} roots
 * @returns {string[]}
 */
export const watchableRoots = (roots) => {
  const home = path.resolve(os.homedir());
  const kept = [];
  for (const root of roots || []) {
    const resolved = path.resolve(root);
    if (resolved === home) {
      log.warn('files watch refuses the home directory', { root: resolved });
      continue;
    }
    try {
      if (!fsSync.statSync(resolved).isDirectory()) {
        log.warn('files watch skips a non-directory root', { root: resolved });
        continue;
      }
    } catch (error) {
      log.warn('files watch skips a missing root', { root: resolved, code: error.code });
      continue;
    }
    kept.push(resolved);
  }
  return outerRoots(kept);
};


/**
 * The absolute directories a `git ls-files` listing declares WHOLLY ignored.
 * Only entries git ends with a separator are directories; an ignored FILE
 * prunes nothing — a gitignored `.env` still lives in a folder the operator
 * reads, and its parent stays watched. Pure.
 * @param {string} stdout - NUL-separated `git ls-files -z` output
 * @param {string} root - the root the paths are relative to
 * @returns {Set<string>} absolute directory paths
 */
export const parseIgnoredDirs = (stdout, root) => new Set(
  String(stdout || '')
    .split('\0')
    .filter((line) => line.endsWith('/'))
    .map((line) => path.resolve(root, line.slice(0, -1))));

/**
 * impure — the operator's OWN declaration of what under this root is not
 * source, read from the root's git repo.
 *
 * The hardcoded name list below cannot know that `benchmarks/sources` or
 * `.waves/runs` are machine-local artifacts; `.gitignore` says so already.
 * Measured on this repo 2026-08-25: 37,371 wanted directories, 99.2% of them
 * inside ignored trees — 83% of the 4096-slot budget was being spent watching
 * dataset caches and benchmark runs while 3,054 directories went unregistered.
 * Pruning them leaves 284.
 *
 * `-c core.fsmonitor=` because `ls-files` refreshes the index, and a
 * fsmonitor hook is a binary the opened folder gets to choose — the watch
 * never becomes an execution vector for a repo the operator merely opened.
 * Any failure (no git, not a repo, timeout) yields the empty set: the walk
 * then behaves exactly as it did before, with the cap as its only guard.
 *
 * ASYNC, never execFileSync (2026-09-02): a sync spawn blocks the WHOLE
 * process — every route, the portal WS, every sitting — for up to the 10s
 * timeout PER ROOT, serialized, on every watch start and every roots change.
 * On a 14-root desk that read as the Explorer crashing.
 * @param {string} root
 * @returns {Promise<Set<string>>}
 */
const ignoredDirsOf = async (root) => {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-c', 'core.fsmonitor=', 'ls-files', '-o', '-i', '--directory', '--exclude-standard', '-z'],
      { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24, timeout: 10_000 },
    );
    return parseIgnoredDirs(stdout, root);
  } catch {
    return new Set(); // not a repo, no git, or too slow — no prune, just the cap
  }
};

/**
 * Fold a pending accumulation into the wire frame, or null when there is
 * nothing to say. Overflowed roots swallow their own file paths. Pure.
 * @param {{paths: Map<string, string>, bulk: Set<string>, git: boolean}} pending
 *   paths maps file path → its root (so overflow can drop by root)
 * @returns {null|{paths: string[], bulk: string[], git: boolean}}
 */
export const foldPending = (pending) => {
  const bulk = new Set(pending.bulk);
  let paths = [...pending.paths.keys()];
  if (paths.length > MAX_PATHS) {
    // Too many singles: the busiest roots go bulk until the list fits.
    const byRoot = new Map();
    for (const [, root] of pending.paths) byRoot.set(root, (byRoot.get(root) || 0) + 1);
    for (const [root] of [...byRoot.entries()].sort((a, b) => b[1] - a[1])) {
      if (paths.length <= MAX_PATHS) break;
      bulk.add(root);
      paths = paths.filter((p) => pending.paths.get(p) !== root);
    }
  }
  if (paths.length === 0 && bulk.size === 0 && !pending.git) return null;
  return { paths, bulk: [...bulk], git: pending.git };
};

// A recursive fs.watch registers an inotify descriptor on EVERY directory
// under the root — node_modules, browser caches, all of it. On a real ground
// (a repo root, the home dir) that exhausts the kernel's watcher budget
// (ENOSPC) and the whole watcher DIES: the desk goes silently deaf (Founder,
// 2026-08-16 — Dolphin emptied a folder, the tree kept showing it). So the
// watch is SELECTIVE now: one plain watch per directory, walked top-down,
// noise dirs never registered at all (.git top-level only — its churn folds
// to the git flag; registering .git/objects costs thousands of slots per
// repo), git-ignored trees never registered (see ignoredDirsOf — the operator
// already declared what is not source), and a per-root cap so no root can
// starve the kernel. Shallow dirs win the cap — they are what the operator is
// looking at; anything deeper is one REFRESH away.
export const MAX_DIRS_PER_ROOT = 4096;

// ── the running state (module singleton — one desk, one set of eyes) ────────
// impure below this line.

const watchers = new Map(); // root → Map(dir → fs.FSWatcher)
const walks = new Map(); // root -> cancellable asynchronous discovery
// root → Set(absolute dirs git calls ignored). Read once when the root is
// registered: an ignored directory BORN while the watch runs is not in the
// set and its subtree can be registered until the next start — the cap is the
// backstop for exactly that.
const ignored = new Map();
let pending = { paths: new Map(), bulk: new Set(), git: false };
let timer = null;
let sink = null;

const flush = () => {
  timer = null;
  const frame = foldPending(pending);
  pending = { paths: new Map(), bulk: new Set(), git: false };
  // The desk is about to re-probe the badges off this frame — the cached
  // porcelain (git-status.js) must not answer for a tree that just moved.
  invalidateGitStatusCache();
  if (frame && sink) {
    try { sink(frame); } catch (error) { log.warn('files-watch sink failed', { error: error.message }); }
  }
};

const record = (root, change) => {
  if (change.kind === 'noise') return;
  if (change.kind === 'git') pending.git = true;
  else if (change.kind === 'bulk') pending.bulk.add(root);
  else pending.paths.set(change.path, root);
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
};

const watchDir = (root, dir, dirs) => {
  if (dirs.size >= MAX_DIRS_PER_ROOT) return false;
  try {
    const w = fsSync.watch(dir, (eventType, filename) => onDirEvent(root, dir, filename == null ? null : String(filename), dirs));
    // A dir that vanishes closes its own watcher rather than crashing the
    // process from a watcher callback; the parent's event re-lists it away.
    w.on('error', () => {
      try { w.close(); } catch { /* already dead */ }
      dirs.delete(dir);
    });
    dirs.set(dir, w);
    return true;
  } catch (error) {
    log.warn('files watch could not open a dir', { dir, error: error.message });
    return false;
  }
};

// Walk-and-watch, breadth-first so the cap keeps the SHALLOW dirs. Also the
// self-heal path: a directory born under a watched dir joins the watch the
// moment its parent's event names it.
const registerTree = (root, startDir, dirs) => {
  if (watchers.get(root) === dirs) walks.get(root)?.enqueue(startDir);
};

const onDirEvent = (root, dir, filename, dirs) => {
  if (watchers.get(root) !== dirs) return;
  const full = filename ? path.join(dir, filename) : dir;
  const change = classifyChange(root, filename ? path.relative(root, full) : null);
  record(root, change);
  if (!filename || change.kind === 'git') return;
  // Self-heal both ways: a new dir starts being watched; a dead watched dir
  // releases its slot (its own error event can lag the deletion).
  try {
    if (fsSync.statSync(full).isDirectory() && !dirs.has(full)
      && !NOISE_DIRECTORY_NAMES.has(filename) && filename !== '.git') {
      registerTree(root, full, dirs);
    }
  } catch {
    const dead = dirs.get(full);
    if (dead) {
      try { dead.close(); } catch { /* already dead */ }
      dirs.delete(full);
    }
  }
};

// impure - root coverage is immediate; deep discovery yields to the portal.
// A bulk refresh on new coverage reconciles writes during initialization.
const watchRoot = (root) => {
  const dirs = new Map();
  if (!watchDir(root, root, dirs)) {
    log.warn('files watch could not open a root', { root });
    return;
  }
  watchers.set(root, dirs);
  const isIgnored = (dir) => isIgnoredWatchDir(dir, ignored.get(root));
  const isLive = () => watchers.get(root) === dirs;
  walks.set(root, createFilesWatchWalk({
    dirs, cap: MAX_DIRS_PER_ROOT,
    isLive,
    isIgnored, isNoise: (name) => NOISE_DIRECTORY_NAMES.has(name),
    watchDir: (dir) => watchDir(root, dir, dirs),
    onComplete: ({ opened, capped }) => {
      if (opened) record(root, { kind: 'bulk' });
      if (capped) log.warn('files watch capped', { root, cap: MAX_DIRS_PER_ROOT });
    },
    onError: (error) => log.warn('files watch discovery failed', { root, error: error.message }),
  }));
  registerTree(root, root, dirs);
  ignoredDirsOf(root).then(async (set) => {
    if (watchers.get(root) !== dirs) return; // closed while the probe was out
    ignored.set(root, set);
    await pruneIgnoredWatches({ dirs, isIgnored, isLive });
    // Revisit watched ancestors too: pruning frees slots, not source coverage.
    registerTree(root, root, dirs);
  }).catch((error) => log.warn('files watch ignore initialization failed', { root, error: error.message }));
};

/**
 * impure — reconcile the running watchers with the current roots. A no-op for
 * roots already watched; safe to call while stopped (nothing starts without a
 * sink). Exported for the roots routes to call on every add/remove.
 * @param {string[]} roots
 */
const closeRoot = (root) => {
  walks.get(root)?.close();
  walks.delete(root);
  for (const [, w] of watchers.get(root) || []) {
    try { w.close(); } catch { /* already dead */ }
  }
  watchers.delete(root);
  ignored.delete(root);
};

export const syncFilesWatchers = (roots) => {
  if (!sink) return;
  const want = new Set(watchableRoots(roots));
  for (const [root] of watchers) {
    if (!want.has(root)) closeRoot(root);
  }
  for (const root of want) {
    if (!watchers.has(root)) watchRoot(root);
  }
};

/**
 * impure — begin watching `roots`, delivering folded frames to `deliver`.
 * Idempotent: a second start replaces the sink and reconciles the roots.
 * @param {string[]} roots
 * @param {(frame: {paths: string[], bulk: string[], git: boolean}) => void} deliver
 */
export const startFilesWatchers = (roots, deliver) => {
  sink = deliver;
  syncFilesWatchers(roots);
};

/** impure — stop every watcher and drop anything pending. */
export const stopFilesWatchers = () => {
  for (const [root] of watchers) closeRoot(root);
  if (timer) { clearTimeout(timer); timer = null; }
  pending = { paths: new Map(), bulk: new Set(), git: false };
  sink = null;
};

/** Currently registered watch roots — tests and HUD. */
export const watchedRoots = () => [...watchers.keys()];
