/**
 * Skies persistence — write a being's many-skies reading into its own lane.
 *
 * PLAINTEXT BY LAW: the skies are pure functions of the birth moment, which
 * already lives in plaintext in the lane's identity/genesis-seal.json — no new
 * information is exposed. Anything location-bearing (angles, lots, sunrise
 * vara) must ride the ENCRYPTED natal path instead (cosmos/natal.json).
 *
 * Same shape as the natal ops: idempotent by default (a recorded sky is a
 * record — re-derivation is a deliberate --overwrite), never throws into a
 * birth (callers wrap non-critically), and works for both standard workspace
 * lanes and flat witness folders.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { buildSkies } from './skies/index.js';
import { birthMomentFromSeal } from './natal-record.js';

const skiesPath = (root, neumaId) => path.join(root, neumaId, 'cosmos', 'skies.json');

/**
 * Atomically write a value as pretty-printed JSON (tmp + rename). A bare
 * fs.writeFile on a whole-file store is a crash-mid-write data-loss door
 * (AGENTS.md § Realm Persistence); tmp + rename is atomic on the same
 * filesystem, so a reader only ever sees the old file or the new one, never a
 * truncated one. The backend's writeJsonAtomic lives across the layer
 * boundary; core owns its own copy rather than importing upward.
 * The caller MUST ensure the target directory already exists.
 * @param {string} target - absolute destination path
 * @param {*} value - a JSON-serialisable value
 * @returns {Promise<void>}
 */
export const writeJsonAtomic = async (target, value) => {
  const tmp = `${target}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, target);
};

/**
 * Record the skies for a being from a birth moment.
 * @param {string} workspaceRoot - the workspaces root directory
 * @param {string} neumaId - the being's lane id
 * @param {object} birthMoment - sealed birth moment ({epochMs, utc, zone, offsetMinutes})
 * @param {{overwrite?: boolean}} [opts]
 * @returns {Promise<{written: boolean, skies: object|null, path: string}>}
 */
export const recordSkies = async (workspaceRoot, neumaId, birthMoment, { overwrite = false } = {}) => {
  const target = skiesPath(workspaceRoot, neumaId);
  if (!overwrite) {
    try {
      await fs.access(target);
      return { written: false, skies: null, path: target }; // already recorded — idempotent skip
    } catch { /* not yet recorded — proceed */ }
  }
  const skies = buildSkies(birthMoment);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await writeJsonAtomic(target, skies);
  return { written: true, skies, path: target };
};

/**
 * Backfill a being's skies from its own sealed birth moment.
 * @param {string} workspaceRoot
 * @param {string} neumaId
 * @param {{overwrite?: boolean}} [opts]
 */
export const backfillSkies = async (workspaceRoot, neumaId, opts = {}) => {
  const sealRaw = await fs.readFile(
    path.join(workspaceRoot, neumaId, 'identity', 'genesis-seal.json'), 'utf8');
  const seal = JSON.parse(sealRaw);
  const birthMoment = birthMomentFromSeal(seal);
  if (!birthMoment) throw new Error(`no birth moment in seal for ${neumaId}`);
  return recordSkies(workspaceRoot, neumaId, birthMoment, opts);
};

export const readSkies = async (workspaceRoot, neumaId) => {
  try {
    return JSON.parse(await fs.readFile(skiesPath(workspaceRoot, neumaId), 'utf8'));
  } catch {
    return null;
  }
};
