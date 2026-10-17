import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const GIT = '/usr/bin/git';
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const GIT_OPTIONS = Object.freeze([
  '--no-optional-locks', '--no-replace-objects',
  '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
  '-c', 'credential.helper=', '-c', 'core.askPass=',
  '-c', 'diff.external=', '-c', 'core.pager=cat',
]);
const GIT_ENVIRONMENT = Object.freeze({
  HOME: '/nonexistent', XDG_CONFIG_HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0',
});
const LIMITS = Object.freeze({ maxStatusBytes: 32 * 1024 * 1024, deadlineMs: 30_000 });
const fail = (code, message, cause) => Object.assign(
  new Error(`tracked source freshness: ${message}`, cause ? { cause } : undefined), { code },
);

const resolveLimits = (input = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !Object.hasOwn(LIMITS, key))) {
    throw fail('SOURCE_FRESHNESS_MISMATCH', 'limits are invalid');
  }
  const values = {};
  for (const [key, ceiling] of Object.entries(LIMITS)) {
    const value = input[key] ?? ceiling;
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
      throw fail('SOURCE_FRESHNESS_MISMATCH', `${key} exceeds its fixed envelope`);
    }
    values[key] = value;
  }
  return Object.freeze(values);
};

const controlsFor = (externalSignal, deadline, deadlineMs) => {
  if (externalSignal != null && (typeof externalSignal !== 'object'
    || typeof externalSignal.addEventListener !== 'function' || !('aborted' in externalSignal))) {
    throw fail('SOURCE_FRESHNESS_MISMATCH', 'abort signal is invalid');
  }
  if (deadline != null && (!Number.isSafeInteger(deadline) || deadline < 0)) {
    throw fail('SOURCE_FRESHNESS_MISMATCH', 'absolute deadline is invalid');
  }
  const remainingMs = deadline == null ? deadlineMs : Math.min(deadlineMs, deadline - Date.now());
  if (remainingMs <= 0) throw fail('SOURCE_FRESHNESS_UNAVAILABLE', 'deadline has elapsed');
  const controller = new AbortController();
  const absoluteDeadline = Date.now() + remainingMs;
  const abort = () => controller.abort(fail('SOURCE_FRESHNESS_UNAVAILABLE', 'operation was aborted'));
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(
    fail('SOURCE_FRESHNESS_UNAVAILABLE', 'operation exceeded its deadline'),
  ), remainingMs);
  timer.unref?.();
  const check = () => {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (Date.now() >= absoluteDeadline) {
      throw fail('SOURCE_FRESHNESS_UNAVAILABLE', 'operation exceeded its deadline');
    }
  };
  return Object.freeze({
    signal: controller.signal,
    deadline: absoluteDeadline,
    check,
    close: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', abort);
    },
  });
};

const git = (root, args, controls, maxBuffer) => new Promise((resolve, reject) => {
  execFile(GIT, [...GIT_OPTIONS, ...args], {
    cwd: root,
    env: GIT_ENVIRONMENT,
    encoding: null,
    maxBuffer,
    signal: controls.signal,
    windowsHide: true,
  }, (error, stdout, stderr) => {
    if (controls.signal.aborted) return reject(controls.signal.reason);
    if (error) return reject(fail('SOURCE_FRESHNESS_UNAVAILABLE', 'trusted Git query failed', error));
    if (stderr?.length) return reject(fail('SOURCE_FRESHNESS_UNAVAILABLE', 'trusted Git query produced diagnostics'));
    return resolve(Buffer.from(stdout));
  });
});

const line = (bytes, label) => {
  const value = bytes.toString('utf8').trim();
  if (!OID.test(value) || value.includes('\n') || value.includes('\r')) {
    throw fail('SOURCE_FRESHNESS_MISMATCH', `${label} identity is invalid`);
  }
  return value;
};

/** The verified checkout root: realpath-stable, a directory, the repo's top level. */
const verifiedCheckoutRoot = async (sourceRoot, controls) => {
  const requestedRoot = path.resolve(sourceRoot);
  const root = await fs.realpath(requestedRoot).catch((error) => {
    throw fail('SOURCE_FRESHNESS_UNAVAILABLE', 'trusted repository is unavailable', error);
  });
  if (root !== requestedRoot || !(await fs.stat(root)).isDirectory()) {
    throw fail('SOURCE_FRESHNESS_MISMATCH', 'trusted repository root is indirect');
  }
  const [gitReal, gitStat] = await Promise.all([fs.realpath(GIT), fs.stat(GIT)]);
  if (gitReal !== GIT || !gitStat.isFile() || gitStat.uid !== 0
    || (gitStat.mode & 0o022) !== 0 || (gitStat.mode & 0o111) === 0) {
    throw fail('SOURCE_FRESHNESS_UNAVAILABLE', 'trusted Git executable is unavailable');
  }
  controls.check();
  const top = (await git(root, ['rev-parse', '--show-toplevel'], controls, 4096))
    .toString('utf8').trim();
  if (path.resolve(top) !== root) {
    throw fail('SOURCE_FRESHNESS_MISMATCH', 'configured source root is not the repository root');
  }
  return root;
};

/** HEAD commit + root tree, one read. */
const readIdentityOnce = async (root, controls) => {
  const commit = line(
    await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'], controls, 256),
    'source HEAD',
  );
  const tree = line(
    await git(root, ['rev-parse', '--verify', `${commit}^{tree}`], controls, 256),
    'root tree',
  );
  return { commit, tree };
};

/**
 * Offline caller-selected checkout verifier: resolves the checkout's
 * COMMIT-PINNED source identity (HEAD commit + root tree, read twice against
 * mid-read movement). Every consumer read goes to the commit object store, so
 * a dirty working tree changes nothing about what is boarded — and it never
 * blocks a boot: Founder's law 2026-08-16 — refinement's cleanliness law governs
 * DATASETS, not the repository workspace; the git tree is not a gate. Its data
 * is explicitly untrusted; only refinement-source-authority may turn a fixed
 * server-root observation into production authority.
 */
export const resolveCleanTrackedSource = async ({
  sourceRoot,
  declaredCommit = null,
  signal = null,
  deadline = null,
  limits: limitInput = {},
}) => {
  const limits = resolveLimits(limitInput);
  if ((declaredCommit !== null && !OID.test(String(declaredCommit)))
    || typeof sourceRoot !== 'string' || !sourceRoot) {
    throw fail('SOURCE_FRESHNESS_MISMATCH', 'request is invalid');
  }
  const controls = controlsFor(signal, deadline, limits.deadlineMs);
  try {
    const root = await verifiedCheckoutRoot(sourceRoot, controls);
    const first = await readIdentityOnce(root, controls);
    if (declaredCommit !== null && first.commit !== declaredCommit) {
      throw fail('SOURCE_FRESHNESS_UNAVAILABLE', 'declared source commit is not current HEAD');
    }
    const repeated = await readIdentityOnce(root, controls);
    controls.check();
    if (repeated.commit !== first.commit || repeated.tree !== first.tree) {
      throw fail('SOURCE_FRESHNESS_UNAVAILABLE', 'source identity changed during verification');
    }
    return Object.freeze({ sourceCommit: first.commit, rootTreeId: first.tree });
  } finally {
    controls.close();
  }
};
