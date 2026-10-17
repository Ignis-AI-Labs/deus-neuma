// impure: operator CLI credential lookup; tokens never become tool results.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { validateGroundRemote, isGitHubRemote } from './ground-git-remote.js';

const authorizations = new WeakMap();
const HEADER_ENV = 'NEUMA_GITHUB_GIT_AUTH';
const LOOKUP_TIMEOUT_MS = 5000;
const OUTPUT_LIMIT = 4096;
const PREFIXES = Object.freeze({
  'ls-remote': Object.freeze(['ls-remote', '--refs', '--exit-code', '--']),
  fetch: Object.freeze(['fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--no-auto-maintenance', '--']),
});
const failure = (code) => Object.assign(new Error(
  code === 'cancelled' ? 'GitHub credential lookup interrupted.'
    : code === 'github_auth_scope' ? 'GitHub authorization does not cover this command or repository.'
      : 'GitHub CLI credentials could not be loaded; check the operator login.'), { code });

// Only the operator's CLI/keyring environment, never ambient GH_TOKEN,
// GITHUB_TOKEN, GH_HOST, Git config or loader injection variables.
const cliEnvironment = () => {
  const env = { PATH: '/usr/bin:/bin', HOME: process.env.HOME || homedir(), LANG: 'C.UTF-8', GH_PROMPT_DISABLED: '1' };
  for (const key of ['GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
};

const lookupCliValue = (args, env, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(failure('cancelled')); return; }
  const child = spawn('/usr/bin/gh', args, {
    cwd: '/', env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  let size = 0;
  let error;
  let unavailable = false;
  const stop = (code) => {
    error ||= failure(code);
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (killError) { if (killError.code !== 'ESRCH') error = failure('github_auth_unavailable'); }
    }
  };
  const abort = () => stop('cancelled');
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => stop('github_auth_unavailable'), LOOKUP_TIMEOUT_MS);
  const count = (chunk) => { size += chunk.length; if (size > OUTPUT_LIMIT) stop('github_auth_unavailable'); };
  child.stdout.on('data', (chunk) => { count(chunk); if (!error) text += chunk.toString('utf8'); });
  child.stderr.on('data', count);
  child.once('error', (spawnError) => {
    if (spawnError.code === 'ENOENT') unavailable = true;
    else error = failure('github_auth_unavailable');
  });
  child.once('close', (code) => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (error) { reject(error); return; }
    if (unavailable || code !== 0) { resolve(null); return; }
    resolve(text.trim());
  });
});

/** Resolve AFTER Git approval. Public/loopback access needs no credential.
 * Returns an opaque per-repository capability, never an enumerable secret. impure. */
export const resolveGitHubAuthorization = async (remote, { signal } = {}) => {
  const url = validateGroundRemote(remote);
  if (!isGitHubRemote(url)) return null;
  const env = cliEnvironment();
  // A hostname-only token lookup can fall back to a host-wide keyring entry
  // even when this CLI profile has no account. Bind the selected user first.
  const account = await lookupCliValue(['config', 'get', 'user', '--host', 'github.com'], env, signal);
  if (!account) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(account)) throw failure('github_auth_unavailable');
  const token = await lookupCliValue(['auth', 'token', '--hostname', 'github.com', '--user', account], env, signal);
  if (signal?.aborted) throw failure('cancelled');
  if (!token) return null;
  if (!/^[A-Za-z0-9_]{16,512}$/.test(token)) throw failure('github_auth_unavailable');
  const authorization = Object.freeze({ repository: url });
  authorizations.set(authorization, `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`);
  return authorization;
};

/** Network-only subprocess options. Exact command shapes prevent credential
 * scope from becoming an arbitrary Git helper/metadata execution channel. impure. */
export const gitHubNetworkConfig = (authorization, args) => {
  if (authorization == null) return { args: [], env: {} };
  const header = authorizations.get(authorization);
  const prefix = Object.hasOwn(PREFIXES, args[0]) ? PREFIXES[args[0]] : null;
  if (!header || !prefix || args.length !== prefix.length + 2
    || !prefix.every((value, i) => args[i] === value)
    || args[prefix.length] !== authorization.repository) throw failure('github_auth_scope');
  const ref = args.at(-1);
  const valid = args[0] === 'fetch' ? /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(ref)
    : /^refs\/heads\/[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(ref);
  if (!valid) throw failure('github_auth_scope');
  return {
    args: [`--config-env=http.${authorization.repository}.extraHeader=${HEADER_ENV}`],
    env: { [HEADER_ENV]: header },
  };
};

/** End the credential lifetime when this fetch finishes or fails. impure. */
export const releaseGitHubAuthorization = (authorization) => {
  if (authorization) authorizations.delete(authorization);
};
