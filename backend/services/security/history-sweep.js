// History sweep — the secret sweep's second eye: every commit on every ref of
// a watched repo, not just the files at HEAD.
//
// Why it exists: on 2026-04-14 live keys were pasted into a tracked doc and
// pushed; the doc was later redacted, so the HEAD sweep read it clean, and
// the values still sat in a pushed commit on six remote branches with no
// ledger entry anywhere. Deleting a line never un-publishes it — only the
// history can say what has already left the machine.
//
// How: git's own pickaxe (`log --all -G`) picks the commits whose diff adds or
// removes a line of any secret shape, in one pass (~10 s over neuma's ~14k
// commits); only those patches stream back, and every ADDED line is judged by
// the same pattern table, allowlist and public-dev-key skip as the HEAD sweep.
//
// Same law as the HEAD sweep: the matched value never leaves this module —
// not in a finding, not in a log line. A finding names the rule, a short
// one-way fingerprint, the commit, the path, and whether a remote holds it.

import fs from 'fs/promises';
import { spawn, execFile } from 'child_process';
import { createInterface } from 'readline';
import { promisify } from 'util';
import { SECRET_PATTERNS, scanLine, isAllowlisted } from './secret-sweep.js';
import { rotationRemedy } from './threat-remedy.js';
import { UNTRUSTED_GIT_ARGS, untrustedGitEnv } from '../untrusted-git.js';

const execFileP = promisify(execFile);

const HISTORY_TIMEOUT_MS = 5 * 60_000;
const STDERR_KEPT = 2000;
// Marks a commit header in the stream; a patch line never starts with it.
const COMMIT_MARK = '\x01';

const REMOTE_VERDICT = Object.freeze({
  true: 'A remote branch holds it, so the value has left this machine: rotate the credential. Deleting the file or rewriting history does not un-publish it.',
  false: 'No remote branch holds it yet: rotate it, or rewrite this history before it is ever pushed.',
  null: 'Whether a remote branch holds it could not be read, so treat it as published: rotate the credential.',
});

// pure — every rule's prefilter as one ERE alternation (git reads it with -i).
const historyPrefilter = (patterns = SECRET_PATTERNS) =>
  patterns.map(({ ere }) => `(${ere})`).join('|');

// pure — a path out of a `--- a/x` / `+++ b/x` header: the a/ b/ prefix
// dropped, a quoted name unquoted, and the tab git appends after a name
// that holds a space trimmed.
const headerPath = (rest) => rest.replace(/\t$/, '').replace(/^"(.*)"$/, '$1').replace(/^[ab]\//, '');

// A scanner fed `git log -p --format=<COMMIT_MARK>%H` lines in order. Each
// added line is judged with the line after it (a PEM header's fingerprint
// needs its first body line), so a line is held until the next one arrives.
// Pure over its own state — no IO.
const createPatchScanner = () => {
  const hits = [];
  let commit = null;
  let path = null;
  let inHunk = false;
  let held = null;

  const release = (next) => {
    if (held === null) return;
    for (const hit of scanLine(held, next)) hits.push({ commit, path, ...hit });
    held = null;
  };

  return {
    line(raw) {
      if (raw.startsWith(COMMIT_MARK)) {
        release('');
        commit = raw.slice(1).trim();
        path = null;
        inHunk = false;
        return;
      }
      if (raw.startsWith('diff --git ')) {
        release('');
        path = null;
        inHunk = false;
        return;
      }
      // Header lines exist only before a file's first hunk; inside a hunk a
      // content line that begins "++ " is still content.
      if (!inHunk && raw.startsWith('--- ')) {
        if (raw !== '--- /dev/null') path = headerPath(raw.slice(4));
        return;
      }
      if (!inHunk && raw.startsWith('+++ ')) {
        if (raw !== '+++ /dev/null') path = headerPath(raw.slice(4));
        return;
      }
      if (raw.startsWith('@@')) {
        release('');
        inHunk = true;
        return;
      }
      if (inHunk && raw.startsWith('+')) {
        const body = raw.slice(1);
        release(body);
        if (path && !isAllowlisted(path)) held = body;
        return;
      }
      release('');
    },
    end() {
      release('');
      return hits;
    },
  };
};

// pure — hits as ledger-ready threats, ONE per (rule, value): a key that sits
// in forty commits is one leak. Hits arrive newest commit first (git log's
// order), so the last occurrence is where the value entered the history.
// `remoteCommits` null = the remote refs could not be read, and the finding
// says so rather than reading "local only" — a false all-clear on the one
// question that decides rotation.
const historyFindings = (repo, hits, remoteCommits) => {
  const byValue = new Map();
  for (const hit of hits) {
    const key = `${hit.patternId}:${hit.fingerprint}`;
    byValue.set(key, [...(byValue.get(key) || []), hit]);
  }
  return [...byValue.values()].map((seen) => {
    const origin = seen[seen.length - 1];
    const commits = new Set(seen.map((h) => h.commit));
    const paths = [...new Set(seen.map((h) => h.path))];
    const onRemote = remoteCommits ? [...commits].some((sha) => remoteCommits.has(sha)) : null;
    const short = origin.commit.slice(0, 12);
    const where = `A "${origin.patternId}" value entered the history in commit ${short} (${origin.path}); ${commits.size} commit(s) carry it.`;
    return {
      layer: 'software',
      source: 'secret-sweep',
      repo: repo.id,
      externalId: `history:${origin.patternId}:${origin.fingerprint}`,
      title: `secret (${origin.patternId}) in the git history of ${origin.path}`,
      severity: onRemote === false ? 'high' : 'critical',
      summary: `${where} ${REMOTE_VERDICT[String(onRemote)]} The matched text is deliberately not recorded.`,
      // The variable is named once leak-liveness.js finds the value in an env
      // file; until then the rule is all that is known of it.
      remedy: rotationRemedy(origin.patternId, `the ${origin.patternId} credential`),
      surfaces: paths,
      patternId: origin.patternId,
      fingerprint: origin.fingerprint,
      commit: origin.commit,
      path: origin.path,
      onRemote,
      commits: commits.size,
    };
  });
};

/**
 * pure — env-file findings (house-probe) whose values the history sweep also
 * found in a commit: the file itself may never have been committed, but the
 * value has, so the verdict becomes critical + rotate. Matched by the one-way
 * rule:fingerprint both sides carry; no value is compared or held.
 * @param {Array<Object>} houseFindings - runHouseProbe findings
 * @param {Array<Object>} historyFindings - sweepRepoHistory findings (any repos)
 * @returns {Array<Object>} the house findings, leaked ones escalated
 */
export const escalateLeakedEnvFindings = (houseFindings, historyFindings) => {
  const leaks = new Map(historyFindings.map((h) => [`${h.patternId}:${h.fingerprint}`, h]));
  return houseFindings.map((finding) => {
    const leak = (finding.fingerprints || []).map((fp) => leaks.get(fp)).find(Boolean);
    if (!leak) return finding;
    const where = `${leak.repo} commit ${leak.commit.slice(0, 12)} (${leak.path})${leak.onRemote ? ', on a remote branch' : ''}`;
    return {
      ...finding,
      severity: 'critical',
      summary: `${finding.summary} A value in this file also sits in git history: ${where}. Rotate that key first; sealing a key that already leaked protects nothing.`,
      remedy: `${rotationRemedy(leak.patternId, `the ${leak.patternId} credential in ${finding.surfaces?.[0] || 'this env file'}`)}; then seal the new value (scripts/secure-witness-keys.mjs) — sealing the leaked one protects nothing.`,
    };
  });
};

// impure — every commit the remote-tracking refs reach (as of the last
// fetch; the sweep never touches the network).
const remoteCommitSet = async (cwd) => {
  const { stdout } = await execFileP('git', [...UNTRUSTED_GIT_ARGS, 'rev-list', '--remotes'], { cwd, env: untrustedGitEnv(), maxBuffer: 256 * 1024 * 1024 });
  return new Set(stdout.split('\n').filter(Boolean));
};

// impure — stream the pickaxe's patches through the scanner. Resolves with
// the hits and an error string (null on a clean exit); never rejects.
const scanHistory = (cwd, timeoutMs) => new Promise((resolve) => {
  const scanner = createPatchScanner();
  const child = spawn('git', [
    ...UNTRUSTED_GIT_ARGS, '-c', 'core.quotePath=false', 'log', '--all', '-i', `-G${historyPrefilter()}`,
    `--format=${COMMIT_MARK}%H`, '-p', '-U0', '--no-color', '--no-ext-diff', '--no-textconv',
  ], { cwd, env: untrustedGitEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  child.stderr.on('data', (chunk) => { if (stderr.length < STDERR_KEPT) stderr += chunk; });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (raw) => scanner.line(raw));
  const exited = new Promise((done) => child.on('close', done));
  child.on('error', (err) => { stderr += err.message; });
  Promise.all([exited, new Promise((done) => lines.on('close', done))]).then(([code]) => {
    clearTimeout(timer);
    const error = timedOut ? `git history scan timed out after ${timeoutMs} ms`
      : code === 0 ? null : `git log failed: ${stderr.trim().split('\n')[0] || `exit ${code}`}`;
    resolve({ hits: scanner.end(), error });
  });
});

/**
 * Sweep one watched repo's whole git history. Never throws — a repo that
 * cannot be read lands as an honest error, and hits found before a failure
 * are still returned (each one is real).
 *
 * impure — spawns git, reads the repo
 * @param {{id: string, path: string}} repo
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{repo: string, findings: Array<Object>, error: string|null, durationMs: number}>}
 */
export const sweepRepoHistory = async (repo, { timeoutMs = HISTORY_TIMEOUT_MS } = {}) => {
  const startedAt = Date.now();
  const done = (findings, error) => ({ repo: repo.id, findings, error, durationMs: Date.now() - startedAt });
  const at = await fs.stat(repo.path).catch(() => null);
  if (!at?.isDirectory()) return done([], `watched repo path is gone: ${repo.path}`);
  const { hits, error } = await scanHistory(repo.path, timeoutMs);
  if (!hits.length) return done([], error);
  try {
    return done(historyFindings(repo, hits, await remoteCommitSet(repo.path)), error);
  } catch (err) {
    return done(historyFindings(repo, hits, null), [error, `remote branches unreadable: ${err.message}`].filter(Boolean).join(' | '));
  }
};
