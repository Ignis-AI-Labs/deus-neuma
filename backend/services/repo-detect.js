/**
 * Repo detection — classify a folder as a git repository and read its current
 * branch, cheaply and without a subprocess. A folder is "a repo" when it
 * carries a `.git`; the branch is whatever HEAD points at.
 *
 * This reads `.git/HEAD` directly. The normal case is a `.git` DIRECTORY; a
 * `.git` FILE (worktrees / submodules) carries `gitdir: <path>` and HEAD lives
 * there. A detached HEAD (or an unreadable ref) is still a repo — branch null.
 *
 * The probe can point at ANY folder the witness opened, so git plumbing is
 * treated as hostile data (D9): every read stats first — a FIFO or device
 * planted as HEAD/.git must not hang the probe — and is bounded to
 * HEAD_READ_BYTES, so a giant junk HEAD costs 4KB, never an OOM. The
 * `gitdir:` target is deliberately NOT root-contained — legitimate worktrees
 * point outside the folder. IO is isolated and marked; the parse step is
 * pure and independently tested.
 */
import fs from 'fs/promises';
import path from 'path';

// A real HEAD or .git link file is a handful of bytes; needing more than
// this means the file is not git plumbing.
const HEAD_READ_BYTES = 4096;

/**
 * Extract a branch name from a `.git/HEAD` ref line ("ref: refs/heads/<name>").
 * A raw sha (detached HEAD) or non-string input has no branch.
 * @param {string|null} head contents of `.git/HEAD`
 * @returns {string|null} branch name, or null if detached/unreadable
 */
// pure
export const parseBranch = (head) => {
  if (typeof head !== 'string') return null;
  const match = head.match(/^ref:\s*refs\/heads\/(.+?)\s*$/m);
  return match ? match[1] : null;
};

// impure — read at most HEAD_READ_BYTES from a REGULAR file. Stat-first so a
// FIFO planted in git plumbing is refused before open (no blocking open);
// any failure (missing, unreadable, not a file) is null — never a throw.
const readBounded = async (filePath) => {
  const st = await fs.stat(filePath).catch(() => null);
  if (!st?.isFile()) return null;
  let handle = null;
  try {
    handle = await fs.open(filePath, 'r');
    const buf = Buffer.alloc(HEAD_READ_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_READ_BYTES, 0);
    return buf.toString('utf8', 0, bytesRead);
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => { /* already closed */ });
  }
};

// impure — a `.git` FILE points at the real git dir via `gitdir: <path>`.
// Returns the absolute HEAD path within it, or null if unreadable.
const resolveLinkedHead = async (gitFile) => {
  const raw = await readBounded(gitFile);
  const match = typeof raw === 'string' ? raw.match(/^gitdir:\s*(.+?)\s*$/m) : null;
  if (!match) return null;
  const gitDir = path.resolve(path.dirname(gitFile), match[1]);
  return path.join(gitDir, 'HEAD');
};

/**
 * Classify a folder. Never throws — a missing or unreadable path is simply
 * "not a repo", so enriching a list of folders can't crash on a stale entry.
 * @param {string} absPath absolute folder path
 * @returns {Promise<{isRepo: boolean, branch: string|null}>}
 */
// impure
export const detectRepo = async (absPath) => {
  const gitPath = path.join(absPath, '.git');
  const stat = await fs.stat(gitPath).catch(() => null);
  if (!stat) return { isRepo: false, branch: null };
  const headFile = stat.isDirectory()
    ? path.join(gitPath, 'HEAD')
    : stat.isFile()
      ? await resolveLinkedHead(gitPath)
      : null; // a .git that is neither (FIFO/device) is hostile — don't read it
  if (!headFile) return { isRepo: true, branch: null };
  return { isRepo: true, branch: parseBranch(await readBounded(headFile)) };
};
