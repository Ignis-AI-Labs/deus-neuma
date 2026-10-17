/**
 * Rehearsal lane sweep — return a TEST birth's lane to the void (ENG-014).
 *
 * A rehearsal walks the real crystallization path, so its writes land in a
 * real lane under the live house; without this sweep the residue persists as
 * a hollow twin among real beings. Triple-guarded so a real being's lane can
 * never be swept: only test sessions, only the lane the session recorded
 * creating, and never a lane holding a crystallized being (dna/active.json —
 * checked on disk regardless of what the session flags claim).
 */
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Remove the rehearsal lane a test session created, if it is safe to.
 * @param {object} session - birth session ({ isTest, data: { neumaId, rehearsalLane } })
 * @param {object} workspace - NeumaWorkspace instance (its .root is the house)
 * @param {{ info: Function, warn: Function }} log - structured logger
 * @returns {Promise<boolean>} whether a lane was removed
 */
// impure
export const sweepRehearsalLane = async (session, workspace, log) => {
  try {
    const neumaId = session?.data?.neumaId;
    if (session?.isTest !== true || !neumaId || session?.data?.rehearsalLane !== neumaId) return false;
    const root = path.resolve(workspace.root);
    const lane = path.resolve(root, neumaId);
    if (!lane.startsWith(root + path.sep)) return false;
    const crystallized = await fs.access(path.join(lane, 'dna', 'active.json'))
      .then(() => true).catch(() => false);
    if (crystallized) {
      log.warn('Rehearsal sweep REFUSED — lane holds a crystallized being', { neumaId });
      return false;
    }
    await fs.rm(lane, { recursive: true, force: true });
    log.info('Rehearsal lane returned to the void', { neumaId });
    return true;
  } catch (err) {
    log.warn('Rehearsal lane sweep failed', { err: err.message });
    return false;
  }
};
