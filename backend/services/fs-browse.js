/**
 * Filesystem browse — directory navigation for the "Open Folder" picker.
 *
 * Deliberately NOT root-contained, unlike user-files.js: this is how the
 * witness CHOOSES a root, so it must be able to walk the local disk. By default
 * it lists directories only (never file contents — those go through the
 * contained read path); with includeFiles it also lists regular files, so the
 * same picker can choose a file (e.g. a project's shared-context file). It
 * reports the parent + home so the UI can navigate up and out. Same trust model
 * as typing an absolute path into "open folder" — it adds ergonomics, not
 * reach. IO isolated and marked.
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Create a NEW directory inside a browsed parent — the picker's NEW FOLDER.
 * Same trust plane as browseDir and "open folder" itself: the witness making
 * a place on their own disk before it becomes a root or the house's ground.
 * The name must be one clean path segment (no separators, no traversal); an
 * existing target refuses rather than silently reusing.
 * @param {string} parent - absolute existing directory
 * @param {string} name - the new folder's name (single segment)
 * @returns {Promise<{path: string}>} the created directory
 */
// impure
export const createDirIn = async (parent, name) => {
  // Refusals carry EINVAL/ENOTDIR codes so the route can tell a witness
  // mistake (400-class) from an unexpected filesystem failure (logged 500).
  const refuse = (message, code = 'EINVAL') => Object.assign(new Error(message), { code });
  if (typeof parent !== 'string' || !path.isAbsolute(parent)) {
    throw refuse('parent must be an absolute path');
  }
  const segment = String(name ?? '').trim();
  if (!segment || segment.length > 128) {
    throw refuse('folder name must be 1-128 characters');
  }
  // eslint-disable-next-line no-control-regex -- control chars are the point
  if (/[\\/\x00-\x1f\x7f]/.test(segment) || segment === '.' || segment === '..') {
    throw refuse('folder name must be a single clean path segment');
  }
  const parentReal = path.resolve(parent);
  const st = await fs.stat(parentReal);
  if (!st.isDirectory()) throw refuse('parent is not a directory', 'ENOTDIR');
  const target = path.join(parentReal, segment);
  // mkdir itself is the existence truth — a stat-then-mkdir pre-check is a
  // TOCTOU race; EEXIST at the moment of creation is the honest signal.
  try {
    await fs.mkdir(target);
  } catch (error) {
    if (error.code === 'EEXIST') throw refuse('a file or folder with that name already exists', 'EEXIST');
    throw error;
  }
  return { path: target };
};

/**
 * List a directory's entries for the picker. Default: sub-directories only (you
 * pick folders). With includeFiles: directories AND regular files, each tagged
 * `dir` (dirs sorted first) so the caller can render + select a file. A symlink
 * is followed to its target: a link to a directory is enterable; in file mode a
 * link to a regular file is selectable.
 * @param {string} [dirPath] - absolute path; defaults to the user's home dir
 * @param {{ includeFiles?: boolean }} [opts] - includeFiles lists regular files too
 * @returns {Promise<{path: string, parent: string|null, home: string, entries: Array<{name: string, path: string, hidden: boolean, dir: boolean}>}>}
 */
// impure
export const browseDir = async (dirPath, { includeFiles = false } = {}) => {
  const home = os.homedir();
  const target = typeof dirPath === 'string' && dirPath.trim() ? dirPath : home;
  const real = path.resolve(target);
  const dirents = await fs.readdir(real, { withFileTypes: true });
  const entries = [];
  for (const d of dirents) {
    const full = path.join(real, d.name);
    // Resolve a symlink to its target ONCE — reused for both the directory
    // decision and (in file mode) the regular-file check.
    const resolved = d.isSymbolicLink() ? await fs.stat(full).catch(() => null) : d;
    const isDir = d.isDirectory() || (!!resolved && resolved.isDirectory());
    // Folder-picking mode (default) lists directories only. File-picking mode
    // (includeFiles) lists both. A non-dir, non-file entry (socket, fifo) is
    // never listed.
    if (!isDir && !includeFiles) continue;
    if (!isDir && !(resolved && resolved.isFile())) continue; // only real files are selectable
    entries.push({ name: d.name, path: full, hidden: d.name.startsWith('.'), dir: isDir });
  }
  // Directories first, then files, each alphabetized — the natural picker order.
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  const parent = path.dirname(real);
  return { path: real, parent: parent === real ? null : parent, home, entries };
};

// Kernel pseudo-filesystems — mounted, but not drives the witness cares about.
const PSEUDO_FS = new Set([
  'proc', 'sysfs', 'tmpfs', 'devtmpfs', 'devpts', 'cgroup', 'cgroup2', 'overlay',
  'squashfs', 'mqueue', 'debugfs', 'tracefs', 'bpf', 'configfs', 'fusectl',
  'securityfs', 'pstore', 'autofs', 'binfmt_misc', 'hugetlbfs', 'nsfs', 'ramfs',
  'efivarfs', 'selinuxfs', 'rpc_pipefs', 'fuse.gvfsd-fuse', 'fuse.portal',
]);

// /proc/mounts encodes space/tab/newline/backslash in paths as octal escapes.
const unescapeMount = (s) => s.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

const driveLabel = (p, home) => (p === '/' ? '/' : p === home ? 'HOME' : path.basename(p));

/**
 * Parse /proc/mounts text into the real filesystem mountpoints, dropping kernel
 * pseudo-filesystems (proc, tmpfs, cgroup, squashfs/snaps, …) and mounts
 * hidden under a dot-directory (AppImage FUSE mounts). Pure — the IO
 * (reading /proc/mounts) is separate so this is unit-testable.
 * @param {string} text - contents of /proc/mounts
 * @returns {string[]} deduped mountpoint paths
 */
export const parseMounts = (text) => {
  const seen = new Set();
  for (const line of text.split('\n')) {
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    if (PSEUDO_FS.has(parts[2])) continue;
    const mountpoint = unescapeMount(parts[1]);
    // A mountpoint under a dot-directory is plumbing, not a drive — an
    // AppImage's private FUSE mount (/tmp/.mount_LM-Stu…) listed as one.
    if (mountpoint.split('/').some((seg) => seg.startsWith('.'))) continue;
    seen.add(mountpoint);
  }
  return [...seen];
};

/**
 * The witness's mounted drives, for the picker's "Devices" jumps: real
 * mountpoints from /proc/mounts plus the filesystem root and home, existing
 * dirs only, sorted, each with a short label. Non-Linux (no /proc/mounts) → just
 * root + home. IO isolated.
 * @returns {Promise<Array<{path: string, label: string}>>}
 */
// impure
export const listDrives = async () => {
  const home = os.homedir();
  let mounts = [];
  try {
    mounts = parseMounts(await fs.readFile('/proc/mounts', 'utf8'));
  } catch { /* not Linux / unreadable — root + home still surface below */ }
  const paths = [...new Set(['/', home, ...mounts].map((p) => path.resolve(p)))];
  const out = [];
  for (const p of paths) {
    const st = await fs.stat(p).catch(() => null);
    if (st && st.isDirectory()) out.push({ path: p, label: driveLabel(p, home) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
};
