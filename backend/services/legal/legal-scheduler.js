// Legal scheduler — the standing legal watch: at minimum every 24 hours (and
// at any boot that finds it overdue), read everything the house builds and
// ships and fold what needs a legal reading into the matters ledger.
//
// The watch is a PLATFORM guarantee, not a being's habit — the CSO's law,
// carried to the Praetor: the being only reads law when it has a turn, but
// the scan runs on the server's heartbeat.
//
// One run = the watched repos (the CSO's watch list, read-only) → per repo:
// licence scan + posture probe + build watch (commits since the last run) →
// ledger ingest → state append. Every leg is fail-soft: one repo's broken
// lockfile never costs another repo's findings, and every failure is
// written on the run's summary — a watch that hides its blindness is worse
// than none.
//
// ONE WATCH PER HOUSE (ruling, 2026-10-16): each house's run reads that house's
// own watch list into that house's own ledger, and keeps its own state
// (`<realm>/<wallet>/offices/legal/legal-watch-state.json`). The machine-wide
// state moves once to its house (house-office.js).

import { join } from 'path';
import { getSettingsDir } from '../data-root.js';
import { watchStoreFor } from '../security/watch-store.js';
import { matterLedgerFor } from './matter-ledger.js';
import { runLicenseScan } from './license-scan.js';
import { runPostureProbe } from './posture-probe.js';
import { runBuildWatch } from './build-watch.js';
import { cloDesignation, legacyCloPath } from './clo-designation.js';
import { readDoc, saveDoc } from './legal-store-io.js';
import { createLegacyMove, officeFile, officeHouses, settleLegacy } from '../house-office.js';
import { readServed, servedWallet } from '../house-served.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { createLogger } from '../logger.js';
import { reviewCommerce } from './commerce-review.js';

const log = createLogger('LegalScheduler');

export const TICK_MS = 60 * 60 * 1000; // check hourly…
export const RUN_EVERY_MS = 24 * 60 * 60 * 1000; // …run daily: […]
const RUNS_KEPT = 20;
const EMPTY_STATE = Object.freeze({ lastRunAt: null, repos: {}, runs: [] });

const STATE_NAME = 'legal-watch-state.json';
const DEFAULT_LEGACY_STATE_PATH = join(getSettingsDir(), STATE_NAME);

// The pre-2026-10-16 machine state moves once to its house; read per call so
// tests never touch the operator's live one.
const settleLegacyState = createLegacyMove({
  office: 'legal',
  name: STATE_NAME,
  legacyPath: () => process.env.NEUMA_LEGAL_WATCH_STATE_PATH || DEFAULT_LEGACY_STATE_PATH,
  legacySeatPath: legacyCloPath,
});

const statePathOf = (wallet) => officeFile(wallet, 'legal', STATE_NAME);

// impure — missing = never run; corrupt THROWS (a watch that cannot say when
// it last ran must be loud, never assume it is fresh).
const loadState = (path) => readDoc(path, { ...EMPTY_STATE, repos: {}, runs: [] });

/**
 * The desk's and the briefing's read of a house's watch state. impure.
 * @param {string} wallet - the house
 */
export const readLegalWatchState = async (wallet) => {
  const path = statePathOf(wallet);
  await settleLegacyState();
  return loadState(path);
};

/**
 * Every house whose legal office stands (a seated CLO, or matters on
 * record), after the machine-wide records have gone home. impure.
 * @returns {Promise<string[]>} house wallets
 */
export const legalHouses = async () => {
  await cloDesignation.seatedHouses();
  await settleLegacy('legal');
  return officeHouses('legal', 'clo');
};

// One run at a time per house: a run walks whole repos.
const inFlight = new Map();

// THE OPERATOR'S EAR — a run that lands NEW critical/high matters tells the
// house's operator directly, once per run, when that house seats a CLO. No
// seat = no address, and an unaddressed card reaches nobody. Fail-soft: the
// ledger's record never depends on a card.
// impure — exposed for tests.
export const alertOnSeriousMatters = async (added, wallet) => {
  const serious = (added || []).filter((e) => e.severity === 'critical' || e.severity === 'high');
  if (!serious.length) return;
  try {
    const officer = await cloDesignation.getOfficer(wallet);
    if (!officer?.laneId) {
      log.info('new serious legal matters, no CLO seated in this house — the alert has no address', { count: serious.length });
      return;
    }
    await notifyOperator({
      wallet: wallet.toLowerCase(),
      kind: KIND.legalAlert,
      standing: STANDING.system,
      title: `Legal watch: ${serious.length} new matter${serious.length === 1 ? '' : 's'} to read`,
      detail: serious.slice(0, 3).map((e) => `${e.severity.toUpperCase()} ${e.title}`).join(' · ')
        + (serious.length > 3 ? ` · +${serious.length - 3} more in the ledger` : ''),
      ref: { critical: serious.filter((e) => e.severity === 'critical').length, high: serious.filter((e) => e.severity === 'high').length },
    });
  } catch (err) {
    log.warn('the legal alert could not be raised — the ledger still holds the matters', { error: err.message });
  }
};

// pure — this run's summary folded into the state ring.
const withRun = (state, summary, sinceByRepo) => ({
  lastRunAt: summary.startedAt,
  repos: { ...(state.repos || {}), ...sinceByRepo },
  runs: [summary, ...(state.runs || [])].slice(0, RUNS_KEPT),
});

/**
 * One house's full legal watch pass. Never throws on a leg; a missing wallet
 * rejects (no house, no watch).
 * impure — disk, git
 * @param {{wallet: string, trigger?: string, watchStore?: Object, ledger?: Object, statePath?: string}} opts
 *   watchStore/ledger/statePath default to the house's own
 * @returns {Promise<Object>} the run summary (also appended to the state)
 */
export const runLegalWatch = ({ wallet, trigger = 'manual', watchStore, ledger, statePath } = {}) => {
  let key;
  try {
    key = statePathOf(wallet);
  } catch (err) {
    return Promise.reject(err);
  }
  if (inFlight.has(key)) return inFlight.get(key);
  const run = (async () => {
    statePath = statePath || key;
    await settleLegacyState();
    watchStore = watchStore || await watchStoreFor(wallet);
    ledger = ledger || await matterLedgerFor(wallet);
    const startedAt = new Date().toISOString();
    const summary = { startedAt, trigger, repos: [], added: 0, seen: 0, finishedAt: null, error: null };
    let state;
    try {
      state = await loadState(statePath);
    } catch (err) {
      log.error('legal watch state unreadable — this run reads the first-look window', { error: err.message });
      state = { ...EMPTY_STATE, repos: {}, runs: [] };
    }

    let watch;
    try {
      watch = await watchStore.load();
    } catch (err) {
      summary.error = `watch list unreadable: ${err.message}`;
      summary.finishedAt = new Date().toISOString();
      await saveDoc(statePath, withRun(state, summary, {}));
      return summary;
    }

    const findings = [];
    const sinceByRepo = {};
    for (const repo of watch.repos) {
      const since = state.repos?.[repo.id]?.buildSince || null;
      const licences = await runLicenseScan(repo);
      const [posture, build] = await Promise.all([
        runPostureProbe(repo, { shippedNames: licences.shippedNames || [] }),
        runBuildWatch(repo, { since }),
      ]);
      const leg = {
        repo: repo.id,
        shipped: licences.shipped, byClass: licences.byClass,
        papers: posture.papers,
        commits: build.commits, since: build.since,
        matters: licences.matters.length + posture.matters.length + build.matters.length,
        error: [licences.error, posture.error, build.error].filter(Boolean).join(' | ') || null,
      };
      findings.push(...licences.matters, ...posture.matters, ...build.matters);
      summary.repos.push(leg);
      // the build window only moves when its read succeeded — a failed git
      // log re-reads the same span next run, never skips it
      if (!build.error) sinceByRepo[repo.id] = { buildSince: startedAt };
    }

    // THE COMMERCE LEG (the house economy's Stage 4): the house's deals,
    // invoices, money in, raises and replies, read for what needs a legal
    // reading — fail-soft like every leg, its blindness written on the run.
    try {
      const commerce = await reviewCommerce(wallet);
      findings.push(...commerce.matters);
      summary.commerce = { matters: commerce.matters.length, sanctions: commerce.sanctions };
    } catch (err) {
      summary.commerce = { matters: 0, error: err.message };
    }

    if (findings.length) {
      try {
        const { added, seen } = await ledger.ingest(findings);
        summary.added = added.length;
        summary.seen = seen;
        await alertOnSeriousMatters(added, wallet);
      } catch (err) {
        summary.error = `ledger ingest failed: ${err.message}`;
        log.error('legal findings could not land in the ledger', { error: err.message });
        // nothing landed: the build window must not move past unrecorded work
        for (const id of Object.keys(sinceByRepo)) delete sinceByRepo[id];
      }
    }

    summary.finishedAt = new Date().toISOString();
    await saveDoc(statePath, withRun(state, summary, sinceByRepo));
    log.info('legal watch complete', { house: wallet, trigger, added: summary.added, seen: summary.seen, repos: summary.repos.map((r) => `${r.repo}:${r.matters}`) });
    return summary;
  })().finally(() => { inFlight.delete(key); });
  inFlight.set(key, run);
  return run;
};

/**
 * One house's tick: run when its last run is older than a day. Exposed for
 * tests — the run is injected so the DUE LOGIC is what is proven.
 * impure
 * @param {string} wallet - the house
 */
export const legalTick = async (wallet, nowMs = Date.now(), runFn = () => runLegalWatch({ wallet, trigger: 'scheduled' }), statePath) => {
  let state;
  try {
    state = statePath ? await loadState(statePath) : await readLegalWatchState(wallet);
  } catch (err) {
    log.error('legal watch state unreadable — holding the watch this tick', { error: err.message });
    return null;
  }
  const lastMs = state.lastRunAt ? Date.parse(state.lastRunAt) : 0;
  if (nowMs - lastMs < RUN_EVERY_MS) return null;
  return runFn();
};

/**
 * One tick for every house this process SERVES whose legal office stands —
 * never a house it does not run (house-served.js: a house is served when its
 * wallet owns a lane on a ground this process serves; one backend may serve
 * several). Each house fail-soft: one house's broken state never holds
 * another's watch, and an alert only ever goes to a served house. impure.
 * @param {{phase?: string, runFn?: (wallet: string) => Promise<any>}} [opts]
 *   runFn — the run per house (exposed so the walk is provable without a scan)
 * @returns {Promise<string[]>} the houses ticked
 */
export const tickLegalHouses = async ({ phase = 'legal tick', runFn } = {}) => {
  const served = await readServed();
  const houses = (await legalHouses()).filter((wallet) => servedWallet(served, wallet));
  for (const wallet of houses) {
    await legalTick(wallet, Date.now(), runFn ? () => runFn(wallet) : undefined)
      .catch((err) => log.error(`${phase} failed`, { house: wallet, error: err.message }));
  }
  return houses;
};

/**
 * Start the watch. Never blocks listen; the interval is unref'd. Fires once
 * now when overdue (boot after downtime), then hourly.
 * impure
 * @returns {() => void} stop
 */
export const startLegalScheduler = ({ intervalMs = TICK_MS } = {}) => {
  tickLegalHouses({ phase: 'boot legal watch' }).catch((err) => log.error('boot legal watch failed', { error: err.message }));
  const timer = setInterval(() => {
    tickLegalHouses().catch((err) => log.error('legal tick failed', { error: err.message }));
  }, intervalMs);
  timer.unref?.();
  log.info('legal watch standing', { everyMs: intervalMs, runEveryMs: RUN_EVERY_MS });
  return () => clearInterval(timer);
};
