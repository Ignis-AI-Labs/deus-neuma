// Voice Engine Process — spawn / readiness / venv-sync primitives for local
// Python TTS sidecars. Extracted verbatim from engine-manager.js (size-law
// breakdown): the manager owns lifecycle STATE (the per-engine map, adoption,
// the idle reaper); this module owns the PROCESS mechanics. Every helper is
// parameterized on (engineId, host, port) — no engine state lives here, and
// this module never imports the manager.

import { spawn, execFile } from 'child_process';
import { existsSync, statSync, mkdirSync, openSync, closeSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { helperEnvironment } from '../agent-terminal-environment.js';
import { withStoredHfToken } from '../stored-secrets.js';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');

// impure — uv's standalone installer lands in ~/.local/bin, which a systemd-
// or Electron-launched backend's PATH often lacks; resolve the known install
// location first (the same pattern substrate-ignition uses for lms).
export const uvBin = () => {
  const installed = path.join(homedir(), '.local', 'bin', 'uv');
  return existsSync(installed) ? installed : 'uv';
};

// Every local sidecar rides `uv` (sync + run). Its absence is the FIRST thing
// a fresh machine hits — probed once and cached for a minute so status polls
// stay cheap, but an install mid-session is noticed without a restart.
const UV_PROBE_TTL_MS = 60_000;
let _uvProbe = null; // { available, at }

// impure — is the uv runtime reachable on this machine right now?
export const isUvAvailable = async () => {
  if (_uvProbe && Date.now() - _uvProbe.at < UV_PROBE_TTL_MS) return _uvProbe.available;
  const available = await new Promise((resolve) => {
    execFile(uvBin(), ['--version'], { timeout: 5000 }, (err) => resolve(!err));
  });
  _uvProbe = { available, at: Date.now() };
  return available;
};

/**
 * What stands between this machine and a working local engine. Pure over its
 * arguments — the route composes it from the real probes so the desk can name
 * the exact missing pieces instead of a bare "unavailable".
 * @param {{ uvAvailable: boolean, downloaded: boolean }} probes
 * @returns {{ ready: boolean, missing: Array<'uv'|'weights'> }}
 */
export const engineReadiness = ({ uvAvailable, downloaded }) => {
  const missing = [];
  if (!uvAvailable) missing.push('uv');
  if (!downloaded) missing.push('weights');
  return Object.freeze({ ready: missing.length === 0, missing: Object.freeze(missing) });
};

/**
 * The env-var stem a sidecar reads its bind from: `chatterbox-nano` → `CHATTERBOX_NANO`
 * (CHATTERBOX_NANO_HOST / _PORT). Registry ids may carry dashes; env names may not. Pure.
 * @param {string} engineId
 */
export const envIdOf = (engineId) => engineId.toUpperCase().replace(/[^A-Z0-9]/g, '_');

// The names a sidecar, its `uv` and the downloader read: the engine's own
// knobs (${ID}_*, plus the two legacy prefixes and the cross-named nano and
// nemotron ones its server.py documents), the GPU and model-cache settings
// and the HF credential. Everything else of the backend's env — its secrets
// first — stays out (helperEnvironment).
const VOICE_RUNTIME_KEY = /^(CUDA_|NVIDIA_|HF_|HUGGINGFACE_|PYTORCH_|TORCH_|OMP_|MKL_|UV_|PHONEMIZER_|NANO_|NEMOTRON_|ZONOS_|KOKORO_|LD_LIBRARY_PATH$)/;

/**
 * The environment a voice helper starts with. Pure.
 * @param {Record<string, string|undefined>} env
 * @param {string} engineId
 * @param {string} [platform]
 * @returns {Record<string, string>}
 */
export const voiceHelperEnvironment = (env, engineId, platform = process.platform) => {
  const own = `${envIdOf(engineId)}_`;
  return helperEnvironment(env, platform, (key) => key.startsWith(own) || VOICE_RUNTIME_KEY.test(key));
};

// pure — the sidecar's uv project dir and entry script: serve.startModule when the
// manifest declares one (repo-relative), else the voice-engines/<id>/server.py convention
const entryOf = (engineId, startModule) => {
  const serverPy = startModule
    ? path.join(REPO_ROOT, startModule)
    : path.join(REPO_ROOT, 'voice-engines', engineId, 'server.py');
  return { serverPy, projectDir: path.dirname(serverPy) };
};

// impure — spawn the sidecar process (it outlives this call; the caller watches its exit)
export const spawnEngineProcess = (engineId, host, port, { startModule, extraEnv = {} } = {}) => {
  const { serverPy, projectDir } = entryOf(engineId, startModule);
  const args = [
    'run',
    '--project', projectDir,
    'python', serverPy,
  ];
  // Sidecars read their bind from ${ID}_HOST/${ID}_PORT env (server.py
  // fallbacks match these). The legacy two keep their literal names; newer
  // engines derive from the engine id (envIdOf). extraEnv carries per-launch
  // choices such as the model a multi-model engine serves (CSM_MODEL).
  // Temp files go to DISK beside the models: /tmp can be tmpfs (RAM), and a
  // sidecar's scratch audio there is memory held for nothing (ruling, 2026-10-01).
  // torch's default compile cache lives under TMPDIR, so it follows to disk too
  // (csm pins its own under _models/csm/torchinductor).
  const envId = envIdOf(engineId);
  const scratch = path.join(REPO_ROOT, 'voice-engines', '_tmp', engineId);
  mkdirSync(scratch, { recursive: true });
  const env = {
    ...voiceHelperEnvironment(withStoredHfToken(process.env), engineId),
    TMPDIR: scratch, TEMP: scratch, TMP: scratch,
    ZONOS_HOST: host, ZONOS_PORT: String(port),
    KOKORO_HOST: host, KOKORO_PORT: String(port),
    [`${envId}_HOST`]: host,
    [`${envId}_PORT`]: String(port),
    ...extraEnv,
  };
  // Sidecar output goes to a per-engine FILE, never a pipe to this process:
  // a dev-watch backend restart orphans the sidecar, and an orphan holding a
  // dead parent's pipe dies with EPIPE the next time the model prints (a
  // tqdm progress bar mid-synthesis was enough — […]).
  // The engine outlives us by design; its log must too.
  // Follow an engine with: tail -f voice-engines/_logs/<engineId>.log
  const logDir = path.join(REPO_ROOT, 'voice-engines', '_logs');
  mkdirSync(logDir, { recursive: true });
  // Append across launches so a crash's tail survives its relaunch — but cap
  // growth: reap-driven relaunch cycles would otherwise grow this unbounded.
  const logPath = path.join(logDir, `${engineId}.log`);
  let oversized = false;
  try { oversized = statSync(logPath).size > 5 * 1024 * 1024; } catch { /* no log yet */ }
  const logFd = openSync(logPath, oversized ? 'w' : 'a');
  const proc = spawn(uvBin(), args, {
    env,
    cwd: projectDir,
    stdio: ['ignore', logFd, logFd],
    detached: false,
  });
  closeSync(logFd); // the child holds its own descriptor

  return proc;
};

/**
 * A sidecar bind host must be loopback. Pure.
 * @param {string} host
 * @returns {boolean}
 */
export const isLoopbackBind = (host) =>
  host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';

// pure — does a sidecar (its /health, or our record of it) serve what was
// asked for? Each unnamed field matches anything.
export const serves = (want, health) =>
  (!want.model || health?.model === want.model) && (!want.profile || health?.profile === want.profile);

/**
 * Read a sidecar's /health into one verdict. `phase` is the speak-protocol
 * field (loading | compiling | ready | failed); sidecars that predate it only
 * say `ok`, which maps to ready / starting. Pure.
 * @param {object|null} health
 * @returns {'ready'|'starting'|'failed'}
 */
export const healthVerdict = (health) => {
  if (health?.phase === 'failed') return 'failed';
  return health?.ok === true ? 'ready' : 'starting';
};

// impure — probe a sidecar port directly: { verdict: ready|starting|failed|down, health }
export const probeHealth = async (host, port, timeoutMs = 1500) => {
  try {
    const r = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { verdict: 'starting', health: null };
    const health = await r.json().catch(() => null);
    return { verdict: healthVerdict(health), health };
  } catch { return { verdict: 'down', health: null }; }
};

// impure — poll /health until ready, failed, the process died, or timeout.
// loading/compiling are still-starting: a first-ever compile legitimately
// takes minutes, so only the caller's timeout (serve.readyTimeoutMs) ends it.
export const waitForReady = async (endpoint, timeoutMs = 120_000, intervalMs = 1000, isDead = () => false) => {
  const { hostname, port } = new URL(endpoint);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isDead()) return { ok: false, error: 'sidecar process exited before it was ready' };
    const { verdict, health } = await probeHealth(hostname, Number(port), 2000);
    if (verdict === 'ready') return { ok: true, ...health };
    if (verdict === 'failed') return { ok: false, ...health, error: health.error || 'model load failed' };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, error: 'timeout' };
};

// impure — ask a sidecar to exit (POST /shutdown) and wait until its port is
// silent. Works on adopted sidecars this process never spawned: the sidecar
// ends itself. A sidecar abandons an exit while a request is in flight or one
// ended under 0.5 s ago (the idle contract), so the ask repeats each second
// until it lands. Resolves true once the port stops answering.
export const shutdownSidecar = async (host, port, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  let askedAt = 0;
  while (Date.now() < deadline) {
    if (Date.now() - askedAt >= 1000) {
      askedAt = Date.now();
      try {
        await fetch(`http://${host}:${port}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) });
      } catch { /* it may drop the socket while exiting — that IS the shutdown */ }
    }
    if ((await probeHealth(host, port, 500)).verdict === 'down') return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

// impure — run `uv sync` for the engine's project (installs deps if missing)
export const syncEngineVenv = (engineId, startModule) =>
  new Promise((resolve, reject) => {
    const { projectDir } = entryOf(engineId, startModule);
    const proc = spawn(uvBin(), ['sync', '--project', projectDir], {
      cwd: projectDir,
      env: voiceHelperEnvironment(withStoredHfToken(process.env), engineId),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`uv sync failed (${code}): ${stderr.slice(0, 300)}`));
    });
  });
