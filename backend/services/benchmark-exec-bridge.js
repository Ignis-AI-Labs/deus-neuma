/**
 * THE BENCHMARK EXEC BRIDGE (ARC-HARNESS #531, 2026-09-20) — declared-only
 * routing that puts a seated being's acts inside the LIVE task container
 * instead of a host photocopy of /app.
 *
 * THE FAILING SHAPE THIS CURES (rem2 series, receipted in benchmarks
 * runs/night-20260919t*): the tbench seat extracted /app to a host ground and
 * ran every tool there, so `coding/execute` could not run the task's own
 * /tests (container-side), installs never traveled (scipy host-side, grading
 * container-side), and the graded container never saw a service the being
 * started. Nine of 24 rem2 trials died of exactly this blindness.
 *
 * THE THREE ROUTES, benchmark mode only:
 * 1. coding/execute AND coding/inspect → `docker exec <id>` in the container's
 *    workdir (the network-consent seam still runs). Inspect joined 2026-10-07:
 *    a being that probed the graded container's state host-side read a stale
 *    photocopy (qemu-alpine-ssh, rem2) while the reference agent typed in the
 *    container itself.
 * 2. fs/write | fs/edit under the ground → applied host-side through the
 *    UNCHANGED sandbox/policy/journal path, then mirrored into the container
 *    (docker cp) so the graded filesystem sees the act.
 * 3. fs/list of the ground root → appends what the container's /tests holds,
 *    so the being can verify before it declares done (L2's feeder).
 *
 * KNOWN LIMIT, stated honestly: reads stay host-side, so container-side
 * mutations between executes are not re-fetched; an execute (`cat`) reaches
 * live state when that matters. WRITE mirroring is one-way host→container —
 * an in-container change to a file the being then edits host-side gets
 * clobbered; the edit is judged against the host copy it can actually see.
 *
 * LAW: every call still crosses the ordinary policy seam, gate, and receipt
 * journals — this module only chooses WHERE an approved act lands. Engagement
 * is declared (`--benchmark-exec-bridge docker` + NEUMA_TBENCH_CONTAINER_ID on
 * the seated run); ordinary seats, including the desk, never enter here.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { createCommandOutput } from './coding-command-output.js';
import { collectPathArgs } from './sandbox-path-policy.js';
import { runWitnessCommand } from './witness-coding-sandbox.js';
import { createLogger } from './logger.js';

const log = createLogger('BenchmarkExecBridge');

const MIN_COMMAND_CHARS = 1;
const MAX_COMMAND_CHARS = 4000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;
const CONTAINER_TEST_PATH = '/tests/run-tests.sh';
const TESTS_NOTE = `[benchmark bridge] this task's container carries ${CONTAINER_TEST_PATH} — `
  + 'verify your work by running it through coding/execute before declaring the task done.';
const MIRROR_NOTE = '[benchmark bridge] mirrored into the container:';

const clampTimeout = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, n));
};

const CONTAINER_CLIS = Object.freeze(new Set(['docker', 'podman']));

/** The engaged bridge for this seat, or null. Pure over the connection. */
export const benchmarkBridgeConfig = (connection) => {
  const bridge = connection?._benchmarkExecBridge;
  if (bridge === null || bridge === undefined) return null;
  const { cli, containerId, workdir, ground } = bridge;
  if (!CONTAINER_CLIS.has(cli) || typeof containerId !== 'string' || containerId.length > 256
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(containerId)
    || typeof workdir !== 'string' || !workdir.startsWith('/')
    || typeof ground !== 'string' || !path.isAbsolute(ground)) {
    throw new Error('benchmark exec bridge configuration is invalid');
  }
  return Object.freeze({ cli, containerId, workdir, ground });
};

/** Does this seat run with the bridge engaged? Pure. */
export const benchmarkBridgeEngaged = (connection) => benchmarkBridgeConfig(connection) !== null;

/**
 * The container path a host path mirrors to, or null when the path escapes
 * the ground (lane files, workspace internals — never mirrored). Pure.
 */
export const containerPathFor = (config, hostPath) => {
  if (typeof hostPath !== 'string' || hostPath === '') return null;
  const abs = path.resolve(hostPath);
  const rel = path.relative(config.ground, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return `${config.workdir.replace(/\/$/, '')}/${rel.split(path.sep).join('/')}`;
};

const commandValidation = (command) => {
  if (typeof command !== 'string' || command.trim().length < MIN_COMMAND_CHARS
    || command.length > MAX_COMMAND_CHARS || /[\0\r]/.test(command)) {
    throw new Error('Command must be 1-4000 characters without NUL or carriage returns');
  }
};

/**
 * Execute one command in the container. Result shape matches
 * runWitnessCommand's ({exitCode, stdout, stderr, timedOut, truncated}) so
 * the caller's rendering, events, and receipt cannot tell the lanes apart.
 * impure — spawns the container CLI; DOCKER_HOST and the podman shim resolve
 * through PATH exactly like the rest of the tbench stack.
 */
export const runBridgedCommand = ({ config, command, timeoutMs, signal, onChunk }) => {
  commandValidation(command);
  const clamped = clampTimeout(timeoutMs);
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(config.cli, [
      'exec', '-w', config.workdir, config.containerId, '/bin/sh', '-lc', command,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const output = createCommandOutput();
    let timedOut = false;
    const collect = (target) => (chunk) => {
      output.append(target, chunk);
      if (typeof onChunk === 'function') onChunk({ stream: target, text: chunk.toString('utf8'), ...output.snapshot() });
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.once('error', reject);
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, clamped);
    const onAbort = () => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) reject(signal.reason ?? new Error('aborted'));
      else resolve({ exitCode, ...output.snapshot(), timedOut });
    });
  });
};

/** Copy one host file into the container. Resolves the cp's exit code. impure. */
const containerCopy = (config, hostPath, containerPath) => new Promise((resolve) => {
  const child = spawn(config.cli, ['cp', hostPath, `${config.containerId}:${containerPath}`],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.once('error', (error) => resolve({ ok: false, error: error.message }));
  child.once('close', (exitCode) => resolve({ ok: exitCode === 0, error: exitCode === 0 ? null : stderr.trim() }));
});

const containerShellOk = async (config, command) =>
  (await runBridgedCommand({ config, command, timeoutMs: 10_000 })).exitCode === 0;

/** Single-quote one value for the container shell. Pure. */
const shellQuote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;

/**
 * Mirror the ground paths a successful fs act touched into the container.
 * The cp destination's parent must exist container-side (podman/docker cp
 * both refuse a missing parent — found by the live test, not assumed), so
 * parents are created first; directories copy their CONTENTS, idempotently.
 * Returns the note lines for the result content (empty when nothing needed
 * mirroring). Never throws past here: the act itself already succeeded, and
 * a mirror failure is surfaced to the being, not swallowed. impure.
 */
export const mirrorGroundPaths = async (config, hostPaths) => {
  const notes = [];
  for (const hostPath of hostPaths) {
    const containerPath = containerPathFor(config, hostPath);
    if (!containerPath) continue;
    // Gone from the ground after a successful act (a delete, a rename's
    // source): gone from the graded container too. The adapter's copy-back
    // used to carry this; a bridged seat has no copy-back (2026-10-07).
    if (!existsSync(hostPath)) {
      const removed = await containerShellOk(config, `rm -rf -- ${shellQuote(containerPath)}`);
      notes.push(removed ? `${MIRROR_NOTE} removed ${containerPath}`
        : `${MIRROR_NOTE} removed ${containerPath} — FAILED (check via coding/execute)`);
      log.info('ground mirror removal', { hostPath, containerPath, ok: removed });
      continue;
    }
    const isDir = statSync(hostPath).isDirectory();
    const source = isDir ? `${hostPath.replace(/\/$/, '')}/.` : hostPath;
    // A write changes a file's CONTENT, never its mode: cp carries the host
    // copy's mode, which would undo a chmod the being made in the container
    // (Terminal-Bench fix-permissions, 2026-10-07: chmod +x, then a rewrite
    // of the same file, and the mirror put 644 back).
    const prior = isDir ? null : await runBridgedCommand({
      config, command: `stat -c %a ${shellQuote(containerPath)} 2>/dev/null`, timeoutMs: 10_000,
    });
    const keptMode = prior?.exitCode === 0 && /^[0-7]{3,4}$/.test(prior.stdout.trim()) ? prior.stdout.trim() : null;
    const made = await containerShellOk(config,
      `mkdir -p ${shellQuote(isDir ? containerPath : containerPath.slice(0, containerPath.lastIndexOf('/')) || '/')}`);
    const outcome = made
      ? await containerCopy(config, source, containerPath)
      : { ok: false, error: 'could not create the destination directory in the container' };
    if (outcome.ok && keptMode) await containerShellOk(config, `chmod ${keptMode} ${shellQuote(containerPath)}`);
    if (outcome.ok) notes.push(`${MIRROR_NOTE} ${containerPath}`);
    else notes.push(`${MIRROR_NOTE} ${containerPath} — FAILED: ${outcome.error} `
      + '(the container may not have this change; retry the write or check via coding/execute)');
    log.info('ground mirror', { hostPath, containerPath, ok: outcome.ok });
  }
  return notes;
};

/**
 * What the container's /tests holds, or null. Cached per connection — one
 * probe per turn, not per listing. impure.
 */
export const probeContainerTests = async (config) => {
  const outcome = await runBridgedCommand({
    config, command: `test -f ${CONTAINER_TEST_PATH} && echo present`, timeoutMs: 10_000,
  });
  return outcome.exitCode === 0 && outcome.stdout.includes('present') ? TESTS_NOTE : null;
};

const appendNotes = (result, notes) => {
  if (notes.length === 0) return result;
  const content = Array.isArray(result?.content) ? result.content : [];
  return { ...result, content: [...content, { type: 'text', text: notes.join('\n') }] };
};

const destinationArgs = (args) => ['destination', 'to', 'target']
  .filter((key) => typeof args?.[key] === 'string' && args[key].length > 0)
  .map((key) => args[key]);

/**
 * Wrap the sandboxed call tool with the bridge's mirror law. With no bridge
 * engaged this is the tool, untouched — every other seat keeps its exact
 * path. A path the act removed from the ground (fs/edit {delete:true}, a
 * rename's source) is removed from the container too.
 * impure — as impure as the callTool it wraps.
 */
export const withBenchmarkGroundMirror = (callTool, connection) => async (serverName, toolName, args = {}) => {
  const result = await callTool(serverName, toolName, args);
  let config;
  try {
    config = benchmarkBridgeConfig(connection);
  } catch (error) {
    log.warn('bridge config invalid — mirroring stood down', { err: error.message });
    return result;
  }
  if (!config || serverName !== 'fs' || result?.isError === true) return result;
  try {
    if (toolName === 'write' || toolName === 'edit') {
      return appendNotes(result, await mirrorGroundPaths(config,
        [...collectPathArgs(args), ...destinationArgs(args)]));
    }
    if (toolName === 'list') {
      const listed = path.resolve(typeof args?.path === 'string' && args.path !== '' ? args.path : '.');
      if (listed !== config.ground) return result;
      connection._benchmarkBridgeTestsNote ??= probeContainerTests(config);
      const note = await connection._benchmarkBridgeTestsNote;
      return note ? appendNotes(result, [note]) : result;
    }
  } catch (error) {
    log.warn('ground mirror failed — the tool result stands', { tool: toolName, err: error.message });
  }
  return result;
};

/**
 * The seat's command runner: on a bridged seat both execute and inspect run in
 * the graded container; ordinary seats run through the host overlay
 * unchanged. Same result shape either way. impure.
 */
export const runSeatCommand = async (input) => {
  const config = benchmarkBridgeConfig(input.connection);
  if (!config) return runWitnessCommand(input);
  const result = await runBridgedCommand({
    config, command: input.command, timeoutMs: input.timeoutMs,
    signal: input.signal, onChunk: input.onChunk,
  });
  return { ...result, mode: input.mode === 'write' ? 'write' : input.mode };
};
