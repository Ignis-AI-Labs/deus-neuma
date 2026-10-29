// Voice Engine Manager — lifecycle for local Python TTS sidecars.
//
// Mirrors the implicit pattern of LM Studio / Ollama: a separate process
// serving an HTTP API. The manager spawns the sidecar on demand, polls
// /health until the model is loaded, and tracks running state. Lazy launch
// by default — saves VRAM for users who don't use voice.
//
// Sidecar lifecycle:
//   stopped → launching (spawn + uv sync) → ready (model loaded)
//                                              ↘ crashed (process exited)
// A multi-profile engine (csm: csm-1b, with memory profiles
// such as full | lean) is READY for one model+profile at a time; asking for
// another relaunches it (serve.modelEnv / serve.profileEnv carry the choice).
// A caller that names neither adopts whatever is serving.
//
// Routes are exposed via voice-engine-routes.js (mounted alongside voice-routes).

import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getEngine, listLocalEngines, getDefaultModel, engineFiles } from './engine-registry.js';
import {
  uvBin, isUvAvailable, engineReadiness, isLoopbackBind, envIdOf, serves, probeHealth,
  shutdownSidecar, spawnEngineProcess, waitForReady, syncEngineVenv, provenOrRetired,
} from './engine-process.js';
import { provenHealth, sidecarFetch } from './sidecar-trust.js';
import { createLogger } from '../logger.js';

// Barrel — the uv/readiness probes and the bind guard moved to engine-process.js
// with the process helpers they serve; routes and tests keep importing them here.
export { uvBin, isUvAvailable, engineReadiness, isLoopbackBind };

const log = createLogger('Voice.EngineManager');

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');

// Per-engine runtime state
const _engines = new Map();

// Idle reaper — a READY sidecar that reports no real activity for
// VOICE_ENGINE_IDLE_TTL_MS shuts down to free its VRAM; the next use
// relaunches it through the existing lazy path. The sidecar's own /health
// idle_seconds is the only trusted signal: adopted sidecars can be shared by
// several backends (dev + Electron), so no single manager's view of "last
// used" is truthful. A sidecar that predates the idle contract reports no
// idle_seconds and is never reaped. TTL ≤ 0 disables reaping entirely.
const IDLE_TTL_MS = Number(process.env.VOICE_ENGINE_IDLE_TTL_MS ?? 600_000);
const REAP_INTERVAL_MS = 60_000;
let _reaperTimer = null;

const STATES = Object.freeze({
  STOPPED: 'stopped',
  SYNCING: 'syncing',     // uv sync running
  LAUNCHING: 'launching', // process spawned, model loading
  READY: 'ready',
  FAILED: 'failed',
  CRASHED: 'crashed',
});

// pure — check that the engine's downloaded weights exist
const engineModelDir = (engineId) => path.join(REPO_ROOT, 'voice-engines', '_models', engineId);

// impure — the loopback endpoint a sidecar binds and answers on. ${ID}_HOST /
// ${ID}_PORT env override the registry default, and spawnEngineProcess already
// passes these same vars DOWN to the child — the override makes the manager's
// own probes/launch agree with the env it hands the sidecar. This is the
// parallel-suite seam: vitest forks share one machine, and whisper's /stream
// lane is single-client by law, so each fork that needs a live sidecar sets
// its own ${ID}_PORT and launches its own process instead of racing on the
// registry port (double-launch EADDRINUSE, slot rejection, one fork's
// stop()/shutdown killing the engine out from under another).
export const resolveServe = (engineId) => {
  const meta = getEngine(engineId);
  if (!meta?.serve) return null;
  const envId = envIdOf(engineId);
  const host = process.env[`${envId}_HOST`] || meta.serve.host;
  const port = Number(process.env[`${envId}_PORT`]) || meta.serve.port;
  return Object.freeze({ ...meta.serve, host, port });
};

/**
 * Get the runtime state of a local engine.
 * @param {string} engineId
 * @returns {Object} state snapshot
 */
export const getStatus = (engineId) => {
  const meta = getEngine(engineId);
  if (!meta || meta.type !== 'local') return null;
  const state = _engines.get(engineId) || {
    state: STATES.STOPPED,
    pid: null,
    port: meta.serve.port,
    host: meta.serve.host,
    startedAt: null,
    lastHealth: null,
  };
  return Object.freeze({ model: null, profile: null, ...state, engineId, downloaded: isDownloaded(engineId, state.model) });
};

/**
 * List runtime state for all local engines.
 */
export const listStatus = () => listLocalEngines().map((e) => getStatus(e.id));

/**
 * Check if an engine's weights are downloaded (for `model` on a multi-model
 * engine — its default when unnamed). Pinned-file engines must have every file
 * at its full size; the downloader verified the sha256 when it landed them.
 */
export const isDownloaded = (engineId, model) => {
  const meta = getEngine(engineId);
  if (!meta) return false;
  if (meta.download?.method === 'files') {
    const root = path.join(REPO_ROOT, 'voice-engines');
    return engineFiles(engineId, model ?? getDefaultModel(engineId)).every((f) => {
      try { return statSync(path.join(root, f.dest)).size === f.bytes; } catch { return false; }
    });
  }
  if (meta.download?.method !== 'huggingface_snapshot') return false;
  const dir = engineModelDir(engineId);
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
    // require multiple files beyond .cache — real weights, not just metadata
    const files = readdirSync(dir).filter((f) => f !== '.cache');
    return files.length > 1;
  } catch {
    return false;
  }
};

// Per-engine in-flight launches — concurrent first-use requests on any
// surface (forge preview, dictation, chat synthesis) share one launch
// instead of racing launch(), which throws on a second attempt in flight.
const _inflightLaunches = new Map();

// impure — record a live, proc-less sidecar as READY and arm its reaper. The
// single adoption path shared by ensureReady (probe-first) and launch (orphan
// already on the port). proc:null is deliberate: we did not spawn it, so a
// later stop() can only mark it, never signal a process we don't own. Only a
// sidecar that proves the install key is adopted (sidecar-trust.js, M-06).
const _adoptSidecar = async (engineId, host, port, health) => {
  if (!(await provenOrRetired(host, port))) return false;
  const { model = null, profile = null } = health ?? {};
  _engines.set(engineId, {
    state: STATES.READY, host, port, pid: null, proc: null, model, profile,
    adopted: true, startedAt: Date.now(), readySince: Date.now(),
  });
  log.info('adopted already-running sidecar', { engineId, port, model });
  _armReaper();
  return true;
};

// impure — retire a sidecar serving the wrong model so the right one can bind
// its port: /shutdown first (works on adopted sidecars too), a signal only for
// a process this manager spawned and that ignored the request.
const _retire = async (engineId, host, port) => {
  log.info('relaunching sidecar for another model', { engineId, port });
  const silent = await shutdownSidecar(host, port);
  if (!silent && _engines.get(engineId)?.proc) stop(engineId);
  _engines.set(engineId, { ..._engines.get(engineId), state: STATES.STOPPED, pid: null, proc: null });
};

// The first-ever launch of an engine may also run `uv sync` (a clean machine
// downloads torch) before its readyTimeoutMs clock starts; ensureReady's own
// deadline leaves room for both.
const SYNC_ALLOWANCE_MS = 30_000;

/**
 * Resolve when a local engine is READY, launching it lazily if needed.
 * Mirrors the proven whisper dictation pattern (stt-routes), generalized
 * per engine. A launch failure propagates to every waiter.
 *
 * Orphan adoption: a dev-watch backend restart drops this manager's map but
 * not the sidecars it spawned — the port stays held by a perfectly healthy
 * engine the new process doesn't know it owns. Spawning into that port just
 * crashes the launch, so an untracked engine's port is probed first: a
 * healthy sidecar is adopted as READY (proc-less — a later stop() can only
 * mark it, not kill it), one still loading/compiling is waited on, one whose
 * load FAILED surfaces its error, one serving another model is retired and
 * relaunched, and only a silent port gets a fresh launch.
 * @param {string} engineId - local engine id (zonos|kokoro|whisper|csm|…)
 * @param {number|{model?: string, profile?: string, timeoutMs?: number}} [opts] - a bare number is timeoutMs
 */
export const ensureReady = async (engineId, opts = {}) => {
  const meta = getEngine(engineId);
  if (!meta || meta.type !== 'local') throw new Error(`'${engineId}' is not a local engine`);
  const { model = null, profile = null, timeoutMs } = typeof opts === 'number' ? { timeoutMs: opts } : opts;
  const want = { model, profile };
  const { host, port } = resolveServe(engineId);
  const waitMs = timeoutMs ?? (meta.serve.readyTimeoutMs ?? 120_000) + SYNC_ALLOWANCE_MS;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const cur = _engines.get(engineId);
    if (cur?.state === STATES.READY) {
      if (serves(want, cur)) return;
      await _retire(engineId, cur.host, cur.port);
      continue;
    }
    if (cur?.state === STATES.SYNCING || cur?.state === STATES.LAUNCHING) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const { verdict, health } = await probeHealth(host, port);
    if (verdict === 'ready' && serves(want, health)) {
      if (await _adoptSidecar(engineId, host, port, health)) return;
      continue;
    }
    if (verdict === 'ready') {
      await _retire(engineId, host, port);
      continue;
    }
    if (verdict === 'failed') throw new Error(`${engineId} failed to load: ${health?.error || 'unknown error'}`);
    if (verdict === 'starting') {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    // port silent — this caller takes the launch itself
    if (!_inflightLaunches.has(engineId)) {
      _inflightLaunches.set(
        engineId,
        launch(engineId, want).finally(() => _inflightLaunches.delete(engineId)),
      );
    }
    await _inflightLaunches.get(engineId);
    const after = _engines.get(engineId);
    if (after?.state === STATES.READY && serves(want, after)) return;
  }
  throw new Error(`${engineId} not ready after ${waitMs}ms`);
};

/**
 * Launch a local engine sidecar. Idempotent: if already ready (for this
 * model), no-op. If stopped/failed, spawns fresh. Returns once /health
 * reports ok=true.
 *
 * @param {string} engineId
 * @param {Object} [options]
 * @param {string} [options.model] - multi-model engines (csm); default: the manifest's defaultModel
 * @param {string} [options.profile] - memory profile of that model (csm-1b: full | lean); default: its defaultProfile
 * @param {number} [options.timeoutMs] - max wait for the model to load (default serve.readyTimeoutMs, else 120000)
 * @param {boolean} [options.skipSync=false] - skip uv sync (assume deps present)
 * @returns {Promise<Object>} final state
 */
export const launch = async (engineId, options = {}) => {
  const meta = getEngine(engineId);
  if (!meta || meta.type !== 'local') {
    throw new Error(`'${engineId}' is not a local engine`);
  }
  const want = { model: options.model ?? null, profile: options.profile ?? null };
  const model = want.model ?? getDefaultModel(engineId);
  if (model && !Object.hasOwn(meta.models ?? {}, model)) throw new Error(`${engineId} has no model '${model}'`);
  const profile = want.profile ?? meta.models?.[model]?.defaultProfile ?? null;
  if (profile && !Object.hasOwn(meta.models[model].profiles ?? {}, profile)) {
    throw new Error(`${engineId} ${model} has no profile '${profile}'`);
  }

  const { host, port } = resolveServe(engineId);
  // /synthesize, /speak (and kyutai's /mint) are gated by the install key's token
  // (sidecar-trust.js) and the loopback bind together. Refuse to spawn a sidecar onto
  // a non-loopback host: a LAN-exposed /mint is a voice-cloning service one leak away.
  // The sidecar refuses such a bind too (exit 2); failing here names the
  // cause before any process or GPU memory is spent on it.
  if (!isLoopbackBind(host)) {
    throw new Error(
      `${engineId} refuses non-loopback bind '${host}' — sidecar routes are unauthenticated; a LAN bind is an open voice-cloning service`,
    );
  }
  const endpoint = `http://${host}:${port}`;

  const existing = _engines.get(engineId);
  if (existing?.state === STATES.READY && serves(want, existing)) return getStatus(engineId);
  if (existing?.state === STATES.LAUNCHING || existing?.state === STATES.SYNCING) {
    throw new Error(`${engineId} is already ${existing.state}`);
  }

  // A healthy sidecar may already hold this port — an orphan from a dev-watch
  // restart, or one another backend on this machine spawned. Spawning a second
  // process onto the bound port only crashes on EADDRINUSE (after needlessly
  // loading the model onto the GPU first), and because the orphan answers
  // /health, waitForReady would wrongly declare that doomed process "ready".
  // Probe and adopt the live sidecar instead — proc-less, so a later stop()
  // marks it rather than signalling a process we don't own. This is the same
  // adoption ensureReady() does; doing it here too closes the gap for callers
  // that reach launch() directly (stt dictation, the engine-lifecycle route).
  // Checked before the weights gate: a sidecar already serving is proof enough
  // it can serve, regardless of what is on local disk. One serving ANOTHER
  // model is retired first, for the same EADDRINUSE reason.
  const { verdict, health } = await probeHealth(host, port);
  const adopted = verdict === 'ready' && serves(want, health) && await _adoptSidecar(engineId, host, port, health);
  if (adopted) return getStatus(engineId);
  if (verdict === 'ready' && !serves(want, health)) await _retire(engineId, host, port);

  if (!isDownloaded(engineId, model)) {
    throw new Error(`${engineId}${model ? ` (${model})` : ''} weights not downloaded — run: uv run voice-engines/_downloader/download.py ${engineId}${model ? ` --model ${model}` : ''}`);
  }

  try {
    if (!options.skipSync) {
      _engines.set(engineId, { ...existing, state: STATES.SYNCING, startedAt: Date.now() });
      log.info('syncing venv', { engineId });
      await syncEngineVenv(engineId, meta.serve.startModule);
    }

    _engines.set(engineId, {
      state: STATES.LAUNCHING,
      pid: null,
      port,
      host,
      model,
      profile,
      startedAt: Date.now(),
      lastHealth: null,
      proc: null,
    });
    log.info('launching sidecar', { engineId, endpoint, model, profile });
    const extraEnv = {
      ...(meta.serve.modelEnv && model ? { [meta.serve.modelEnv]: model } : {}),
      ...(meta.serve.profileEnv && profile ? { [meta.serve.profileEnv]: profile } : {}),
    };
    const proc = spawnEngineProcess(engineId, host, port, { startModule: meta.serve.startModule, extraEnv });

    const state = _engines.get(engineId);
    state.pid = proc.pid;
    state.proc = proc;

    proc.on('exit', (code, signal) => {
      const cur = _engines.get(engineId);
      if (!cur) return;
      const wasReady = cur.state === STATES.READY;
      cur.state = (wasReady || code === 0) ? STATES.STOPPED : STATES.CRASHED;
      cur.pid = null;
      cur.proc = null;
      log.warn('sidecar exited', { engineId, code, signal, newState: cur.state });
    });

    // loading/compiling count as still starting until readyTimeoutMs (a first
    // compile takes minutes); a dead process or a 'failed' phase ends it early
    const ready = await waitForReady(
      endpoint, options.timeoutMs ?? meta.serve.readyTimeoutMs ?? 120_000, 250,
      () => proc.exitCode !== null || proc.signalCode !== null,
    );
    if (!ready.ok) {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      _engines.set(engineId, {
        ..._engines.get(engineId),
        state: STATES.FAILED,
        lastHealth: ready,
      });
      throw new Error(`${engineId} failed to become ready: ${ready.error || 'unknown'}`);
    }

    const finalState = {
      state: STATES.READY,
      pid: proc.pid,
      port, host,
      model: ready.model ?? model,
      profile: ready.profile ?? profile,
      startedAt: state.startedAt,
      readySince: Date.now(),
      lastHealth: ready,
      proc,
    };
    _engines.set(engineId, finalState);
    log.info('sidecar ready', { engineId, endpoint, device: ready.device, model: finalState.model });
    _armReaper();
    return getStatus(engineId);
  } catch (err) {
    const cur = _engines.get(engineId);
    if (cur) cur.state = STATES.FAILED;
    log.error('launch failed', { engineId, err: err.message });
    throw err;
  }
};

/**
 * Stop a running engine.
 */
export const stop = (engineId) => {
  const state = _engines.get(engineId);
  if (!state?.proc) {
    _engines.set(engineId, { ...state, state: STATES.STOPPED, pid: null, proc: null });
    return getStatus(engineId);
  }
  // Hold the child itself: state.proc is cleared below, so the forced kill must
  // not read it back — a sidecar that ignores SIGTERM would keep its RAM and VRAM.
  const { proc } = state;
  try {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      }
    }, 3000).unref();
  } catch (err) {
    log.warn('stop failed', { engineId, err: err.message });
  }
  state.state = STATES.STOPPED;
  state.proc = null;
  state.pid = null;
  return getStatus(engineId);
};

/**
 * Probe /health of a running engine (or return stopped state).
 */
export const healthCheck = async (engineId) => {
  const state = _engines.get(engineId);
  if (!state || state.state !== STATES.READY) {
    return { ok: false, state: state?.state || STATES.STOPPED };
  }
  const endpoint = `http://${state.host}:${state.port}`;
  try {
    const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return { ok: false, state: STATES.FAILED, http: r.status };
    const data = await r.json();
    state.lastHealth = data;
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, state: STATES.CRASHED, error: err.message };
  }
};

// impure — ask one READY sidecar to exit and mark it stopped locally.
// /shutdown works for adopted (proc-less) engines too — the sidecar kills
// itself, which no local signal could do.
const _reapEngine = async (engineId, state, idleSeconds) => {
  try {
    await sidecarFetch(`http://${state.host}:${state.port}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) });
  } catch { /* it may drop the socket while exiting — that IS the shutdown */ }
  if (state.proc) stop(engineId);
  else _engines.set(engineId, { ...state, state: STATES.STOPPED, pid: null, proc: null });
  log.info('idle sidecar reaped — VRAM freed', { engineId, idleSeconds });
};

/**
 * One reap pass: stop every READY engine whose sidecar reports idling past
 * the TTL. Engines that became READY under this manager less than a TTL ago
 * keep a grace window (a just-adopted long-idle sidecar is usually about to
 * be used). Returns the ids reaped.
 * @param {number} [ttlMs] one window for every engine; omitted, each engine's
 *   serve.idleTtlMs, else VOICE_ENGINE_IDLE_TTL_MS
 */
// impure
export const reapIdleEngines = async (ttlMs) => {
  if (!((ttlMs ?? IDLE_TTL_MS) > 0)) return [];
  const reaped = [];
  for (const [engineId, state] of _engines.entries()) {
    if (state.state !== STATES.READY) continue;
    // A caller's window wins; else the engine's own (serve.idleTtlMs — dictation stays warm longer).
    const ttl = ttlMs ?? getEngine(engineId)?.serve?.idleTtlMs ?? IDLE_TTL_MS;
    if (Date.now() - (state.readySince ?? 0) < ttl) continue;
    try {
      // only the sidecar's own word counts: an answerer that cannot prove the key is never trusted
      const data = await provenHealth(`http://${state.host}:${state.port}`);
      const idle = data?.idle_seconds;
      if (typeof idle !== 'number') continue; // pre-contract sidecar — never reap
      if (idle * 1000 >= ttl) {
        await _reapEngine(engineId, state, idle);
        reaped.push(engineId);
      }
    } catch { /* unreachable — the crash/exit handlers own that case */ }
  }
  return reaped;
};

// impure — start the periodic reap once any engine is READY. unref'd so it
// never holds the process open; cleared on shutdownAll.
const _armReaper = () => {
  if (_reaperTimer || !(IDLE_TTL_MS > 0)) return;
  _reaperTimer = setInterval(() => {
    reapIdleEngines().catch((err) => log.warn('idle reap pass failed', { err: err.message }));
  }, REAP_INTERVAL_MS);
  _reaperTimer.unref();
};

/**
 * Stop all running engines. Called on backend shutdown.
 */
export const shutdownAll = () => {
  if (_reaperTimer) {
    clearInterval(_reaperTimer);
    _reaperTimer = null;
  }
  for (const [id, state] of _engines.entries()) {
    if (state.proc) {
      try {
        state.proc.kill('SIGTERM');
        log.info('stopped on shutdown', { engineId: id });
      } catch { /* already gone */ }
    }
  }
  _engines.clear();
};

export const ENGINE_STATES = STATES;
