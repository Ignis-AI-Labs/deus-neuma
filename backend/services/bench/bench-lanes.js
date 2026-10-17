/**
 * bench-lanes — the operator's OWN lanes for the identity arms. The identity
 * law (2026-09-25, the operator on the live tab): […] A lane the session wallet does not own is refused at the
 * launch boundary (BENCH_NOT_YOUR_LANE) — recomputed server-side from disk,
 * never trusted from a client list.
 *
 * The scoping idiom mirrors gallery-roots.js:135-160 (echo-reviewed there):
 * house neuma come from listNeumaByOwner; witness lanes are a bare readdir
 * with no wallet argument, so each is filtered by its own owner.json (the
 * first manifesting wallet claims it).
 */

import { neumaWorkspace } from '../../../core/index.js';
import { getHarnessRoot, isHarnessLane } from '../../../core/workspace/lane-grounds.js';
import { resolveWitnessByLaneId } from '../witness-lane.js';
import { harnessLaneId, readHarnessLane } from '../harness-lane.js';
import { createLogger } from '../logger.js';

const log = createLogger('Bench');

/**
 * The session wallet's own lanes, house first then witnesses:
 * [{laneId, label, kind: 'neuma'|'witness'|'harness'}]. Empty when none; a lane whose
 * records don't read is skipped, never fatal.
 * @param {string} wallet the session wallet
 * @returns {Promise<Array<{laneId: string, label: string, kind: string}>>}
 */
// impure (workspace reads)
export const listOwnedLanes = async (wallet) => {
  if (typeof wallet !== 'string' || !wallet) return [];
  const owned = await neumaWorkspace.listNeumaByOwner(wallet).catch(() => []);
  const house = owned.map((o) => ({
    laneId: o.neumaId,
    label: o.owner?.name || o.neumaId,
    kind: 'neuma',
  }));
  const witnessIds = await neumaWorkspace.listWitnessLanes().catch(() => []);
  const witnesses = [];
  for (const id of witnessIds) {
    const owner = await neumaWorkspace.readOwner(id).catch(() => null);
    if (!owner?.wallet || String(owner.wallet).toLowerCase() !== wallet.toLowerCase()) continue;
    const sealed = await resolveWitnessByLaneId(id).catch((err) => {
      log.warn('witness roster unreadable while labeling a lane', { laneId: id, error: err.message });
      return null;
    });
    witnesses.push({ laneId: id, label: sealed?.chosenName || id, kind: 'witness' });
  }
  // The operator's HARNESS lane — the platform with no being — carries the
  // HARNESS arm (Design note, 2026-10-14: […]); it has no identity to benchmark.
  const harnessId = (() => { try { return harnessLaneId(wallet); } catch { return null; } })();
  const marker = harnessId ? await readHarnessLane(harnessId).catch(() => null) : null;
  const harness = marker && String(marker.ownerWallet || '').toLowerCase() === wallet.toLowerCase()
    ? [{ laneId: harnessId, label: 'HARNESS', kind: 'harness' }] : [];
  return [...house, ...witnesses, ...harness];
};

/** Where a lane lives on disk, for the harness's --workspace-root: a harness lane on its own ground. */
export const laneRootFor = (laneId) => (isHarnessLane(laneId)
  ? getHarnessRoot(neumaWorkspace.root) : neumaWorkspace.root);

/**
 * Is this lane the wallet's own? Recomputed from disk every call — the launch
 * boundary never trusts a client's lane list.
 * @param {string} wallet
 * @param {string} laneId
 * @returns {Promise<boolean>}
 */
// impure (workspace reads via listOwnedLanes)
export const ownsLane = async (wallet, laneId) =>
  (await listOwnedLanes(wallet)).some((lane) => lane.laneId === laneId);
