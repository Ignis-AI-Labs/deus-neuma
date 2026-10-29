// untrusted-git.js — a repository's own config is DATA, never instructions. impure where marked
//
// Audit 2026-10-28 H-01: the explorer ran `git status` on any folder the operator opened, and a
// repository's own .git/config can name a program for git to run during that walk —
// core.fsmonitor (the finding), a clean filter named by .gitattributes (status hashes racy
// files through it), a textconv or external diff (log -p, diff), a signature program
// (log.showSignature + gpg.program), hooks. A cloned or downloaded repository is someone
// else's config. Every platform read of a repository goes through these overrides, and a probe
// that walks the working tree (status) first proves the repository's own config is inert —
// the same allowlist the being's ground git holds (ground-git-exec.js groundConfigDigest),
// failing closed on anything it does not know.

import { groundConfigDigest } from './ground-git-exec.js';
import { helperEnvironment } from './agent-terminal-environment.js';

/**
 * The overrides for every git read of a repository the platform did not write: command-line
 * config outranks every file, so nothing the repository sets can name a program to run here.
 * Put them right after `git` (before -C and the subcommand).
 */
export const UNTRUSTED_GIT_ARGS = Object.freeze([
  '--no-optional-locks', '--no-pager',
  '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.pager=cat',
  '-c', 'diff.external=', '-c', 'log.showSignature=false', '-c', 'core.untrackedCache=false',
]);

/**
 * The environment for those reads: never the backend's own secrets, no prompts, no pager, no
 * index lock.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv}
 */
export const untrustedGitEnv = (env = process.env) => ({
  // git's own tracing is the operator's diagnostic, never a secret, and it names no program
  ...helperEnvironment(env, process.platform, (key) => key.startsWith('GIT_TRACE')),
  GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0',
});

/**
 * Is this repository's own config inert — nothing in it can name a program for git to run
 * (filters, diff drivers, includes, credential helpers, unknown keys all fail)? impure (git config).
 * @param {string} root - the repository's toplevel
 * @returns {Promise<boolean>}
 */
export const repoConfigIsInert = async (root) => {
  try { await groundConfigDigest(root, { timeoutMs: 4000 }); return true; } catch { return false; }
};
