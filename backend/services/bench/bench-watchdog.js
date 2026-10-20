/**
 * bench-watchdog — the platform-side alerter. It SEES and SAYS; it never
 * kills a process and never relights serving — those belong to the harness's
 * own watchdog, and a second actor on the rig would be a violation, not a
 * feature.
 *
 * Three watch legs per tick (only when a harness is present):
 *   (a) endpoint-wait-stall — the latest LIVE night window has been waiting
 *       for the model endpoint and its status file has gone untouched for
 *       10+ minutes (the Sep-21 shape: a dead endpoint burning a window).
 *   (b) deadline-crunch — the live window's deadline is under 30 minutes out
 *       and groups are still unstarted (work is about to be lost).
 *   (c) serving-incident — new rows in the harness's serving-incidents
 *       journal since the last tick (byte-offset tracked; a shrink resets
 *       the offset to 0). A `down` row or a `relight-exit` with code ≠ 0
 *       escalates the severity.
 *
 * A finished window (finishedAt set) is a corpse — its waitingFor and
 * unstartedGroups are the record of how it died, not live conditions, so
 * both legs gate on the window being unfinished.
 *
 * Every fire lands in TWO places: the platform watch journal (the durable
 * record, under the data root — never inside the sovereign harness) and a
 * tray card via notifyOperator. Conditions fire once until they clear and
 * recur; incident rows are events and fire per row. The first tick adopts
 * the journal's current end as the baseline — booting does not replay
 * history.
 *
 * Card addressing: the card goes to the operator whose run it is — the
 * wallet that issued the live night's pass, else the wallet whose matched set
 * runs now, else NEUMA_BENCH_OPERATOR_WALLET. With no address the journal
 * still holds the record and the watch logs the skip. Never the first lane
 * owner a directory scan finds: on a box with two houses that was the other
 * house's tray (houses are never confused).
 */

import { mkdir, appendFile, readFile, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { harnessRoot, available, resolveInside, benchWatchJournalPath } from './bench-paths.js';
import { readLatestNightStatus, probeServing, probeGpu } from './bench-status.js';
import { liveChainWallet } from './bench-matched.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { createLogger } from '../logger.js';

const log = createLogger('Bench');

const TICK_MS = 60 * 1000;
const ENDPOINT_STALL_MS = 10 * 60 * 1000;
const DEADLINE_CRUNCH_MS = 30 * 60 * 1000;

// Module-level watch state — one watch per process.
let inFlight = null;
let timer = null;
let incidentOffset = null; // null = baseline not yet adopted
const activeConditions = new Set();

/**
 * The wallet that issued the live night's pass (the harness's own
 * .night-passes records; a pass names its night by logPrefix), or null.
 * @param {string} root
 * @param {?object} night - the latest night status (bench-status.js)
 * @returns {Promise<?string>}
 */
// impure (reads the harness's pass records)
const nightIssuer = async (root, night) => {
  if (!night || night.finishedAt) return null;
  const prefix = String(night.file).replace(/-status\.json$/, '');
  let names;
  try { names = await readdir(resolveInside(root, '.night-passes')); } catch { return null; }
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    try {
      const pass = JSON.parse(await readFile(resolveInside(root, '.night-passes', name), 'utf8'));
      if (pass?.logPrefix === prefix && typeof pass.issuedBy === 'string' && pass.issuedBy) return pass.issuedBy;
    } catch { /* a pass mid-rename or unreadable — keep looking */ }
  }
  return null;
};

/**
 * The tray card's address: the live night's issuer, else the live set's
 * launcher, else NEUMA_BENCH_OPERATOR_WALLET, else null (journal only).
 * @returns {Promise<?string>}
 */
// impure (pass records, the live chain, env)
const resolveOperatorWallet = async (root, night) =>
  (await nightIssuer(root, night)) ?? liveChainWallet() ?? (process.env.NEUMA_BENCH_OPERATOR_WALLET || null);

/**
 * Record one fire: journal row + tray card. Never throws — the watch's
 * record must never depend on a card (the bus itself already never throws).
 * @param {{condition: string, severity: string, title: string, detail: string, ref?: object}} fire
 * @param {?string} wallet - the card's address (resolveOperatorWallet), or null
 */
// impure (journal append + notification)
const recordFire = async ({ condition, severity, title, detail, ref = {} }, wallet) => {
  const row = { at: new Date().toISOString(), source: 'bench-watch', condition, severity, detail, ...ref };
  try {
    const journal = benchWatchJournalPath();
    await mkdir(dirname(journal), { recursive: true });
    await appendFile(journal, `${JSON.stringify(row)}\n`);
  } catch (err) {
    log.error('bench watch journal append failed', { condition, error: err.message });
  }
  if (!wallet) {
    log.info('bench alert has no address — the journal holds the record', { condition });
    return;
  }
  await notifyOperator({
    wallet,
    kind: KIND.benchAlert,
    standing: STANDING.system,
    title,
    detail,
    ref: { condition, severity, ...ref },
  });
};

/** pure — the two live-window conditions, or [] (mtime/deadline judged against nowMs). */
export const judgeWindow = (night, nowMs) => {
  if (!night || night.finishedAt) return [];
  const fires = [];
  if (night.waitingFor === 'model-endpoint' && nowMs - night.mtimeMs > ENDPOINT_STALL_MS) {
    fires.push({
      condition: 'endpoint-wait-stall',
      severity: 'warning',
      title: 'Bench: night window stalled waiting for the model endpoint',
      detail: `${night.file} has waited for the endpoint with no status write for ${Math.round((nowMs - night.mtimeMs) / 60000)} min — a dead endpoint burns the window`,
      ref: { file: night.file, waitingFor: night.waitingFor, deadline: night.deadline },
    });
  }
  const deadlineMs = night.deadline ? Date.parse(night.deadline) : NaN;
  if (Number.isFinite(deadlineMs) && deadlineMs - nowMs < DEADLINE_CRUNCH_MS && night.unstartedGroups.length > 0) {
    fires.push({
      condition: 'deadline-crunch',
      severity: 'warning',
      title: `Bench: night deadline closes with ${night.unstartedGroups.length} group(s) unstarted`,
      detail: `${night.file} ends ${night.deadline}; still unstarted: ${night.unstartedGroups.join(', ')}`,
      ref: { file: night.file, deadline: night.deadline, unstartedGroups: night.unstartedGroups },
    });
  }
  return fires;
};

/**
 * The driver-down leg: serving refuses AND the driver does not answer. This
 * is NOT serving-down (process dead, driver fine — the harness watchdog's
 * relight owns that); a dead driver is a different truth and a different
 * recovery — only the operator can recover it, and relight into it is
 * pointless. Pure — the probes' readings are its inputs.
 * @param {{ok: boolean, error?: string}} serving the serving probe's reading
 * @param {{ok: boolean, error?: string}} gpu the GPU probe's reading
 * @returns {?object} the fire, or null
 */
export const judgeDriverDown = (serving, gpu) => {
  if (serving?.ok !== false || gpu?.ok !== false) return null;
  return {
    condition: 'driver-down',
    severity: 'escalated',
    title: 'Bench: serving is down AND the GPU driver is not answering',
    detail: 'the GPU driver is not answering — only the operator can recover it '
      + '(module reload or clean reboot); relight is pointless into a dead driver',
    ref: { servingError: serving?.error ?? null, gpuError: gpu?.error ?? null },
  };
};

/** pure — one fire per NEW serving-incident row; down / failed relight escalates. */
export const judgeIncidentRow = (row) => {
  const escalated = row?.event === 'down'
    || (row?.event === 'relight-exit' && row?.code !== 0);
  return {
    condition: 'serving-incident',
    severity: escalated ? 'escalated' : 'info',
    title: `Bench serving incident: ${row?.event ?? 'unknown'}${row?.event === 'relight-exit' && row?.code !== 0 ? ` (exit ${row.code})` : ''}`,
    detail: row?.note
      ?? (row?.event === 'down' ? `serving probe failing (${row?.probeFailures ?? '?'} failures)` : null)
      ?? (row?.event === 'recovered' ? `serving recovered after ${Math.round((row?.downMs ?? 0) / 1000)}s down` : null)
      ?? `serving-incidents.jsonl row at ${row?.at ?? 'unknown time'}`,
    ref: { event: row?.event ?? null, at: row?.at ?? null },
  };
};

/**
 * Read the harness serving-incident journal incrementally. First call adopts
 * the current end as the baseline (returns []); a shrink resets the offset.
 * @param {string} root
 * @returns {Promise<object[]>} the new rows since the last call
 */
// impure (filesystem read; advances module offset)
const readNewIncidentRows = async (root) => {
  let buf;
  try {
    buf = await readFile(resolveInside(root, 'logs', 'serving-incidents.jsonl'));
  } catch {
    return [];
  }
  if (incidentOffset === null) {
    incidentOffset = buf.length;
    return [];
  }
  if (buf.length < incidentOffset) incidentOffset = 0;
  const text = buf.subarray(incidentOffset).toString('utf8');
  incidentOffset = buf.length;
  const rows = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch { /* a crash-truncated tail line is skipped, never fatal */ }
  }
  return rows;
};

/**
 * One watch tick. Module-level inFlight dedupe: overlapping ticks (a slow
 * disk against a 60s interval) fold into the one already running. Returns
 * the fires it recorded ([] when the harness is absent or nothing fired).
 * Exposed for tests — the seam the due logic stands on.
 * @param {number} [nowMs]
 * @returns {Promise<object[]>}
 */
// impure (probes the harness, appends the journal, raises cards)
export const benchWatchTick = (nowMs = Date.now()) => {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const root = harnessRoot();
    if (!available(root)) return [];
    const fires = [];

    const [night, serving, gpu] = await Promise.all([
      readLatestNightStatus(root),
      probeServing().catch((err) => ({ ok: false, error: err.message })),
      probeGpu().catch((err) => ({ ok: false, error: err.message })),
    ]);
    const windowFires = judgeWindow(night, nowMs);
    const driverFire = judgeDriverDown(serving, gpu);
    if (driverFire) windowFires.push(driverFire);
    for (const fire of windowFires) {
      if (activeConditions.has(fire.condition)) continue;
      activeConditions.add(fire.condition);
      fires.push(fire);
    }
    // Cleared conditions re-arm: a stall that resolved may stall again; a
    // driver that answers again clears driver-down for the next outage.
    for (const condition of ['endpoint-wait-stall', 'deadline-crunch', 'driver-down']) {
      if (!windowFires.some((f) => f.condition === condition)) {
        activeConditions.delete(condition);
      }
    }

    for (const row of await readNewIncidentRows(root)) {
      fires.push(judgeIncidentRow(row));
    }

    const wallet = fires.length ? await resolveOperatorWallet(root, night) : null;
    for (const fire of fires) {
      await recordFire(fire, wallet);
      log.warn('bench watch fired', { condition: fire.condition, severity: fire.severity, detail: fire.detail });
    }
    return fires;
  })().finally(() => { inFlight = null; });
  return inFlight;
};

/**
 * Start the watch: tick-on-start plus a 60s unref'd interval (the
 * security-scheduler idiom). Never blocks the listen; the interval cannot
 * hold the process open.
 * @returns {() => void} stop
 */
// impure (starts a timer)
export const startBenchWatchdog = ({ intervalMs = TICK_MS } = {}) => {
  benchWatchTick().catch((err) => log.error('boot bench watch tick failed', { error: err.message }));
  timer = setInterval(() => {
    benchWatchTick().catch((err) => log.error('bench watch tick failed', { error: err.message }));
  }, intervalMs);
  timer.unref?.();
  log.info('bench watch standing', { everyMs: intervalMs });
  return stopBenchWatchdog;
};

/** Stop the watch. // impure */
export const stopBenchWatchdog = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
