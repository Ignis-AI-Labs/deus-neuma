/**
 * Rehearsal lane sweep — return a TEST birth's lane to the void (ENG-014).
 *
 * A rehearsal walks the real crystallization path, so its writes land in a
 * real lane under the live house; without this sweep the residue persists as
 * a hollow twin among real beings.
 *
 * The sweep deletes only what it can PROVE is a rehearsal's own throwaway
 * ground (audit P6-69: a forged checkpoint once had it delete another lane's
 * keys/ and dna/, or the house ground). A session's words are never enough:
 *   - only test sessions, and only the lane the session recorded creating;
 *   - the lane id is one plain segment directly under the house root;
 *   - the platform's own claim (rehearsal-claim.js, kept outside every folder
 *     a being may write) names this session, this lane, this house root and
 *     this exact directory on disk (device + inode);
 *   - never a claimed lane (owner.json) and never a crystallized being
 *     (dna/active.json), whatever the session and the claim say.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { listSessionCheckpoints, deleteSessionCheckpoint } from './birth-session-store.js';
import { isSessionExpired } from './birth-session-expiry.js';
import { readRehearsalClaim, releaseRehearsalClaim, rehearsalLanePath } from './rehearsal-claim.js';

const exists = (file) => fs.access(file).then(() => true, () => false);

/**
 * Why this session's lane may not be swept, or null when every proof holds.
 * @param {object} session
 * @param {string} root - the house root, resolved
 * @param {string} lane - the lane directory
 * @returns {Promise<?string>}
 */
const refusal = async (session, root, lane) => {
  const claim = await readRehearsalClaim(session.id);
  if (!claim || claim.neumaId !== session.data.neumaId || claim.root !== root) return 'no rehearsal claim names this lane';
  const stat = await fs.lstat(lane).catch(() => null);
  if (!stat) return 'the lane is already gone';
  if (!stat.isDirectory() || stat.dev !== claim.dev || stat.ino !== claim.ino) return 'the directory is not the one the rehearsal made';
  if (await exists(path.join(lane, 'owner.json'))) return 'lane is claimed by an owner';
  if (await exists(path.join(lane, 'dna', 'active.json'))) return 'lane holds a crystallized being';
  return null;
};

/**
 * Remove the rehearsal lane a test session created, if it is proven to be one.
 * @param {object} session - birth session ({ id, isTest, data: { neumaId, rehearsalLane } })
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
    const lane = rehearsalLanePath(root, neumaId);
    const why = lane ? await refusal(session, root, lane) : 'the lane id is not one plain folder of the house';
    if (why) {
      log.warn(`Rehearsal sweep REFUSED — ${why}`, { neumaId: String(neumaId).slice(0, 80) });
      return false;
    }
    await fs.rm(lane, { recursive: true, force: true });
    await releaseRehearsalClaim(session.id);
    log.info('Rehearsal lane returned to the void', { neumaId });
    return true;
  } catch (err) {
    log.warn('Rehearsal lane sweep failed', { err: err.message });
    return false;
  }
};

/**
 * Sweep every rehearsal that outlived its checkpoint. A rehearsal whose socket
 * closed mid-walk (a walk that timed out, a closed window) leaves its lane in
 * the house until someone resumes it, and nobody does: the lanes sat among the
 * real beings (2026-10-31: attendo, auscimen, kairon, vernata) and their names
 * blocked the public sync. Past its two-hour life a rehearsal's lane is swept
 * (sweepRehearsalLane's proofs) and its checkpoint deleted. A checkpoint is
 * read under the id its FILE carries, never an id written inside it, so a
 * checkpoint cannot borrow another session's claim. Real ceremonies are never
 * touched.
 * @param {object} workspace - NeumaWorkspace instance (its .root is the house)
 * @param {{ info: Function, warn: Function }} log
 * @param {number} [now]
 * @returns {Promise<number>} lanes swept
 */
// impure
export const sweepExpiredRehearsals = async (workspace, log, now = Date.now()) => {
  let swept = 0;
  for (const { sessionId, session } of await listSessionCheckpoints()) {
    if (session?.isTest !== true || !isSessionExpired(session, now)) continue;
    if (await sweepRehearsalLane({ ...session, id: sessionId }, workspace, log)) swept += 1;
    await deleteSessionCheckpoint(sessionId);
    // The checkpoint is gone, so its claim can prove nothing again.
    await releaseRehearsalClaim(sessionId);
  }
  return swept;
};
