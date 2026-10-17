/**
 * bench-relight — the desk's recovery console for the serving gap. The one
 * verb that touches the rig outside a benchmark window: bring the serving
 * watchdog and the model swapper back when BOTH are gone (they are daemons —
 * the Sep-21 postmortem exists because nothing watched them).
 *
 * The office boundaries are law here:
 *   - A live serving-watchdog OWNS relight — it relights serving itself. A
 *     desk relight while it stands would double-drive, so that is a 409
 *     naming the pid, not a spawn.
 *   - A healthy endpoint is nothing to relight: 409.
 *   - Daemons are NEVER plane-owned children: they are spawned detached and
 *     unref'd (or systemd-owned), so stopOwned can never touch them and this
 *     backend's exit never reaps them.
 *   - systemd first: when the operator has installed the user units
 *     (sibling deploy/), the daemons start THROUGH systemd and systemd owns
 *     them from there. Raw detached spawn is the fallback for a box without
 *     the units.
 *
 * Direction law: bench-launch imports this module; this module never imports
 * bench-launch.
 */

import { openSync, closeSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveInside } from './bench-paths.js';
import { probeServing, pgrepPids } from './bench-status.js';
import { createLogger } from '../logger.js';

const log = createLogger('Bench');
const execFileP = promisify(execFile);

const SYSTEMCTL_TIMEOUT_MS = 5000;
const SETTLE_MS = 1200; // the start-night idiom: a daemon that dies instantly is a failed relight

const DAEMONS = Object.freeze({
  watchdog: Object.freeze({
    name: 'serving-watchdog',
    unit: 'bench-serving-watchdog.service',
    pgrep: 'serving-watchdog.mjs',
    argv: ['scripts/serving-watchdog.mjs'],
    logRel: 'logs/serving-watchdog.log',
  }),
  swap: Object.freeze({
    name: 'swap-model',
    unit: 'bench-swap-model.service',
    pgrep: 'swap-model.mjs',
    logRel: 'logs/swap-daemon.log',
    // argv built per call — the model key is the operator's choice.
  }),
});

/** pure — the structured refusal shape the routes map verbatim. */
const refuse = (status, code, message) => ({ ok: false, status, code, message });

/**
 * Is a user unit installed? `systemctl --user list-unit-files <unit>` lists
 * it when present and answers empty when not; any failure (no dbus session,
 * no systemd) reads as "not installed" — the raw-spawn fallback. Never throws.
 * @param {string} unit
 * @returns {Promise<boolean>}
 */
// impure (real execFile against the session's systemd)
export const systemctlHasUnit = async (unit) => {
  try {
    const { stdout } = await execFileP(
      'systemctl', ['--user', 'list-unit-files', unit, '--no-legend', '--no-pager'],
      { timeout: SYSTEMCTL_TIMEOUT_MS },
    );
    return stdout.trim().startsWith(unit);
  } catch {
    return false;
  }
};

/**
 * Start one daemon the systemd way. Returns the outcome row; a rejected
 * systemctl is a failure ROW (the caller reports it), never a throw.
 * @param {object} daemon one of DAEMONS
 * @returns {Promise<{name: string, via: 'systemd', ok: boolean, error?: string}>}
 */
// impure (systemd act)
const startViaSystemd = async (daemon) => {
  try {
    await execFileP('systemctl', ['--user', 'start', daemon.unit], { timeout: SYSTEMCTL_TIMEOUT_MS });
    return { name: daemon.name, via: 'systemd', ok: true };
  } catch (err) {
    return { name: daemon.name, via: 'systemd', ok: false, error: err.message };
  }
};

/**
 * Start one daemon the raw way — the start-night.mjs idiom verbatim: stdout
 * and stderr append to the harness's own log file (where the operator already
 * reads them), detached and unref'd, with a settle check so an instantly-
 * dying child reads as a failed relight instead of a spawned pid.
 *
 * Exported for the test seam (the securityTick idiom): the mechanics — fd
 * append, detached spawn, unref, settle verdict — are provable with a
 * throwaway resident child, never by spawning the real swap daemon in a test.
 * @param {string} root harness root
 * @param {object} daemon one of DAEMONS ({name, logRel} are the fields used)
 * @param {string[]} argv fixed argv (no client strings — buildArgs already judged)
 * @returns {Promise<{name: string, via: 'spawn', ok: boolean, pid?: number, error?: string}>}
 */
// impure (spawns a real detached daemon)
export const startViaSpawn = async (root, daemon, argv) => {
  let child;
  try {
    const fd = openSync(resolveInside(root, daemon.logRel), 'a');
    child = spawn(process.execPath, argv, { cwd: root, detached: true, stdio: ['ignore', fd, fd] });
    closeSync(fd);
  } catch (err) {
    return { name: daemon.name, via: 'spawn', ok: false, error: err.message };
  }
  let spawnError = null;
  child.on('error', (err) => { spawnError = err; });
  await new Promise((resolvePromise) => { setTimeout(resolvePromise, SETTLE_MS); });
  if (spawnError || child.exitCode !== null) {
    return {
      name: daemon.name, via: 'spawn', ok: false,
      error: spawnError?.message || `exited immediately (code ${child.exitCode}) — inspect ${daemon.logRel}`,
    };
  }
  child.unref();
  return { name: daemon.name, via: 'spawn', ok: true, pid: child.pid };
};

/**
 * Relight serving: ensure the watchdog, then swap the model onto the endpoint.
 * Both daemons must be GONE (the gap this verb exists for); the endpoint must
 * be DOWN. Every outcome row is reported; a daemon that could not start turns
 * the call into a BENCH_RELIGHT_FAILED refusal naming what DID start.
 * @param {{root: string, model: string, wallet: string}} args
 * @returns {Promise<object>} {ok:true, verb, spawned: [...]} | refusal
 */
// impure (probes the rig, then starts daemons — the desk's recovery act)
export const relightServing = async ({ root, model, wallet }) => {
  const serving = await probeServing();
  if (serving.ok) {
    return refuse(409, 'BENCH_SERVING_HEALTHY', 'the serving endpoint answers — nothing to relight');
  }
  const watchdogPids = await pgrepPids(DAEMONS.watchdog.pgrep);
  if (watchdogPids.length > 0) {
    return refuse(409, 'BENCH_DAEMON_RUNNING',
      `the serving watchdog already stands (pid ${watchdogPids.join(', ')}) — relight is its office; wait for it or read logs/serving-incidents.jsonl`);
  }
  const swapPids = await pgrepPids(DAEMONS.swap.pgrep);
  if (swapPids.length > 0) {
    return refuse(409, 'BENCH_DAEMON_RUNNING',
      `the swap-model daemon already stands (pid ${swapPids.join(', ')}) — a swap is its office; do not double-drive it`);
  }

  const outcomes = [];
  // The watchdog FIRST — it owns serving from the moment it stands, so the
  // swap must land under its watch, never before it.
  outcomes.push(await systemctlHasUnit(DAEMONS.watchdog.unit)
    ? startViaSystemd(DAEMONS.watchdog)
    : startViaSpawn(root, DAEMONS.watchdog, DAEMONS.watchdog.argv));
  outcomes.push(await systemctlHasUnit(DAEMONS.swap.unit)
    ? startViaSystemd(DAEMONS.swap)
    : startViaSpawn(root, DAEMONS.swap, ['scripts/swap-model.mjs', model]));

  const spawned = outcomes.filter((o) => o.ok);
  const failed = outcomes.filter((o) => !o.ok);
  log.warn('relight-serving', { model, wallet, outcomes });
  if (failed.length > 0) {
    return {
      ...refuse(500, 'BENCH_RELIGHT_FAILED',
        `${failed.map((f) => `${f.name} failed (${f.via}: ${f.error})`).join('; ')}`
        + (spawned.length ? `; ${spawned.map((s) => `${s.name} stands`).join(', ')}` : '')),
      spawned,
    };
  }
  return {
    ok: true,
    verb: 'relight-serving',
    spawned: spawned.map((s) => ({ name: s.name, via: s.via, pid: s.pid ?? null })),
    detail: 'the daemons stand — serving relights under the watchdog; read the OVERVIEW in a minute',
  };
};
