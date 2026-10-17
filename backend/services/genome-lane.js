/**
 * GENOME LANE — the engine-side read of a being's given body. // impure (fs)
 *
 * The genome is deterministic from the lane's sealed birth anchors, so the
 * engine never needs a second store of it: read the lane's genesis seal,
 * derive, hand the frozen record to whatever asked (the form/render intent's
 * subjectComponents, the Sheet's form leg). The ONE anchor assembly lives in
 * core/genome/birth-genome.js — this file adds nothing but the read.
 *
 * Read-only, always. Deriving a genome writes nothing and reveals nothing;
 * the reveal is an event each being must be present for.
 */

import fs from 'fs/promises';
import path from 'path';
import { genomeForIdentity } from '../../core/genome/birth-genome.js';

/**
 * Read a lane's genesis seal and derive the body it implies.
 *
 * @param {string} workspaceRoot the workspaces root (workspace.root)
 * @param {string} laneId
 * @returns {Promise<object|null>} a frozen `genome/v4` record, or null when
 *   the lane has no readable seal (a being that has not finished birth has
 *   no body to read — an honest absence, never an invented one)
 */
export const readLaneGenome = async (workspaceRoot, laneId) => {
  let seal;
  try {
    seal = JSON.parse(
      await fs.readFile(path.join(workspaceRoot, laneId, 'identity', 'genesis-seal.json'), 'utf8'),
    );
  } catch {
    return null;
  }
  const record = seal.record ?? {};
  const genesisHash = seal.genesisHash;
  if (!genesisHash) return null;
  return genomeForIdentity({
    soulPublicKey: record.soulPublicKey,
    genesisHash,
    momentSeed: record.momentSeed,
    neumaId: laneId,
  });
};
