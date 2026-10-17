/**
 * bench-status — the one-call read model for the desk's OVERVIEW: is serving
 * up, who holds the rig, what did the last night window do, are the harness
 * daemons standing, and what has the serving-incident journal recorded.
 *
 * Every section degrades INDEPENDENTLY: a missing lock dir, a logs dir with
 * no night status, a dead endpoint, or a box without pgrep costs that one
 * section and nothing else (the chain-reader disabled-mode idiom). Nothing
 * here throws into a route handler.
 *
 * The plane reads the harness's own files; it never invents state. The
 * serving probe is a read-only GET — the same probe the harness watchdog
 * makes — never a POST, never a relight.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { harnessRoot, servingUrl, resolveInside, benchWatchJournalPath } from './bench-paths.js';
import { createLogger } from '../logger.js';
// The READ side only (the CQ-036 seam: served-model-truth READS the truth;
// the supervisor COMMANDS the process — bench-status never commands the
// substrate).
import { activeServedModelKey } from '../served-model-truth.js';
import { resolveServingLaunchConfig } from '../serving-launch-config.js';
import { probeMachineClear } from './bench-machine.js';

const log = createLogger('Bench');
const execFileP = promisify(execFile);

const SERVING_PROBE_TIMEOUT_MS = 3000;
const GPU_PROBE_TIMEOUT_MS = 10000;
const INCIDENT_TAIL = 20;
// Window status files are night-<stamp>-status.json; the per-attempt
// night-<stamp>-<group>-a<N>-status.json siblings are NOT the window.
const NIGHT_STATUS_RE = /^night-\d{8}t\d{6}z-status\.json$/;

/**
 * Is a pid alive on this box? EPERM still means alive (owned by another uid).
 * @param {number} pid
 * @returns {boolean}
 */
// impure (process probe)
export const pidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

/**
 * Project a raw night-window status JSON into the desk's summary. Pure.
 * @param {object} raw - parsed night-<stamp>-status.json
 * @param {string} file - the file's basename
 * @param {number} mtimeMs - the file's mtime (the watchdog reads it for stalls)
 */
export const parseNightStatus = (raw, file, mtimeMs) => {
  const groups = Array.isArray(raw?.groups) ? raw.groups : [];
  const steps = Array.isArray(raw?.steps) ? raw.steps : [];
  return Object.freeze({
    file,
    mtimeMs,
    status: raw?.status ?? null,
    pid: raw?.pid ?? null,
    startedAt: raw?.startedAt ?? null,
    deadline: raw?.deadline ?? null,
    waitingFor: raw?.waitingFor ?? null,
    groups: groups.map((g) => ({ id: g?.id ?? null, status: g?.status ?? null })),
    steps: steps.map((s) => ({
      cell: s?.cell ?? null,
      arm: s?.arm ?? null,
      status: s?.status ?? null,
      attempt: s?.attempt ?? null,
    })),
    stepCount: steps.length,
    unstartedGroups: Array.isArray(raw?.unstartedGroups) ? raw.unstartedGroups : [],
    serving: raw?.serving && typeof raw.serving === 'object'
      ? { pid: raw.serving.pid ?? null, file: raw.serving.file ?? null, verifiedAt: raw.serving.verifiedAt ?? null }
      : null,
    abortReason: raw?.abortReason ?? null,
    finishedAt: raw?.finishedAt ?? null,
  });
};

/**
 * The latest night-window status by file mtime, or null when the logs dir
 * holds none (fresh harness, or logs pruned).
 * @param {string} [root]
 * @returns {Promise<?object>}
 */
// impure (filesystem reads)
export const readLatestNightStatus = async (root = harnessRoot()) => {
  let entries;
  try {
    entries = await readdir(resolveInside(root, 'logs'));
  } catch {
    return null;
  }
  const candidates = entries.filter((name) => NIGHT_STATUS_RE.test(name));
  if (candidates.length === 0) return null;
  let newest = null;
  for (const name of candidates) {
    try {
      const s = await stat(resolveInside(root, 'logs', name));
      if (!newest || s.mtimeMs > newest.mtimeMs) newest = { name, mtimeMs: s.mtimeMs };
    } catch { /* a file that vanished mid-scan is not a candidate */ }
  }
  if (!newest) return null;
  try {
    const raw = JSON.parse(await readFile(resolveInside(root, 'logs', newest.name), 'utf8'));
    return parseNightStatus(raw, newest.name, newest.mtimeMs);
  } catch (err) {
    log.warn('latest night status unreadable', { file: newest.name, error: err.message });
    return null;
  }
};

/**
 * Does the platform's own supervised serving resolve to the bench endpoint?
 * Only then is the supervisor's served-model truth ABOUT the server the bench
 * plane probes — two different servers' truths must never cross. Pure read of
 * the resolved config; a config that doesn't resolve reads as not-us.
 * @param {string} url the bench serving URL
 * @returns {boolean}
 */
// impure (reads process.env + the selection file via the config resolver)
export const supervisorOnBenchEndpoint = (url) => {
  try {
    const cfg = resolveServingLaunchConfig(process.env);
    const u = new URL(url);
    return cfg.host === u.hostname && String(cfg.port) === (u.port || '80');
  } catch {
    return false;
  }
};

/**
 * The platform's OWN truth of what is loaded on the bench endpoint — the
 * supervised channel names the model through the fd-serving idiom that makes
 * /v1/models answer '/proc/self/fd/4' (the live «NOTICE» in the operator's
 * screenshot, 2026-09-25). Null-honest: nothing serving → nothing loaded
 * (a resting target is intent, never a reading); a supervisor resolving to a
 * DIFFERENT endpoint → null (not ours to name).
 * @param {string} url the bench serving URL
 * @param {boolean} servingOk the probe's own verdict
 * @returns {Promise<?string>} the loaded model's key/path as the platform knows it
 */
// impure (env + selection/claim reads, liveness probe)
export const readLoadedModel = async (url, servingOk) => {
  if (!servingOk || !supervisorOnBenchEndpoint(url)) return null;
  return activeServedModelKey(process.env).catch(() => null);
};

/**
 * Read-only serving probe: GET <url>/v1/models with a hard 3s cap. Reports
 * the model ids the endpoint claims to serve. A dead endpoint is a READING
 * ({ok:false}), not an exception — the desk's whole job is showing it.
 * @param {string} [url]
 * @returns {Promise<{ok: true, models: string[]} | {ok: false, error: string}>}
 */
// impure (network GET, loopback)
export const probeServing = async (url = servingUrl()) => {
  try {
    const res = await fetch(`${url}/v1/models`, {
      signal: AbortSignal.timeout(SERVING_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    const body = await res.json();
    const ids = Array.isArray(body?.data)
      ? body.data.map((m) => m?.id).filter((id) => typeof id === 'string')
      : [];
    return { ok: true, models: ids };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

/**
 * The rig's one-benchmark lock: active.lock/owner.json plus the liveness of
 * the pid it names. Null when no window holds the rig.
 * @param {string} [root]
 * @returns {Promise<?{pid: ?number, alive: boolean, owner: object}>}
 */
// impure (filesystem read + process probe)
export const readRigLock = async (root = harnessRoot()) => {
  try {
    const owner = JSON.parse(await readFile(resolveInside(root, 'active.lock', 'owner.json'), 'utf8'));
    const pid = Number.isInteger(owner?.pid) ? owner.pid : null;
    return { pid, alive: pidAlive(pid), owner };
  } catch {
    return null;
  }
};

/**
 * The GPU/driver leg: nvidia-smi's one-line inventory. The driver not
 * answering is the READING that matters (Xid 79 taught this box what a
 * fallen-off-the-bus GPU costs) — so ENOENT, a nonzero exit, and the timeout
 * all return {ok:false, error}, never throw.
 *
 * The `env` seam exists so tests can point PATH at a shim dir (the sibling's
 * own window-stall idiom): the execFile is real, the binary it finds is the
 * test's fixture.
 *
 * @param {object} [env] child process env (defaults to this process's)
 * @returns {Promise<{ok: true, name: string, utilizationPercent: number,
 *   memoryUsedMiB: number} | {ok: false, error: string}>}
 */
// impure (driver probe via real execFile)
export const probeGpu = async (env = process.env) => {
  try {
    const { stdout } = await execFileP(
      'nvidia-smi',
      ['--query-gpu=name,utilization.gpu,memory.used', '--format=csv,noheader,nounits'],
      { timeout: GPU_PROBE_TIMEOUT_MS, env },
    );
    const parsed = parseGpuLine(stdout);
    if (!parsed) return { ok: false, error: `unparseable nvidia-smi answer: ${stdout.slice(0, 80)}` };
    return parsed;
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

/**
 * Parse nvidia-smi's csv,noheader,nounits answer (first GPU). Pure — total:
 * anything malformed reads null and the caller degrades to {ok:false}.
 * @param {string} text
 * @returns {?{ok: true, name: string, utilizationPercent: number, memoryUsedMiB: number}}
 */
export const parseGpuLine = (text) => {
  const line = String(text ?? '').split('\n').map((s) => s.trim()).find(Boolean);
  if (!line) return null;
  const [name, util, mem] = line.split(',').map((s) => s.trim());
  const utilizationPercent = parseInt(util, 10);
  const memoryUsedMiB = parseInt(mem, 10);
  if (!name || !Number.isInteger(utilizationPercent) || !Number.isInteger(memoryUsedMiB)) return null;
  return { ok: true, name, utilizationPercent, memoryUsedMiB };
};

/**
 * Live pids matching a full-command-line pattern. pgrep exit 1 means "none"
 * — a reading, not a failure; a box without pgrep reads as [] (and the
 * daemons' absence then reads as not-running, which the desk shows).
 * @param {string} pattern
 * @returns {Promise<number[]>}
 */
// impure (process-table scan)
export const pgrepPids = async (pattern) => {
  try {
    const { stdout } = await execFileP('pgrep', ['-f', pattern]);
    return stdout.split('\n').map((s) => parseInt(s, 10)).filter(Number.isInteger);
  } catch {
    return [];
  }
};

/**
 * Liveness of the harness's own daemons (serving watchdog, model swapper) by
 * process-table scan.
 * @returns {Promise<{servingWatchdog: {running: boolean, pids: number[]},
 *   swapModel: {running: boolean, pids: number[]}}>}
 */
// impure (process-table scan)
export const probeDaemons = async () => {
  const scan = async (pattern) => {
    const pids = await pgrepPids(pattern);
    return { running: pids.length > 0, pids };
  };
  return {
    servingWatchdog: await scan('serving-watchdog.mjs'),
    swapModel: await scan('swap-model.mjs'),
  };
};

/**
 * The last `limit` rows of a JSONL journal, oldest first. Unparseable lines
 * (a crash-truncated tail) are skipped, never fatal. Missing file → [].
 * @param {string} filePath - absolute path
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
// impure (filesystem read)
export const readJsonlTail = async (filePath, limit = INCIDENT_TAIL) => {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch { /* skip the truncated line */ }
  }
  return rows.slice(-Math.max(1, limit));
};

/**
 * The serving-incident journal tail (harness-owned, read-only).
 * @param {string} [root]
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
// impure (filesystem read)
export const readServingIncidents = (root = harnessRoot(), limit = INCIDENT_TAIL) =>
  readJsonlTail(resolveInside(root, 'logs', 'serving-incidents.jsonl'), limit);

/**
 * The desk's one-call read model. Sections degrade independently; the call
 * itself never rejects.
 * @param {string} [root]
 * @param {string} [url]
 */
// impure (composes the probes above)
export const getBenchStatus = async (root = harnessRoot(), url = servingUrl()) => {
  const [servingBase, lock, night, daemons, gpu, incidents, watch, machine] = await Promise.all([
    probeServing(url).catch((err) => ({ ok: false, error: err.message })),
    readRigLock(root).catch(() => null),
    readLatestNightStatus(root).catch(() => null),
    probeDaemons().catch(() => null),
    probeGpu().catch((err) => ({ ok: false, error: err.message })),
    readServingIncidents(root).catch(() => []),
    // The plane's own watch journal rides /status — one poll carries the
    // whole incident rail (the desk dropped its separate /incidents poll
    // when the desk's one-wallet cadence met the rate ceiling).
    readJsonlTail(benchWatchJournalPath()).catch(() => []),
    // Is the machine clear of test runs? The harness refuses to stack on one.
    probeMachineClear(),
  ]);
  // The platform's own loaded-model truth rides the probe's verdict.
  const loaded = await readLoadedModel(url, servingBase.ok === true).catch(() => null);
  return { serving: { ...servingBase, loaded }, lock, night, daemons, gpu, incidents, watch, machine };
};
