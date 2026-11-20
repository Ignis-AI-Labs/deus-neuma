/**
 * THE TMP JANITOR — stale leftovers leave RAM (Design note, 2026-11-16: […]). /tmp is tmpfs on this machine: every folder a session, a release check or a scanner
 * leaves there is held in RAM until reboot. Found 2026-11-16: 6.4 GB, ~5 GB of it untouched for days
 * (release clones, an audit, one 105 MB venv a day from a scanner).
 *
 * A folder in the scanned root is STALE when all of these hold:
 *   - it is a real directory (never a link, a socket or a loose file — a user's own file such as
 *     Blender's quit.blend stays where it is);
 *   - this user owns it;
 *   - its name is not a system or session runtime folder (TMP_SKIP);
 *   - nothing inside it changed for `staleAfterMs` (default a day);
 *   - it holds no socket or pipe (a running app's single-instance marker);
 *   - no live process has its working directory or an open file inside it.
 * A stale folder is MOVED, never deleted, into a dated holding folder on disk; holding folders older
 * than `holdForMs` (default a week) are removed. A mistake is undone by moving it back.
 */
import fs from 'node:fs/promises';
import { join, basename } from 'node:path';

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const HOLD_FOR_MS = 7 * 24 * 60 * 60 * 1000;
export const HOLDING_PREFIX = 'reclaimed-tmp-';

// System and session runtime folders: never ours to move, whatever their age.
export const TMP_SKIP = Object.freeze([
  'systemd-private-', '.X11-unix', '.ICE-unix', '.font-unix', '.XIM-unix', '.Test-unix', 'tmux-', 'ssh-',
  'krb5', 'pulse-', 'dbus-', 'claude', '.org.chromium', 'sddm', 'kdeinit', 'xauth', 'plasma', 'kio',
  'lmstudio', 'snap-private-tmp', 'flatpak',
]);

// A tree with more entries than this is never judged stale: walking it costs more than it frees.
const WALK_LIMIT = 200_000;

const skipped = (name) => TMP_SKIP.some((s) => name.startsWith(s) || name.includes(s));

/**
 * impure — every path under `root` a live process holds: its working directory or an open file.
 * @param {string} root
 * @param {string} [procRoot]
 * @returns {Promise<string[]>}
 */
export const heldPaths = async (root, procRoot = '/proc') => {
  const held = [];
  const prefix = `${root}/`;
  const keep = (p) => { if (p === root || p.startsWith(prefix)) held.push(p); };
  for (const pid of await fs.readdir(procRoot).catch(() => [])) {
    if (!/^\d+$/.test(pid)) continue;
    await fs.readlink(join(procRoot, pid, 'cwd')).then(keep, () => {});
    const fds = await fs.readdir(join(procRoot, pid, 'fd')).catch(() => []);
    for (const fd of fds) await fs.readlink(join(procRoot, pid, 'fd', fd)).then(keep, () => {});
  }
  return held;
};

// impure — true when the tree is still live: anything in it changed after `cutoff`, it holds a socket or
// a pipe (a running app's single-instance marker — Steam's and Chromium's SingletonSocket — which no
// open-file check sees, and which cannot be copied off tmpfs anyway), or it is too big to judge.
const stillLive = async (path, cutoff) => {
  let seen = 0;
  const stack = [path];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      seen += 1;
      if (seen > WALK_LIMIT) return true;
      const p = join(dir, e.name);
      const st = await fs.lstat(p).catch(() => null);
      if (!st) continue;
      if (st.mtimeMs > cutoff || st.isSocket() || st.isFIFO()) return true;
      if (e.isDirectory()) stack.push(p);
    }
  }
  return false;
};

/**
 * impure — the stale folders directly under `root`.
 * @param {{root?: string, now?: number, staleAfterMs?: number, uid?: number, held?: string[]}} [opts]
 * @returns {Promise<string[]>}
 */
export const staleEntries = async ({ root = '/tmp', now = Date.now(), staleAfterMs = STALE_AFTER_MS, uid = process.getuid(), held } = {}) => {
  const holds = held ?? await heldPaths(root);
  const cutoff = now - staleAfterMs;
  const out = [];
  for (const name of await fs.readdir(root).catch(() => [])) {
    if (skipped(name)) continue;
    const p = join(root, name);
    const st = await fs.lstat(p).catch(() => null);
    if (!st || !st.isDirectory() || st.uid !== uid || st.mtimeMs > cutoff) continue;
    if (holds.some((h) => h === p || h.startsWith(`${p}/`))) continue;
    if (await stillLive(p, cutoff)) continue;
    out.push(p);
  }
  return out;
};

// pure — the holding folder for a moment: one per day.
export const holdingFor = (holdingBase, now) => join(holdingBase, `${HOLDING_PREFIX}${new Date(now).toISOString().slice(0, 10)}`);

// impure — move one folder, across filesystems when it must (tmpfs → disk).
const move = async (from, to) => {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    try {
      await fs.cp(from, to, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
    } catch (copyErr) {
      await fs.rm(to, { recursive: true, force: true }); // a failed copy leaves no partial behind
      throw copyErr;
    }
    await fs.rm(from, { recursive: true, force: true });
  }
};

/**
 * impure — move stale folders into today's holding folder. A name already there gets a suffix.
 * @param {string[]} entries
 * @param {string} holdingBase
 * @param {number} [now]
 * @returns {Promise<{moved: string[], failed: Array<{path: string, error: string}>, holding: string}>}
 */
export const reclaimEntries = async (entries, holdingBase, now = Date.now()) => {
  const holding = holdingFor(holdingBase, now);
  await fs.mkdir(holding, { recursive: true });
  const moved = [];
  const failed = [];
  for (const path of entries) {
    let dest = join(holding, basename(path));
    for (let i = 1; await fs.lstat(dest).then(() => true, () => false); i += 1) dest = join(holding, `${basename(path)}.${i}`);
    try {
      await move(path, dest);
      moved.push(path);
    } catch (err) {
      failed.push({ path, error: err.message });
    }
  }
  return { moved, failed, holding };
};

/**
 * impure — remove holding folders older than `holdForMs`. Only folders this janitor named.
 * @returns {Promise<string[]>} the folders removed
 */
export const purgeHolding = async (holdingBase, now = Date.now(), holdForMs = HOLD_FOR_MS) => {
  const removed = [];
  for (const name of await fs.readdir(holdingBase).catch(() => [])) {
    const day = name.startsWith(HOLDING_PREFIX) ? Date.parse(name.slice(HOLDING_PREFIX.length)) : NaN;
    if (!Number.isFinite(day) || now - day < holdForMs) continue;
    await fs.rm(join(holdingBase, name), { recursive: true, force: true });
    removed.push(join(holdingBase, name));
  }
  return removed;
};
