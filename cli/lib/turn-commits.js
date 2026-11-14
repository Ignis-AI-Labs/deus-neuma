// turn-commits.js — `neuma code --commit` (or /commit on): after each request
// the being worked, commit exactly the files it changed, with a message made
// from the request (the Aider habit: every change reviewable in git, and
// undone in git too). Which files: the undo records the being's own edits
// wrote since the request began (edit-undo.js), still differing from HEAD by
// `git status`. Never the operator's other work: the commit names its paths,
// so anything else staged or dirty stays out; a file the operator had already
// changed before the request is committed whole, and the message says so.
// The operator's git hooks run as they would for any commit — a hook that
// refuses is reported, never bypassed.
// impure (fs reads, git).

import { readdirSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { UNDO_SUBDIR } from '../../backend/services/edit-undo.js';

const SUBJECT_MAX = 64;

// impure — git in the repository, output as text; a failure throws with git's own words.
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Is `root` the top of a git work tree? impure. */
export const isRepository = (root) => existsSync(join(root, '.git'));

// pure-ish — the path relative to the repository, whichever spelling of the root it was written under.
const insideRoot = (roots, abs) => {
  for (const root of roots) {
    const rel = relative(root, abs);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel;
  }
  return null;
};

/**
 * The repo-relative paths git reports as changed (modified, added, deleted,
 * untracked), optionally only among `paths`. impure.
 * @returns {string[]}
 */
export const changedPaths = (root, paths = null) => {
  if (paths && !paths.length) return [];
  const out = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', ...(paths ? ['--', ...paths] : [])]);
  const entries = out.split('\0').filter(Boolean);
  const changed = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    changed.push(entry.slice(3));
    // A rename carries its old path as the next entry.
    if (entry[0] === 'R' || entry[0] === 'C') i += 1;
  }
  return changed;
};

/**
 * The repo-relative paths the being's edits recorded at or after `sinceMs`
 * (the undo records in this repository), inside the repository only. impure.
 */
export const touchedSince = (root, sinceMs) => {
  const dir = join(root, UNDO_SUBDIR);
  if (!existsSync(dir)) return [];
  const paths = new Set();
  const roots = [...new Set([root, realpathSync(root)])];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (!(record.appliedAt >= sinceMs) || typeof record.path !== 'string') continue;
      const rel = insideRoot(roots, record.path);
      if (rel) paths.add(rel);
    } catch {
      // A record that does not parse names no file; undo reports it on its own.
    }
  }
  return [...paths].sort();
};

/**
 * The commit message for one request. pure.
 * @param {{request: string, being: string, paths: string[], heldBefore: string[], kind?: 'turn'|'undo'}} m
 */
export const commitMessage = ({ request, being, paths, heldBefore, kind = 'turn' }) => {
  const words = String(request).replace(/\s+/g, ' ').trim();
  const head = kind === 'undo' ? `undo: ${words}` : words;
  const subject = head.length > SUBJECT_MAX ? `${head.slice(0, SUBJECT_MAX - 1).trimEnd()}…` : head;
  return [
    subject || `${being}: changes`,
    '',
    ...paths.map((p) => `- ${p}${heldBefore.includes(p) ? ' (also held changes made before this request)' : ''}`),
    '',
    `Made by ${being}, a neuma, in neuma code.`,
    'Assisted-by: AI',
  ].join('\n');
};

/**
 * Commit the request's files. impure.
 * @param {{root: string, paths: string[], message: string}} c
 * @returns {{ok: true, sha: string, paths: string[]} | {ok: false, reason: string}}
 */
export const commitPaths = ({ root, paths, message }) => {
  const changed = changedPaths(root, paths);
  if (!changed.length) return { ok: false, reason: 'nothing changed' };
  try {
    git(root, ['add', '-A', '--', ...changed]);
    git(root, ['commit', '--quiet', '-m', message, '--', ...changed]);
    return { ok: true, sha: git(root, ['rev-parse', '--short', 'HEAD']).trim(), paths: changed };
  } catch (error) {
    return { ok: false, reason: String(error.stderr || error.message).trim().split('\n').slice(-3).join(' ') };
  }
};

/** One line for a commit's outcome. pure. */
const commitLine = (done) => (done.ok ? `  committed ${done.sha} — ${done.paths.join(', ')}` : `  not committed: ${done.reason}`);

/**
 * Wrap one request: note the moment and what was already dirty, run it, then
 * commit what the being changed. Returns the run's own result. impure.
 * @template T
 * @param {{root: string, request: string, being: string, run: () => Promise<T>, say: (s: string) => void}} t
 * @returns {Promise<T>}
 */
export const committedTurn = async ({ root, request, being, run, say }) => {
  const since = Date.now();
  const dirtyBefore = new Set(changedPaths(root));
  const result = await run();
  const touched = touchedSince(root, since);
  if (touched.length) {
    say(commitLine(commitPaths({ root, paths: touched, message: commitMessage({ request, being, paths: touched, heldBefore: touched.filter((p) => dirtyBefore.has(p)) }) })));
  }
  return result;
};

/** Commit what an undo put back, as its own commit — history is added to, never rewritten. impure. */
export const commitUndo = ({ root, absPath, being, said }) => {
  const rel = insideRoot([...new Set([root, realpathSync(root)])], absPath);
  if (!rel) return '';
  const request = said.split(absPath).join(rel);
  return commitLine(commitPaths({ root, paths: [rel], message: commitMessage({ request, being, paths: [rel], heldBefore: [], kind: 'undo' }) }));
};
