/**
 * ComfyUI supervisor — NEUMA owns the image-forge engine process.
 *
 * The HEARTH of THE IMAGE FORGE (B-1..B-4): spawns the pinned ComfyUI as a
 * managed child on the frozen launch line, probes it to READY, adopts a
 * healthy orphan only after verifying its argv is safe, and returns VRAM on
 * idle through a two-tier reap. Exactly one supervised engine per backend;
 * its state is observable for honest status (the FR-37 workbench card and
 * the Settings section both read it, never guess).
 *
 * Pure launch planning (resolveComfyConfig, buildComfyArgs, argvViolations,
 * decideReapAction — extracted to comfyui-config.js) is separated from the
 * exec boundary (RULE 0): planning is provable by direct unit test;
 * spawn/stop/probe wrappers are `// impure` and proven by integration against
 * the real pinned engine. The planning symbols stay re-exported here so every
 * standing importer keeps its door.
 *
 * Laws carried from the spike (run comfyui-image-lane-2mw2, GATE-1):
 * - loopback ONLY — ComfyUI has no auth flag; the bind is the whole gate.
 *   Bare `--listen` means 0.0.0.0 and is refused anywhere in any argv.
 * - `--disable-all-custom-nodes` always; a whitelist flag in argv is refused
 *   until FR-35's operator-whitelist lane ships (and then only operator-set).
 * - no /health, no /shutdown at the pin — `GET /prompt` is the probe.
 * - an ADOPTED engine is never signalled: /free forever, honest status.
 */
import { spawn } from 'child_process';
import { existsSync, mkdirSync, openSync, closeSync, statSync } from 'fs';
import path from 'path';
import { createLogger } from '../logger.js';
import { helperEnvironment } from '../agent-terminal-environment.js';
import { argvViolations, buildComfyArgs, decideReapAction, resolveComfyConfig } from './comfyui-config.js';
import { comfyHeadroomGb, engineRamCeilingGb } from './forge-capacity.js';
import { boxedLaunch, memoryScopeAvailable } from './engine-memory-scope.js';
import { probeMachine } from '../machine-probe.js';
import { withStoredHfToken } from '../stored-secrets.js';

export { argvViolations, buildComfyArgs, decideReapAction, resolveComfyConfig };

const log = createLogger('ImageForge.Supervisor');

const PROBE_TIMEOUT_MS = 2000;
// HTTP answers before any model loads (spike item 3 measured seconds, not
// minutes) — but a cold first launch compiles CUDA kernels; stay generous.
const DEFAULT_START_WAIT_MS = 90_000;
const START_POLL_MS = 1000;
const STOP_GRACE_MS = 8000;
const REAP_INTERVAL_MS = 60_000;
const LOG_CAP_BYTES = 10 * 1024 * 1024;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// What the engine and its torch stack read (GPU selection, CUDA/ROCm
// runtime, model caches, thread pools, ComfyUI's own settings), plus the user
// bus `systemd-run --user --scope` needs to box it. Nothing else: the engine
// runs custom workflows, so it never holds the backend's secrets.
const COMFY_RUNTIME_KEY = /^(CUDA_|NVIDIA_|HIP_|ROCR_|HSA_|HF_|HUGGINGFACE_|PYTORCH_|TORCH_|TRITON_|OMP_|MKL_|COMFY|LD_LIBRARY_PATH$|DBUS_SESSION_BUS_ADDRESS$)/;

/**
 * The environment the ComfyUI engine starts with. Pure; the input is never mutated.
 * @param {Record<string, string|undefined>} env
 * @param {string} [platform]
 * @returns {Record<string, string>}
 */
export const comfyEngineEnvironment = (env, platform = process.platform) =>
  helperEnvironment(env, platform, (key) => COMFY_RUNTIME_KEY.test(key));

// impure — is the engine answering on the port right now? No /health exists
// at the pin; GET /prompt returning exec_info is the readiness contract.
export const isComfyServing = async (cfg) => {
  try {
    const res = await fetch(`http://${cfg.host}:${cfg.port}/prompt`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return Boolean(body?.exec_info);
  } catch {
    return false;
  }
};

// impure — what stands between this machine and a launchable engine.
export const comfyInstallState = (cfg) => {
  if (!cfg.installDir) return { installed: false, reason: 'COMFYUI_INSTALL_DIR is empty — the lane is absent until installed' };
  if (!existsSync(cfg.mainPy)) return { installed: false, reason: `no main.py at ${cfg.installDir}` };
  if (!existsSync(cfg.python)) return { installed: false, reason: `no venv python at ${cfg.python}` };
  return { installed: true, reason: null };
};

// Single-flight managed engine. `inst` is non-null while we track a running
// engine — proc-bearing when WE spawned it, proc-less when adopted.
let inst = null; // { state, proc, pid, port, adopted, startedAt, readySince, lastActivityAt, lastFreeAt, logPath }
let lastError = null; // { error, at }
let stopping = false; // a deliberate stop is not a failure, whatever the exit code
let bootPromise = null;
let reaperTimer = null;
let reaperCfg = null;

// impure — the job lane (B-6, P2 THE WIRE) stamps activity here on every
// enqueue/completion so the idle clock is honest. Contract awaiting its
// client: until B-6 lands, reapPass's queue-busy stamp is the only writer.
export const noteComfyActivity = () => {
  if (inst) inst.lastActivityAt = Date.now();
};

// impure — GET /system_stats: the adoption identity source (argv + version).
const comfySystemStats = async (cfg) => {
  const res = await fetch(`http://${cfg.host}:${cfg.port}/system_stats`, {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`/system_stats answered ${res.status}`);
  return res.json();
};

// impure — adopt a healthy engine we did not spawn, identity-checked first.
// Refusal is loud and named: the port is held by an instance whose flags we
// cannot vouch for, so the lane cannot use it AND cannot launch beside it.
const adoptComfy = async (cfg) => {
  const refuse = (message) => {
    lastError = { error: message, at: new Date().toISOString() };
    throw new Error(message);
  };
  let stats;
  try {
    stats = await comfySystemStats(cfg);
  } catch (err) {
    refuse(`adoption refused: identity unreadable (${err.message})`);
  }
  const argv = stats?.system?.argv;
  const violations = argvViolations(Array.isArray(argv) ? argv : [], { requireOutputDir: cfg.outputDir });
  if (!Array.isArray(argv)) violations.unshift('/system_stats carried no argv — identity unverifiable');
  if (violations.length > 0) {
    refuse(`adoption refused — unsafe argv on port ${cfg.port}: ${violations.join('; ')}`);
  }
  inst = {
    state: 'ready', proc: null, pid: null, port: cfg.port, adopted: true,
    startedAt: Date.now(), readySince: Date.now(), lastActivityAt: null, lastFreeAt: null,
    logPath: null,
  };
  lastError = null;
  log.info('adopted already-running ComfyUI', { port: cfg.port, version: stats?.system?.comfyui_version });
  armReaper(cfg);
  return comfySupervisorStatus(cfg);
};

// impure — the single boot body: compose, refuse-or-spawn, poll to READY.
// Only ever runs under the bootPromise single-flight.
const bootToReady = async (cfg, waitMs) => {
  const install = comfyInstallState(cfg);
  if (!install.installed) {
    lastError = { error: `ComfyUI is not installed — ${install.reason}`, at: new Date().toISOString() };
    throw new Error(lastError.error);
  }
  // The engine NEVER launches unbounded: unset, it took every free byte of the
  // card. The operator's explicit envelope still wins.
  const machine = await probeMachine();
  const headroomGb = cfg.headroomGb || String(comfyHeadroomGb(machine));
  const args = buildComfyArgs({ ...cfg, headroomGb });
  // ...and never bigger than the machine can spare in RAM, where the OS can
  // enforce it: a job that does not fit stops the engine, not the desktop.
  const ramCeilingGb = memoryScopeAvailable() ? engineRamCeilingGb(machine) : null;
  const violations = argvViolations(args);
  if (violations.length > 0) {
    lastError = { error: `launch refused by composed-argv law: ${violations.join('; ')}`, at: new Date().toISOString() };
    throw new Error(lastError.error);
  }

  for (const dir of [cfg.outputDir, cfg.tempDir, cfg.userDir, cfg.logDir]) mkdirSync(dir, { recursive: true });
  // Engine output goes to a size-capped FILE, never a pipe to this process
  // (EPIPE law): a dev-watch backend restart orphans the engine, and an
  // orphan holding a dead parent's pipe dies the next time it prints.
  const logPath = path.join(cfg.logDir, `comfyui-${cfg.port}.log`);
  let oversized = false;
  try { oversized = statSync(logPath).size > LOG_CAP_BYTES; } catch { /* no log yet */ }
  const logFd = openSync(logPath, oversized ? 'w' : 'a');
  const launch = boxedLaunch(cfg.python, args, ramCeilingGb);
  const proc = spawn(launch.cmd, launch.args, {
    cwd: cfg.installDir,
    env: comfyEngineEnvironment(withStoredHfToken(process.env)),
    stdio: ['ignore', logFd, logFd],
  });
  closeSync(logFd); // the child holds its own descriptor

  inst = {
    state: 'launching', proc, pid: proc.pid, port: cfg.port, adopted: false,
    startedAt: Date.now(), readySince: null, lastActivityAt: null, lastFreeAt: null, logPath, headroomGb, ramCeilingGb,
  };
  log.info('ComfyUI spawned', { pid: proc.pid, port: cfg.port, installDir: cfg.installDir, headroomGb, ramCeilingGb });

  proc.on('exit', (code, signal) => {
    if (inst?.proc !== proc) return;
    const boxed = signal === 'SIGKILL' && inst.ramCeilingGb && !stopping;
    if (boxed) lastError = { error: `ComfyUI was stopped at its ${inst.ramCeilingGb} GB memory ceiling — the job needs more system memory than this machine can spare; the rest of the machine was kept safe`, at: new Date().toISOString() };
    else if (code && !stopping) lastError = { error: `ComfyUI exited (code ${code}, signal ${signal}) — tail ${logPath}`, at: new Date().toISOString() };
    inst = null;
  });
  // A spawn error (ENOENT etc.) fires 'error', not 'exit'.
  proc.on('error', (err) => {
    if (inst?.proc !== proc) return;
    lastError = { error: err.message, at: new Date().toISOString() };
    inst = null;
  });

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!inst) throw new Error(lastError?.error || 'ComfyUI exited before becoming ready');
    if (await isComfyServing(cfg)) {
      inst.state = 'ready';
      inst.readySince = Date.now();
      lastError = null;
      log.info('ComfyUI ready', { pid: proc.pid, port: cfg.port });
      armReaper(cfg);
      return comfySupervisorStatus(cfg);
    }
    await delay(START_POLL_MS);
  }
  // Timed out: reclaim the half-booted process so a retry starts clean.
  if (inst?.proc === proc) { proc.kill('SIGKILL'); inst = null; }
  lastError = { error: `ComfyUI did not answer GET /prompt within ${Math.round(waitMs / 1000)}s — tail ${logPath}`, at: new Date().toISOString() };
  throw new Error(lastError.error);
};

/**
 * Resolve when the engine is READY — the one lane every caller rides
 * (workbench OPEN, being-tools, routes). Fast no-op when serving; adopts a
 * healthy stranger identity-checked; launches lazily otherwise. Racing
 * callers JOIN the in-flight boot (single-flight). Impure.
 * @param {ReturnType<typeof resolveComfyConfig>} cfg
 * @param {{waitMs?: number}} [opts]
 */
export const ensureComfyReady = async (cfg, { waitMs = DEFAULT_START_WAIT_MS } = {}) => {
  if (bootPromise) return bootPromise;
  // Probe-first inside the single-flight so check-then-spawn cannot race.
  bootPromise = (async () => {
    const serving = await isComfyServing(cfg);
    if (serving && inst?.state === 'ready') return comfySupervisorStatus(cfg);
    if (serving) return adoptComfy(cfg); // orphan (ours-from-a-past-life or the operator's)
    if (inst?.state === 'ready') inst = null; // tracked but dead — relaunch honestly
    return bootToReady(cfg, waitMs);
  })().finally(() => { bootPromise = null; });
  return bootPromise;
};

/**
 * Stop the engine. Owned: SIGTERM (upstream exits cleanly) → SIGKILL after a
 * grace window. Adopted: MARK ONLY — the process is not ours to signal; the
 * honest status says so and /free remains its only VRAM lever. Impure.
 */
export const stopComfy = async () => {
  if (!inst) return { status: 'not-running' };
  if (inst.adopted) {
    inst = null;
    log.info('adopted ComfyUI released — not ours to stop');
    return { status: 'released', detail: 'adopted engine released from supervision — the process is not ours to stop; models were freeable via /free only' };
  }
  const { proc } = inst;
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  stopping = true;
  try {
    proc.kill('SIGTERM');
    const clean = await Promise.race([exited.then(() => true), delay(STOP_GRACE_MS).then(() => false)]);
    if (!clean) {
      log.warn('ComfyUI did not exit on SIGTERM — sending SIGKILL', { pid: proc.pid });
      proc.kill('SIGKILL');
      await exited;
    }
  } finally {
    stopping = false;
  }
  inst = null;
  log.info('ComfyUI stopped', { pid: proc.pid });
  return { status: 'stopped' };
};

/**
 * Tier-1 VRAM return: ask the engine to drop loaded models. Returns 200
 * immediately (flags consumed by the worker); the spike measured the real
 * reclaim at 7450→826 MiB in ~3s. Impure.
 * @param {ReturnType<typeof resolveComfyConfig>} cfg
 */
export const freeComfy = async (cfg) => {
  const res = await fetch(`http://${cfg.host}:${cfg.port}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
    signal: AbortSignal.timeout(5000),
  });
  if (res.ok && inst) inst.lastFreeAt = Date.now();
  return { ok: res.ok };
};

// impure — /queue probe: running/pending must BOTH be empty before any reap
// tier fires (the sole-client assumption made a checked precondition — the
// operator may be mid-render at the workbench).
const probeQueueBusy = async (cfg) => {
  const res = await fetch(`http://${cfg.host}:${cfg.port}/queue`, {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`/queue answered ${res.status}`);
  const q = await res.json();
  return (q?.queue_running?.length ?? 0) > 0 || (q?.queue_pending?.length ?? 0) > 0;
};

/**
 * One reap pass. Probes /queue, then acts on the pure decision. A busy queue
 * is a life sign (stamps the idle clock — the workbench's jobs count). An
 * unreachable /queue skips the pass: never reap on an unknown queue state.
 * Impure. Exported for the integration proof; the armed timer calls it.
 * @param {ReturnType<typeof resolveComfyConfig>} cfg
 * @returns {Promise<'none'|'free'|'stop'>}
 */
export const reapPass = async (cfg) => {
  if (!inst || inst.state !== 'ready') return 'none';
  let queueBusy;
  try {
    queueBusy = await probeQueueBusy(cfg);
  } catch (err) {
    log.warn('reap pass skipped — queue state unknown', { err: err.message });
    return 'none';
  }
  if (queueBusy) inst.lastActivityAt = Date.now();
  const action = decideReapAction({
    state: inst.state, adopted: inst.adopted, queueBusy, now: Date.now(),
    readySince: inst.readySince, lastActivityAt: inst.lastActivityAt, lastFreeAt: inst.lastFreeAt,
    idleTtlMs: cfg.idleTtlMs, reapTtlMs: cfg.reapTtlMs,
  });
  if (action === 'free') {
    log.info('idle tier-1: freeing engine models', { port: cfg.port });
    await freeComfy(cfg).catch((err) => log.warn('idle /free failed', { err: err.message }));
  } else if (action === 'stop') {
    log.info('idle tier-2: stopping owned engine — VRAM returned', { port: cfg.port });
    await stopComfy();
  }
  return action;
};

// impure — start the periodic reap once the engine is READY. unref'd so it
// never holds the process open; cleared on shutdown.
const armReaper = (cfg) => {
  reaperCfg = cfg;
  if (reaperTimer || !(cfg.idleTtlMs > 0 || cfg.reapTtlMs > 0)) return;
  reaperTimer = setInterval(() => {
    if (reaperCfg) reapPass(reaperCfg).catch((err) => log.warn('reap pass failed', { err: err.message }));
  }, REAP_INTERVAL_MS);
  reaperTimer.unref();
};

/**
 * Observable supervisor state for the desk (FR-37 card + Settings). Impure
 * (live probe). `state` is the machine's word: stopped|launching|ready; a
 * launch failure lives in `lastError` (the card derives `failed` from
 * state:stopped + lastError, keeping the primitive truthful). `foreign` =
 * something answers the port but we neither own nor adopted it yet.
 * @param {ReturnType<typeof resolveComfyConfig>} cfg
 */
export const comfySupervisorStatus = async (cfg) => {
  const serving = await isComfyServing(cfg);
  return {
    state: inst?.state ?? (bootPromise ? 'launching' : 'stopped'),
    serving,
    owned: Boolean(inst && !inst.adopted),
    adopted: Boolean(inst?.adopted),
    foreign: serving && !inst,
    port: cfg.port,
    pid: inst?.pid ?? null,
    startedAt: inst?.startedAt ?? null,
    readySince: inst?.readySince ?? null,
    logPath: inst?.logPath ?? null,
    // The VRAM ceiling the engine launched under; null for an adopted engine
    // (a stranger's launch line is judged for safety, not re-capped).
    vramHeadroomGb: inst?.headroomGb ?? null,
    ramCeilingGb: inst?.ramCeilingGb ?? null,
    install: comfyInstallState(cfg),
    lastError,
  };
};

/**
 * Backend shutdown: clear the reaper and stop an OWNED engine so a clean
 * exit leaves no supervised process behind. Adopted engines are left alone
 * (not ours). Impure.
 */
export const comfyShutdown = async () => {
  if (reaperTimer) { clearInterval(reaperTimer); reaperTimer = null; }
  if (inst && !inst.adopted) await stopComfy();
  else inst = null;
};
