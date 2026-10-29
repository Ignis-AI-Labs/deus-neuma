// repo-reads — the few git reads `company_updates` needs, and nothing else.
//
// Every call here reads git's own objects (log, show, diff, rev-parse) and
// never writes: no fetch, no checkout, no index refresh. A repository's own
// config could name a program for git to run on a diff (`diff.external`, a
// textconv driver, an fsmonitor hook), so every read refuses those by flag and
// by `-c`, and git never prompts or pages. A repo git will not read (missing,
// not a repository, owned by another user) answers as an error in words.
//
// impure — runs git.

import { execFile } from 'child_process';
import { realpathSync } from 'fs';
import { promisify } from 'util';

const execFileP = promisify(execFile);
const MAX_BUFFER = 8 * 1024 * 1024;
const SAFE = Object.freeze(['-c', 'core.fsmonitor=', '-c', 'core.pager=cat', '-c', 'diff.external=', '-c', 'log.showSignature=false']);
const ENV = Object.freeze({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0' });

/** One read-only git command in `cwd`; stdout. impure. */
const git = async (cwd, args) => (await execFileP('git', [...SAFE, ...args], { cwd, env: ENV, maxBuffer: MAX_BUFFER, timeout: 20000 })).stdout;

/**
 * Is `dir` the top of a git work tree (not a folder inside one)? impure.
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
export const isRepoRoot = async (dir) => {
  try {
    const top = (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
    return realpathSync(top) === realpathSync(dir);
  } catch {
    return false;
  }
};

/** The commit HEAD names, or null on an unborn branch. impure. */
export const headOf = async (cwd) => {
  try { return (await git(cwd, ['rev-parse', '-q', '--verify', 'HEAD^{commit}'])).trim() || null; } catch { return null; }
};

/** Is `sha` a commit HEAD contains? impure. */
const isAncestor = async (cwd, sha) => {
  try { await git(cwd, ['merge-base', '--is-ancestor', sha, 'HEAD']); return true; } catch { return false; }
};

/**
 * The commit a window starts AFTER: the last-reported head when it is still
 * HEAD's ancestor, else the newest commit before the date. null when every
 * commit falls inside the window. impure.
 * @param {string} cwd
 * @param {{sinceSha?: ?string, sinceDate: string}} from
 */
export const baseFor = async (cwd, { sinceSha = null, sinceDate }) => {
  if (sinceSha && /^[0-9a-f]{7,64}$/.test(sinceSha) && await isAncestor(cwd, sinceSha)) return sinceSha;
  const out = (await git(cwd, ['rev-list', '-1', `--before=${sinceDate}`, 'HEAD'])).trim();
  return out || null;
};

const rangeOf = (base) => (base ? [`${base}..HEAD`] : ['HEAD']);

/**
 * The commits after `base`, newest first, at most `cap` (and how many in all).
 * impure.
 * @returns {Promise<{total: number, commits: Array<{sha: string, at: string, subject: string}>}>}
 */
export const commitsAfter = async (cwd, base, cap) => {
  const total = Number((await git(cwd, ['rev-list', '--count', ...rangeOf(base)])).trim()) || 0;
  const out = await git(cwd, ['log', `-n${cap}`, '--format=%H%x1f%aI%x1f%s%x1e', ...rangeOf(base)]);
  const commits = out.split('\x1e').map((row) => row.trim()).filter(Boolean).map((row) => {
    const [sha, at, subject] = row.split('\x1f');
    return { sha, at, subject: subject || '' };
  });
  return { total, commits };
};

/**
 * Files added or changed after `base` under `pathspec`, with the newest
 * commit that touched each. impure.
 * @returns {Promise<Array<{status: string, file: string, sha: string}>>}
 */
export const filesChangedAfter = async (cwd, base, pathspec) => {
  const out = await git(cwd, ['log', '--format=%x1e%H', '--name-status', '--no-renames', ...rangeOf(base), '--', pathspec]);
  const seen = new Map();
  for (const block of out.split('\x1e').filter(Boolean)) {
    const [sha, ...rows] = block.trim().split('\n');
    for (const row of rows) {
      const [status, file] = row.split('\t');
      if (file && !seen.has(file)) seen.set(file, { status: status.trim(), file, sha: sha.trim() });
    }
  }
  return [...seen.values()];
};

/** A file's text at a commit, or null when it is not there. impure. */
export const textAt = async (cwd, rev, file) => {
  try { return await git(cwd, ['show', '--no-textconv', `${rev}:${file}`]); } catch { return null; }
};

/** Is `sha` a commit in this repo? impure. */
export const isCommit = async (cwd, sha) => {
  if (!/^[0-9a-f]{7,64}$/i.test(String(sha))) return false;
  try { return (await git(cwd, ['cat-file', '-t', String(sha)])).trim() === 'commit'; } catch { return false; }
};

/** One commit as git shows it: header, stat and patch, with no outside program. impure. */
export const commitPatch = async (cwd, sha) => git(cwd, [
  'show', '--no-ext-diff', '--no-textconv', '--no-color', '--stat', '--patch', '--format=commit %H%nDate: %aI%n%n%s%n%n%b', sha,
]);

/** A repo's origin web address as git records it, or null. impure. */
export const originOf = async (cwd) => {
  try { return (await git(cwd, ['remote', 'get-url', 'origin'])).trim() || null; } catch { return null; }
};
