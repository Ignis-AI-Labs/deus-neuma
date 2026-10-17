/**
 * Ground git metadata — read-only sight of the LIVE checkout's branch state.
 *
 * The coding shell masks the ground's `.git` from its overlay view, so
 * in-shell git sees no repository at all — by design. (The copy-era ancestor
 * of this hazard: a snapshot carried its own `git init` baseline, a witness
 * ran `git branch --show-current` there, and reported the operator's
 * repository as `master` while it was really on `main`, 2026-07-29.)
 *
 * The honest fix is NOT to copy `.git` into the snapshot — `.git/config` carries
 * remote tokens, and `.git/` is a denied path in `tool-sandbox.js` after a proven
 * rename-out/inject-remote/rename-back attack. Instead the backend reads the
 * ground itself, with a closed set of read-only commands, and returns the facts
 * as text. No repository content, no config, and above all no remote URLs cross
 * over — a remote URL can embed a token.
 */
import path from 'path';
import { hasGroundGitMarker } from './ground-git-presence.js';
import { runGroundGit, redactGitText, gitFailure } from './ground-git-exec.js';
export { groundGitEnv } from './ground-git-exec.js';
const SHORT_SHA_LENGTH = 12;

/**
 * Count the working-tree states in `git status --porcelain=v1` output.
 * Pure.
 * @param {string} porcelain raw porcelain v1 text
 * @returns {{staged:number,modified:number,untracked:number}}
 */
export const parseStatusCounts = (porcelain) => {
  const lines = String(porcelain || '').split('\n').filter((line) => line.length >= 2);
  return lines.reduce((counts, line) => {
    const index = line[0];
    const worktree = line[1];
    if (index === '?' && worktree === '?') return { ...counts, untracked: counts.untracked + 1 };
    return {
      ...counts,
      staged: index !== ' ' ? counts.staged + 1 : counts.staged,
      modified: worktree !== ' ' ? counts.modified + 1 : counts.modified,
    };
  }, { staged: 0, modified: 0, untracked: 0 });
};

/**
 * Read the ahead/behind pair from `git rev-list --left-right --count HEAD...@{u}`.
 * Pure. Returns null when the output is not the expected two-number shape.
 * @param {string} text raw command output
 * @returns {{ahead:number,behind:number}|null}
 */
export const parseAheadBehind = (text) => {
  const parts = String(text || '').trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const ahead = Number(parts[0]);
  const behind = Number(parts[1]);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) return null;
  return { ahead, behind };
};

/**
 * Render one ground state as the text a witness reads.
 * Pure.
 * @param {object} state the object from readGroundGit
 * @returns {string}
 */
export const formatGroundGit = (state) => {
  if (!state.isRepository) {
    return redactGitText([`ground:   ${state.ground}`, 'git:      (not a git repository)'].join('\n'));
  }
  const upstream = state.upstream
    ? `${state.upstream} (ahead ${state.ahead}, behind ${state.behind})`
    : '(no upstream tracking branch)';
  return redactGitText([
    `ground:   ${state.ground}`,
    `branch:   ${state.branch}`,
    `head:     ${state.head}`,
    `upstream: ${upstream}`,
    `dirty:    ${state.staged} staged, ${state.modified} modified, ${state.untracked} untracked`,
  ].join('\n'));
};

// impure — one read-only git command in the ground. Resolves to trimmed stdout,
// or null when git exits nonzero (no upstream, no commits, not a repository).
const readGit = async (ground, args, options) => {
  try {
    const text = await runGroundGit(ground, args, options);
    return args[0] === 'status' ? text.trimEnd() : text.trim();
  } catch (error) {
    if (error.code !== 'git_failed') throw error;
    return null;
  }
};

// impure — the upstream ref and this branch's divergence from it, if it has one.
const readTracking = async (ground, options) => {
  const upstream = await readGit(ground, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], options);
  if (!upstream) return { upstream: null, ahead: 0, behind: 0 };
  const counts = parseAheadBehind(await readGit(ground, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], options));
  if (!counts) throw gitFailure();
  return { upstream, ...counts };
};

const LOG_LIMIT_DEFAULT = 20;
const LOG_LIMIT_MAX = 50;

/** A ref a resident may name: starts alphanumeric (a leading `-` would read as
 *  a flag), then the characters real refs use. Pure. */
export const isSafeRef = (ref) =>
  typeof ref === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/^~@{}-]{0,127}$/.test(ref);

/**
 * The recent commits, newest first — one line each, optionally only those
 * touching one path. Null when the ground has no commits or is not a repo.
 * impure. @param {string} groundRoot @param {{limit?:number, path?:string|null}} [opts]
 */
export const readGroundLog = async (groundRoot, { limit = LOG_LIMIT_DEFAULT, path: relPath = null, signal } = {}) => {
  const n = Math.min(Math.max(Number.isInteger(limit) ? limit : LOG_LIMIT_DEFAULT, 1), LOG_LIMIT_MAX);
  const out = await readGit(path.resolve(groundRoot), [
    'log', '-n', String(n), '--date=format:%Y-%m-%d %H:%M',
    '--pretty=format:%h  %ad  %an — %s',
    ...(relPath ? ['--', relPath] : []),
  ], { signal });
  return out === null ? null : redactGitText(out);
};

/**
 * One commit: its message and which files it touched (stat, never the patch —
 * a full diff is a pile; the current files themselves are the honest read of
 * content). Null for an unknown or unsafe ref. impure.
 */
export const readGroundCommit = async (groundRoot, ref, options) => {
  if (!isSafeRef(ref)) return null;
  const oid = await readGit(path.resolve(groundRoot), ['rev-parse', '--verify', `${ref}^{commit}`], options);
  if (!oid || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(oid)) return null;
  const out = await readGit(path.resolve(groundRoot), [
    'show', '--no-ext-diff', '--no-textconv', '--stat', '--date=format:%Y-%m-%d %H:%M',
    '--format=commit %h%nauthor %an%ndate   %ad%n%n%s%n%n%b', oid, '--',
  ], options);
  return out === null ? null : redactGitText(out);
};

/**
 * What is changed but not yet committed, vs HEAD — the stat view. Null when
 * there is no HEAD to diff against. impure.
 */
export const readGroundDiff = async (groundRoot, { path: relPath = null, signal } = {}) => {
  const out = await readGit(path.resolve(groundRoot), [
    'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', 'HEAD', '--stat', '--', ...(relPath ? [relPath] : []),
  ], { signal });
  return out === null ? null : redactGitText(out || '(nothing uncommitted)');
};

/**
 * Read the live checkout's branch state.
 * impure — runs read-only git commands in the operator's ground.
 * @param {string} groundRoot the opened workspace directory
 * @returns {Promise<object>} ground state; `isRepository:false` when it is not one
 */
export const readGroundGit = async (groundRoot, options) => {
  const ground = path.resolve(groundRoot);
  const inside = await readGit(ground, ['rev-parse', '--is-inside-work-tree'], options);
  if (inside !== 'true') {
    // A failed config preflight must not turn an existing checkout into absence.
    if (inside === null && await hasGroundGitMarker(ground)) throw gitFailure();
    return { ground, isRepository: false };
  }

  const [branchRef, head, porcelain, tracking] = await Promise.all([
    readGit(ground, ['rev-parse', '--abbrev-ref', 'HEAD'], options),
    readGit(ground, ['rev-parse', 'HEAD'], options),
    readGit(ground, ['status', '--porcelain=v1', '--ignore-submodules=all'], options),
    readTracking(ground, options),
  ]);
  if (porcelain === null) throw gitFailure();

  return {
    ground,
    isRepository: true,
    // `--abbrev-ref HEAD` answers the literal string "HEAD" when detached; that
    // is a state, not a branch name, and must not read as one.
    branch: !branchRef || branchRef === 'HEAD' ? '(detached HEAD)' : branchRef,
    head: head ? head.slice(0, SHORT_SHA_LENGTH) : '(no commits yet)',
    ...tracking,
    ...parseStatusCounts(porcelain),
  };
};
