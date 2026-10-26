/**
 * Git status — the working-tree truth of a folder the witness opened, for the
 * explorer's VS Code-grade badges. One bounded `git status --porcelain=v1
 * --branch` per probe; the parse is pure and independently tested.
 *
 * An opened root that is a SUBDIRECTORY of a repo is served by the ENCLOSING
 * repo (VS Code parity): the toplevel is resolved with rev-parse, and the
 * porcelain keys — always toplevel-relative — are re-based onto the opened
 * root; paths outside it are dropped, so the tree's badges never leak a
 * sibling it isn't showing.
 *
 * Hostility model (same as repo-detect, D9): the probe can point at ANY
 * opened folder. Every subprocess is bounded (timeout + maxBuffer) and runs
 * with GIT_OPTIONAL_LOCKS=0 so a status probe never takes the index lock —
 * it can never race or block the witness's own git operations. core.quotepath
 * is off so non-ASCII names arrive as raw UTF-8 (never octal escapes the
 * tree can't match).
 */
import { execFile } from 'child_process';
import path from 'path';
import { detectRepo } from './repo-detect.js';
import { porcelainPath } from './git-porcelain-path.js';
import { withoutBackendSecrets } from './agent-terminal-environment.js';

// A giant status (ten thousand touched files) is still single-digit MB; past
// this the repo is pathological and the probe fails honestly, never an OOM.
const STATUS_MAX_BUFFER = 16 * 1024 * 1024;
const STATUS_TIMEOUT_MS = 8000;

// impure — one bounded git invocation; rejects on any failure.
const gitProbe = (dir, args) => new Promise((resolve, reject) => {
  execFile(
    'git',
    ['-C', dir, ...args],
    {
      timeout: STATUS_TIMEOUT_MS,
      maxBuffer: STATUS_MAX_BUFFER,
      env: { ...withoutBackendSecrets(process.env), GIT_OPTIONAL_LOCKS: '0' },
    },
    (error, out) => (error ? reject(error) : resolve(out)),
  );
});

// ── THE ONE GIT TRUTH (2026-09-02 audit) ────────────────────────────────────
// A desk with 14 open roots — five of them inside the SAME repo — probed each
// root separately: every calm poll and every burst flush paid a full
// `status --ignored=matching` per root, ~42 metered calls a minute at idle
// and over 400 under churn. The porcelain is a fact about the REPO, not the
// root, so the probe is cached per TOPLEVEL: concurrent callers share one
// in-flight spawn, and a 4s TTL folds the simultaneous polls into one read.
// Freshness law: the files watcher invalidates on every folded frame, so a
// real change is never hidden behind the TTL — the cache only serves CALM.
const STATUS_CACHE_TTL_MS = 4000;
const statusCache = new Map(); // toplevel → { at, parsed } | { pending }

/** impure — drop every cached status. Called by the files watcher's flush. */
export const invalidateGitStatusCache = () => { statusCache.clear(); };

// impure — one probe per repo at a time; a failed probe is never cached.
const cachedRepoStatus = async (top) => {
  const hit = statusCache.get(top);
  if (hit?.parsed && Date.now() - hit.at < STATUS_CACHE_TTL_MS) return hit.parsed;
  if (hit?.pending) return hit.pending;
  const pending = gitProbe(top, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--branch', '--untracked-files=normal', '--ignored=matching']).then(parsePorcelain);
  statusCache.set(top, { pending });
  try {
    const parsed = await pending;
    if (statusCache.get(top)?.pending === pending) {
      statusCache.set(top, { at: Date.now(), parsed });
    }
    return parsed;
  } catch (err) {
    if (statusCache.get(top)?.pending === pending) statusCache.delete(top);
    throw err;
  }
};

/**
 * Map a porcelain v1 XY code to the one badge letter the tree shows.
 * Conflict strongest; an added file reads A even when also touched (AM);
 * a rename badges its destination as modified; typechange is a modification.
 * @param {string} xy two-character status code (or '??' for untracked)
 * @returns {'C'|'A'|'M'|'D'|'U'|null} null for codes the tree ignores
 */
// pure
export const letterForCode = (xy) => {
  if (xy === '??') return 'U';
  if (['DD', 'AA', 'UU', 'AU', 'UA', 'DU', 'UD'].includes(xy)) return 'C';
  const [x, y] = xy;
  if (x === 'A') return 'A';
  if (x === 'R') return 'M';
  if (x === 'M' || y === 'M') return 'M';
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'T' || y === 'T') return 'M';
  return null; // unmodified, copied, ignored — no badge
};

/**
 * Parse `git status --porcelain=v1 --branch` output. Branch is null when
 * detached; ahead/behind are 0 without an upstream. Paths are repo-relative,
 * exactly as the tree needs them; a renamed entry badges its NEW path.
 * Ignored paths ('!!', probed with --ignored=matching) land in their own
 * list — an ignored file is not a change, so it never earns a badge or a
 * rollup; the tree only GRAYS it.
 * @param {string} text raw porcelain output
 * @returns {{branch: string|null, ahead: number, behind: number, files: Object<string, string>, ignored: string[]}}
 */
// pure
export const parsePorcelain = (text) => {
  const out = { branch: null, ahead: 0, behind: 0, files: {}, ignored: [] };
  if (typeof text !== 'string') return out;
  for (const line of text.split('\n')) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      const head = line.slice(3);
      const noCommits = head.match(/^No commits yet on (.+?)(?:\.\.\.|$)/);
      const tracking = head.match(/^(.+?)(?:\.\.\..*)?$/);
      if (noCommits) out.branch = noCommits[1];
      else if (tracking && tracking[1] !== 'HEAD (no branch)') out.branch = tracking[1];
      const ahead = head.match(/ahead (\d+)/);
      const behind = head.match(/behind (\d+)/);
      if (ahead) out.ahead = Number(ahead[1]);
      if (behind) out.behind = Number(behind[1]);
      continue;
    }
    const xy = line.slice(0, 2);
    const p = porcelainPath(xy, line.slice(3));
    if (xy === '!!') {
      out.ignored.push(p.replace(/\/+$/, '')); // a matching dir arrives with a trailing slash
      continue;
    }
    const letter = letterForCode(xy);
    if (letter && p) out.files[p] = letter;
  }
  return out;
};

/**
 * Read the live git status of an opened folder. A folder carrying its own
 * `.git` is its own repo; a folder INSIDE one is served by the enclosing
 * repo with its keys re-based (paths outside the folder dropped). A folder
 * in no repo answers { isRepo: false } — never a throw. Subprocess failures
 * (timeout, overflow, missing git) DO throw — the route turns them into an
 * honest 500 and the tree simply shows no badges.
 * @param {string} absPath absolute, already-contained folder path
 * @returns {Promise<{isRepo: false}|{isRepo: true, branch: string|null, ahead: number, behind: number, files: Object<string, string>, ignored: string[]}>}
 */
// impure
export const readGitStatus = async (absPath) => {
  const repo = await detectRepo(absPath);
  const top = repo.isRepo
    ? absPath
    : await gitProbe(absPath, ['rev-parse', '--show-toplevel']).then((t) => t.trim() || null).catch(() => null);
  if (!top) return { isRepo: false };
  const parsed = await cachedRepoStatus(top);
  // Porcelain keys are toplevel-relative; the tree thinks in root-relative.
  const rel = path.relative(top, absPath);
  if (!rel) return { isRepo: true, ...parsed };
  const files = {};
  for (const [p, letter] of Object.entries(parsed.files)) {
    if (p.startsWith(`${rel}/`)) files[p.slice(rel.length + 1)] = letter;
  }
  const ignored = parsed.ignored.filter((p) => p.startsWith(`${rel}/`)).map((p) => p.slice(rel.length + 1));
  return { isRepo: true, ...parsed, files, ignored };
};
