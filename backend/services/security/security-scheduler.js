// Security scheduler — the standing watch: at minimum every 24 hours, scan
// everything the house runs and fold what it finds into the threat ledger.
//
// The watch is a PLATFORM guarantee, not a being's habit: a being only
// assesses when it has a turn, but the scan runs on the server's heartbeat —
// including once at boot when the last run is older than the interval (a
// powered-off weekend must never silently skip the watch).
//
// One run = watch-store load → per watched repo (OSV advisory scan + secret
// sweep) → host probe → house probe → ledger ingest → state append. Every
// leg is independently fail-soft: one repo's unreadable lockfile or a downed
// OSV must never cost the other legs' findings.
//
// ONE WATCH PER HOUSE (Design note, 2026-10-16: two houses on one machine are never
// confused): a run is a house's run — its watch list, its ledger, its scan
// state (`<realm>/<wallet>/offices/security/`), its own lanes in the house
// probe. Only the host inventory (kernel, driver) is a fact of the MACHINE:
// it lands in one machine-wide file every house reads.

import fs from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getSettingsDir } from '../data-root.js';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { webSettings } from '../web-settings.js';
import { runAdvisoryScan } from './advisory-scan.js';
import { sweepRepo, sweepFindingsAsThreats } from './secret-sweep.js';
import { runHostProbe } from './host-probe.js';
import { runHouseProbe } from './house-probe.js';
import { csoDesignation, legacyCsoPath } from './cso-designation.js';
import { watchStoreFor } from './watch-store.js';
import { threatLedgerFor } from './threat-ledger.js';
import { createLegacyMove, officeFile, officeHouses, settleLegacy } from '../house-office.js';
import { houseKey } from '../staff/cos-designation.js';
import { readServed } from '../house-served.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { createLogger } from '../logger.js';

const log = createLogger('SecurityScheduler');

const __dirname = dirname(fileURLToPath(import.meta.url));
// env.* files live at the REPO root (dev) — resolved from this module, never
// from the data root, which moves under the OS home in the packaged app.
const REPO_ROOT = resolve(join(__dirname, '../../..'));

const TICK_MS = 60 * 60 * 1000; // check hourly…
const RUN_EVERY_MS = 24 * 60 * 60 * 1000; // …run daily. Founder's law: minimum every 24h.
const RUNS_KEPT = 20;

const STATE_NAME = 'security-scan-state.json';
const DEFAULT_LEGACY_STATE_PATH = join(getSettingsDir(), STATE_NAME);
const DEFAULT_HOST_PATH = join(getSettingsDir(), 'security-host.json');

// Read per call so tests never touch the operator's live files: the
// pre-2026-10-16 machine scan state, and the machine's host inventory.
const legacyStatePath = () =>
  process.env.NEUMA_SECURITY_SCAN_STATE_PATH || DEFAULT_LEGACY_STATE_PATH;
const hostPath = () => process.env.NEUMA_SECURITY_HOST_PATH || DEFAULT_HOST_PATH;

// The machine-wide scan state moves once to the house that owns the seated CSO.
const moveLegacyState = createLegacyMove({
  office: 'security', name: STATE_NAME, legacyPath: legacyStatePath, legacySeatPath: legacyCsoPath,
});

// impure — a house's own scan state file, after the legacy move.
const statePathFor = async (wallet) => {
  const file = officeFile(wallet, 'security', STATE_NAME);
  await moveLegacyState();
  return file;
};

// impure — missing file = never run; a corrupt file surfaces (a watch that
// cannot say when it last ran must be LOUD, not assume it is fresh).
const loadState = async (path) => {
  let raw;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { lastRunAt: null, host: null, runs: [] };
    throw err;
  }
  return JSON.parse(raw);
};

// impure — the machine's host inventory, null when no run has measured it.
const readHost = async () => {
  try {
    return JSON.parse(await fs.readFile(hostPath(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

/**
 * A house's scan state, with the machine's host inventory — the desk's and
 * the briefing's read. A state moved from the machine-wide record keeps the
 * host it last measured until the next run writes the machine's. impure.
 * @param {string} wallet - the house
 */
export const readScanState = async (wallet) => {
  const state = await loadState(await statePathFor(wallet));
  const host = await readHost().catch(() => null);
  return { ...state, host: host?.inventory || state.host || null };
};

// impure — atomic tmp+rename, same posture as the sibling stores.
const saveState = async (state, path) => {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, path);
  await fs.chmod(dirname(path), 0o700);
  await fs.chmod(path, 0o600);
};

// One run at a time per house: a run walks whole repos and speaks to OSV;
// two overlapping runs of one house would double both.
const inFlight = new Map();

// THE OPERATOR'S EAR — a run that lands NEW critical/high threats tells the
// house's operator directly (tray + OS leg), once per run, never per threat.
// The card is addressed to the house whose ledger took the threats, and only
// while that house seats a CSO — the officer the operator named; with no
// seated office there is no address, and an unaddressed notification reaches
// nobody, never everybody. Fail-soft by law: the watch's record must never
// depend on a card (the bus itself already never throws).
// impure — exposed for tests (the same seam securityTick already stands on):
// the alert's addressing and gating are provable against real tmp stores
// without a full scan.
export const alertOnNewCriticals = async (added, wallet) => {
  const fresh = (added || []).filter((e) => e.severity === 'critical' || e.severity === 'high');
  if (!fresh.length) return;
  try {
    const officer = await csoDesignation.getOfficer(wallet);
    if (!officer?.laneId) {
      log.info('new critical/high threats, no CSO seated in this house — the alert has no address', { count: fresh.length });
      return;
    }
    const worst = fresh.slice(0, 3)
      .map((e) => `${e.severity.toUpperCase()} ${e.externalId}${e.repo ? ` (${e.repo})` : ''}`)
      .join(' · ');
    await notifyOperator({
      wallet: houseKey(wallet),
      kind: KIND.securityAlert,
      standing: STANDING.system,
      title: `Security watch: ${fresh.length} new critical/high threat${fresh.length === 1 ? '' : 's'}`,
      detail: worst + (fresh.length > 3 ? ` · +${fresh.length - 3} more in the ledger` : ''),
      ref: {
        critical: fresh.filter((e) => e.severity === 'critical').length,
        high: fresh.filter((e) => e.severity === 'high').length,
      },
    });
  } catch (err) {
    log.warn('the security alert could not be raised — the ledger still holds the threats', { error: err.message });
  }
};

/**
 * A house's full watch pass. Never throws once begun — every leg records its
 * own failure on the summary, because a watch that hides its blindness is
 * worse than none. A call without a house is refused: there is no machine
 * watch to run.
 *
 * impure — disk, network, spawned probes
 * @param {{wallet: string, trigger?: string, watchStore?: Object, ledger?: Object, statePath?: string}} opts
 * @returns {Promise<Object>} the run summary (also appended to the house's scan state)
 */
export const runSecurityScan = ({ wallet, trigger = 'manual', watchStore, ledger, statePath } = {}) => {
  const house = houseKey(wallet);
  if (!house) return Promise.reject(new Error('a security scan runs for a house — no wallet, no watch'));
  if (inFlight.has(house)) return inFlight.get(house);
  const run = (async () => {
    watchStore = watchStore || await watchStoreFor(house);
    ledger = ledger || await threatLedgerFor(house);
    statePath = statePath || await statePathFor(house);
    const startedAt = new Date().toISOString();
    const summary = {
      startedAt, trigger,
      repos: [], // {repo, checked, swept, hits, sweepFindings, error}
      host: null, // {inventory, findings, errors}
      house: null, // {findings, notes, errors}
      added: 0, seen: 0,
      finishedAt: null,
    };
    const findings = [];

    let watch;
    try {
      watch = await watchStore.load();
    } catch (err) {
      summary.finishedAt = new Date().toISOString();
      summary.error = `watch list unreadable: ${err.message}`;
      log.error('security scan aborted — the watch list is unreadable', { house, error: err.message });
      await saveState(await appendRun(statePath, summary), statePath);
      return summary;
    }

    // SOFTWARE — each watched repo, both scanners, each leg fail-soft.
    for (const repo of watch.repos) {
      const leg = { repo: repo.id, checked: 0, swept: 0, hits: 0, sweepFindings: 0, error: null };
      const [advisories, sweep] = await Promise.all([
        runAdvisoryScan(repo).catch((err) => ({ repo: repo.id, checked: 0, hits: [], error: err.message })),
        sweepRepo(repo).catch((err) => ({ repo: repo.id, scanned: 0, findings: [], error: err.message })),
      ]);
      leg.checked = advisories.checked;
      leg.hits = advisories.hits.length;
      leg.swept = sweep.scanned;
      leg.sweepFindings = sweep.findings.length;
      leg.error = [advisories.error, sweep.error].filter(Boolean).join(' | ') || null;
      findings.push(...advisories.hits, ...sweepFindingsAsThreats(repo, sweep.findings));
      summary.repos.push(leg);
    }

    // HARDWARE — the rig itself, against the operator's named ports.
    summary.host = await runHostProbe({ expectedPorts: watch.host?.expectedPorts || [] })
      .catch((err) => ({ inventory: null, findings: [], errors: [err.message] }));
    findings.push(...summary.host.findings);

    // HOUSE — this house's lanes, stores, env files, keypair custody.
    const webAccessEnabled = await webSettings.isEnabled().catch(() => null);
    summary.house = await runHouseProbe({
      wallet: house,
      workspace: neumaWorkspace,
      repoRoot: REPO_ROOT,
      webAccessEnabled,
    }).catch((err) => ({ findings: [], notes: { webAccessEnabled }, errors: [err.message] }));
    findings.push(...summary.house.findings);

    // THE LEDGER, last: everything every leg surfaced, deduplicated by the
    // store's (source, externalId, repo) law. Fresh criticals/highs then go
    // straight to the operator's ear — a sudden attack is not something you
    // discover next time you open the panel.
    if (findings.length) {
      try {
        const { added, seen } = await ledger.ingest(findings);
        summary.added = added.length;
        summary.seen = seen;
        await alertOnNewCriticals(added, house);
      } catch (err) {
        summary.error = `ledger ingest failed: ${err.message}`;
        log.error('security scan findings could not land in the ledger', { error: err.message });
      }
    }

    summary.finishedAt = new Date().toISOString();
    await saveState(await appendRun(statePath, summary), statePath);
    await saveHost(summary.host?.inventory);
    log.info('security scan complete', {
      house, trigger, added: summary.added, seen: summary.seen,
      repos: summary.repos.map((r) => `${r.repo}:${r.checked}deps/${r.hits}hits`),
    });
    return summary;
  })().finally(() => { inFlight.delete(house); });
  inFlight.set(house, run);
  return run;
};

// impure — the machine's host inventory, written by whichever house's run
// measured it last (the kernel and the driver are the same for every house).
// Fail-soft: a run's record never depends on this one file.
const saveHost = async (inventory) => {
  if (!inventory) return;
  try {
    await saveState({ measuredAt: new Date().toISOString(), inventory }, hostPath());
  } catch (err) {
    log.warn('the host inventory could not be written — the run stands', { error: err.message });
  }
};

// impure — the ring buffer append, kept apart so a corrupt state read still
// lets THIS run's summary land (lastRunAt is the watch's heartbeat; losing
// it would re-run hourly, which is safe but loud).
const appendRun = async (statePath, summary) => {
  let state;
  try {
    state = await loadState(statePath);
  } catch (err) {
    log.error('scan state unreadable — starting a fresh record', { error: err.message });
    state = { lastRunAt: null, host: null, runs: [] };
  }
  state.lastRunAt = summary.startedAt;
  delete state.host; // the machine's file holds it now
  state.runs = [summary, ...(state.runs || [])].slice(0, RUNS_KEPT);
  return state;
};

/**
 * One house's tick: run when its last run is older than the 24h law. Exposed
 * for tests — the run itself is injected so the DUE LOGIC is what is proven.
 * @param {string} wallet - the house
 * @param {number} [nowMs]
 * @param {() => Promise<any>} [runFn]
 */
// impure
export const securityTick = async (wallet, nowMs = Date.now(), runFn = () => runSecurityScan({ wallet, trigger: 'scheduled' })) => {
  let state;
  try {
    state = await loadState(await statePathFor(wallet));
  } catch (err) {
    log.error('scan state unreadable — holding the watch this tick', { house: wallet, error: err.message });
    return null;
  }
  const lastMs = state.lastRunAt ? Date.parse(state.lastRunAt) : 0;
  if (nowMs - lastMs < RUN_EVERY_MS) return null; // fresh — nothing owed
  return runFn();
};

/**
 * The houses the watch walks: every house that seats a CSO or already holds
 * security records — after the machine-wide records are placed, so a house
 * whose office still sat in data/settings is not skipped. impure.
 * @returns {Promise<string[]>}
 */
export const securityHouses = async () => {
  await csoDesignation.seatedHouses();
  await settleLegacy('security');
  return officeHouses('security', 'cso');
};

// impure — one pass over every house this process SERVES (house-served.js:
// a house whose lanes this backend does not hold is another desk's watch,
// and its alerts are never ours to raise), each fail-soft: one house's
// broken state never holds another's watch. Exposed for tests: `runFor`
// stands in for the network scan so the WALK is what is proven.
export const tickSecurityHouses = async ({ nowMs = Date.now(), runFor } = {}) => {
  const { houses } = await readServed();
  for (const wallet of (await securityHouses()).filter((w) => houses.includes(w))) {
    const runFn = runFor ? () => runFor(wallet) : undefined;
    await securityTick(wallet, nowMs, runFn).catch((err) => log.error('security tick failed', { house: wallet, error: err.message }));
  }
};
const tickHouses = () => tickSecurityHouses();

/**
 * Start the watch. Never blocks the server's listen; the interval is unref'd
 * so it cannot hold the process open. Fires once immediately for every house
 * whose watch is overdue (boot after downtime), then hourly.
 * @returns {() => void} stop
 */
// impure
export const startSecurityScheduler = ({ intervalMs = TICK_MS } = {}) => {
  tickHouses().catch((err) => log.error('boot security scan failed', { error: err.message }));
  const timer = setInterval(() => {
    tickHouses().catch((err) => log.error('security tick failed', { error: err.message }));
  }, intervalMs);
  timer.unref?.();
  log.info('security watch standing', { everyMs: intervalMs, runEveryMs: RUN_EVERY_MS });
  return () => clearInterval(timer);
};
