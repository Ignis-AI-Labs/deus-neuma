/** Live Git's closed process boundary. No diagnostic/config bytes leave as errors. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { GIT_REMOTE_REFUSAL } from './ground-git-remote.js';
import { gitHubNetworkConfig } from './github-git-auth.js';
export { validateGroundRemote } from './ground-git-remote.js';

const LIMIT = 4 * 1024 * 1024;
const BASE = Object.freeze([
  '--no-optional-locks', '--no-pager',
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
  '-c', 'core.attributesFile=/dev/null', '-c', 'core.excludesFile=/dev/null', '-c', 'core.pager=cat',
  '-c', 'diff.external=', '-c', 'diff.trustExitCode=false',
  '-c', 'credential.helper=', '-c', 'credential.interactive=false',
  '-c', 'http.followRedirects=false', '-c', 'http.sslVerify=true',
  '-c', 'http.proxy=', '-c', 'http.extraHeader=',
  '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
  '-c', 'protocol.http.allow=always', '-c', 'protocol.file.allow=never',
  '-c', 'fetch.recurseSubmodules=false', '-c', 'submodule.recurse=false',
  '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.untrackedCache=false',
]);

/** impure - fixed executable search path; no host credential, loader or Git env. */
export const groundGitEnv = () => ({
  PATH: '/usr/bin:/bin', HOME: '/dev/null', LANG: 'C.UTF-8',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1',
  GIT_ALLOW_PROTOCOL: 'https:http',
});

/** Pure - closed, bounded error vocabulary; never reflect child output. */
export const gitFailure = (code = 'git_failed', configCategory) => {
  const category = ['filter', 'credential', 'include', 'includeif', 'url', 'diff', 'core', 'http', 'extensions'].includes(configCategory)
    ? configCategory : 'unrecognized metadata';
  const reasons = {
    git_failed: 'Git operation failed; raw diagnostics withheld.',
    cancelled: 'Git operation interrupted; refs or checkout may have changed if execution began.',
    timeout: 'Git operation timed out; refs or checkout may have changed if execution began.',
    output_limit: 'Git output exceeded the bounded read limit.',
    unsafe_config: `Git config refused: ${category} category. No remote transport was tested; do not infer an SSH or authentication failure.`,
    unsafe_transport: GIT_REMOTE_REFUSAL,
    changed: 'Git target changed after preview; request fresh approval.',
    locked: 'Another ground sync owns this repository lock; retry after it finishes. Stale locks require operator inspection.',
    lock_release: 'Git operation ended but its lock could not be released; operator inspection required.',
    no_upstream: 'Sync requires a committed branch with one remote upstream tracking branch.',
    dirty: 'Sync requires a clean index and working tree; preserve local work before syncing.',
    dedicated_sync: 'This checkout requires its dev-only workflow. Finish and publish owned work, wait for its approved merge to dev, then run node scripts/sync-from-dev.mjs --apply from the operator live checkout with a clean tree/index and no pending Git operation. Generic upstream sync cannot substitute for this workflow.',
    invalid_args: 'This Git tool accepts an empty object only.',
    invalid_history_args: 'History accepts only ref and path strings and an integer limit from 1 to 50.',
    context_changed: 'The originating Git lane, session, turn or focused ground changed; request fresh approval.',
    private_auth: 'Remote Git access failed. Check connectivity and repository permissions. For private GitHub access, sign in to GitHub CLI on this machine; ambient Git helpers and SSH credentials are not used.',
    github_auth_unavailable: 'GitHub CLI credentials could not be loaded; check the operator login.',
    github_auth_scope: 'GitHub authorization does not cover this command or repository.',
  };
  const safeCode = Object.hasOwn(reasons, code) ? code : 'git_failed';
  return Object.assign(new Error(reasons[safeCode]), { code: safeCode, category });
};

// impure - detached process group means interrupt kills fetch helpers too, not
// just git's parent. SIGKILL avoids a child ignoring SIGTERM outliving consent.
const run = (cwd, args, { signal, timeoutMs = 10000, authorization } = {}) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(gitFailure('cancelled')); return; }
  const network = gitHubNetworkConfig(authorization, args);
  const child = spawn('/usr/bin/git', [...BASE, ...network.args, ...args], {
    cwd, env: { ...groundGitEnv(), ...network.env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let size = 0;
  let failure;
  const stop = (code) => {
    failure ||= gitFailure(code);
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') failure = gitFailure(); }
    }
  };
  const abort = () => stop('cancelled');
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => stop('timeout'), timeoutMs);
  const count = (chunk) => { size += chunk.length; if (size > LIMIT) stop('output_limit'); };
  child.stdout.on('data', (chunk) => { count(chunk); if (!failure) stdout += chunk.toString(); });
  child.stderr.on('data', count);
  child.once('error', () => { failure ||= gitFailure(); });
  child.once('close', (code) => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (failure || code !== 0) reject(failure || gitFailure());
    else resolve(stdout);
  });
});

// Config is data for preflight only. Unknown configuration fails closed instead
// of maintaining an inevitably incomplete list of executable Git mechanisms.
const SAFE_KEY = /^(?:core\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|autocrlf|eol|safecrlf|hookspath|fsmonitor)|user\.(?:name|email)|branch\.[^.]+(?:\.[^.]+)*\.(?:remote|merge|description)|remote\.[^.]+\.(?:url|fetch)|extensions\.objectformat)$/i;
// Inert preferences used by editors/Git LFS metadata, not executable filters.
// These keys are never consulted for authentication or command construction.
const METADATA_KEY = /^(?:branch\..+\.(?:vscode-merge-base|vscode-merge-base-server|rebase)|lfs\.(?:repositoryformatversion|.+\.access)|user\.signingkey|commit\.gpgsign|tag\.gpgsign|pull\.(?:rebase|ff)|remote\.[^.]+\.pushurl)$/i;

const unsupportedConfig = (key) => {
  // Never echo key values or arbitrary subsection names (they may embed URLs).
  const family = /^(filter|credential|include|includeif|url|diff|core|http|extensions)\./i.exec(key)?.[1]?.toLowerCase();
  return gitFailure('unsafe_config', family);
};

/** impure - preflight rejects includes and worktree-specific config; no config is returned. */
export const groundConfigDigest = async (root, options) => {
  // BASE overrides are intentionally not present in this listing: --local
  // selects repository config only, while --includes reveals forbidden includes.
  const text = await run(root, ['config', '--local', '--includes', '--null', '--list'], options);
  for (const entry of text.split('\0').filter(Boolean)) {
    const key = entry.split('\n', 1)[0];
    if (!SAFE_KEY.test(key) && !METADATA_KEY.test(key)) throw unsupportedConfig(key);
  }
  return createHash('sha256').update(text).digest('hex');
};

/** impure - internal Git output, consumed only by closed structured readers. */
export const runGroundGit = async (root, args, options = {}) => {
  await groundConfigDigest(root, { signal: options.signal, timeoutMs: options.timeoutMs });
  return run(root, args, options);
};

/** Pure - metadata/history are untrusted content, not Git diagnostics. */
export const redactGitText = (value) => {
  const text = String(value ?? '')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[redacted]@')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted]')
    .replace(/\b(?:authorization|password|token|secret)\s*[:=]\s*[^\s]+/gi, '[redacted]')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  return text.length > 6000 ? `${text.slice(0, 5900)}\n[truncated; narrow the history query]` : text;
};
