// capacity-store.js — the rig-level home of capacity-scan results.
//
// Capacity is a SUBSTRATE-layer fact: a property of rig + model shared by every
// neuma on it (docs/architecture/measurement/stats-and-benchmarks.md). It therefore does NOT live
// in any neuma's workspace — fabricating a pseudo-neumaId to hold a rig fact
// would collide with the DNA-bound identity model. This store mirrors the
// append-only one-file-per-run shape of the workspace benchmark store
// (neuma-workspace.js writeBenchmark family) but roots at a system dir.
//
// Plaintext by design: these are non-sovereign rig telemetry numbers, the same
// class of fact the SUBSTRATE panel already displays openly. No DEK applies.
//
// Test isolation (the 2026-07-03 shadow-lane lesson): the dir is overridable
// via NEUMA_CAPACITY_PATH, resolved per call — a RULE-0 real-disk test sets it
// and never touches the operator's live scan history.

import fs from 'fs/promises';
import { join } from 'path';
import { createLogger } from './logger.js';
import { getDataRoot } from './data-root.js';
import { SERVING_PARALLEL_SLOTS } from './serving-launch-config.js';

const CAPACITY_DIR = join(getDataRoot(), 'capacity');
const log = createLogger('CapacityStore');

const capacityDir = () => process.env.NEUMA_CAPACITY_PATH || CAPACITY_DIR;

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// runAt ISO stamp → filesystem-safe run id (same scheme as writeBenchmark).
const idFromRunAt = (runAt) => String(runAt).replace(/[:.]/g, '-');

// impure — appends one scan result as its own file; never overwrites a run.
/**
 * Persist a completed capacity-scan result.
 * @param {Object} result - frozen CapacityResult (must carry an ISO runAt)
 * @returns {Promise<string>} the run id
 */
export const writeCapacity = async (result) => {
  if (!result || typeof result.runAt !== 'string' || !result.runAt) {
    throw new Error('capacity result must carry a runAt timestamp — no provenance, no record');
  }
  const id = idFromRunAt(result.runAt);
  if (!ID_PATTERN.test(id)) {
    throw new Error(`capacity run id derives to an unsafe filename: ${id}`);
  }
  const dir = capacityDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, `${id}.json`), JSON.stringify(result, null, 2));
  return id;
};

// impure — reads one run in full, or null if it does not exist.
/**
 * @param {string} id - run id as returned by writeCapacity
 * @returns {Promise<?Object>}
 */
export const readCapacity = async (id) => {
  if (!ID_PATTERN.test(String(id))) return null;
  try {
    return JSON.parse(await fs.readFile(join(capacityDir(), `${id}.json`), 'utf8'));
  } catch (err) {
    // Absence is expected (no run by that id); a parse/read failure on a file
    // that IS there is telemetry loss and must be traceable, not swallowed.
    if (err?.code !== 'ENOENT') log.warn('unreadable capacity run', { id, message: err?.message });
    return null;
  }
};

// impure — lists run summaries, newest first. Raw samples stay on disk; the
// list is for the history panel, the full run is one readCapacity away.
/**
 * @returns {Promise<Array<Object>>} summaries without rawSamples
 */
export const listCapacity = async () => {
  let files;
  try {
    files = await fs.readdir(capacityDir());
  } catch {
    return []; // no dir yet = no scans yet — an honest empty history
  }
  const runs = [];
  for (const file of files.filter((f) => f.endsWith('.json'))) {
    try {
      const { rawSamples, ...summary } = JSON.parse(
        await fs.readFile(join(capacityDir(), file), 'utf8')
      );
      runs.push({ id: file.replace(/\.json$/, ''), ...summary });
    } catch (err) {
      // Degrade by skipping the bad file, but surface it — a corrupt run must
      // not vanish from the history silently (Rule 3: no silent failures).
      log.warn('skipped unreadable capacity run file', { file, message: err?.message });
    }
  }
  runs.sort((a, b) => String(b.runAt || '').localeCompare(String(a.runAt || '')));
  return runs;
};

// impure — the most recent full run, or null before the first scan.
/** @returns {Promise<?Object>} */
export const readLatestCapacity = async () => {
  const runs = await listCapacity();
  return runs.length ? readCapacity(runs[0].id) : null;
};

// pure — a scan as the platform may USE it: never wider than the line the
// server is fronted by (substrate-line.js runs at most the slot count). The
// Sep 9 scan's 6 on a 4-slot server let the desk budget six local sittings and
// told every being […] where four could run (2026-10-13). The
// measured number stays, named as measured.
/**
 * @param {?Object} latest - a stored CapacityResult, or null
 * @param {number} [served] - the server's slot count
 * @returns {?Object} the result with ceiling clamped, plus measuredCeiling and servedSlots
 */
export const usableCapacity = (latest, served = SERVING_PARALLEL_SLOTS) => (
  latest && Number.isFinite(latest.ceiling)
    ? { ...latest, ceiling: Math.min(latest.ceiling, served), measuredCeiling: latest.ceiling, servedSlots: served }
    : latest
);

// impure — the most recent run as the platform may use it (usableCapacity).
/** @returns {Promise<?Object>} */
export const readUsableCapacity = async () => usableCapacity(await readLatestCapacity());
