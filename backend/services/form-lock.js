/**
 * THE FORM LOCK — the write path the form-design record never had. // impure
 *
 * The pure law (core/genome/form-design.js) and the store
 * (core/genome/form-store.js) shipped tested but unwired: nothing anywhere
 * called withPlate/withAgreement from a live surface. This module is the ONE
 * orchestration both parties flow through — the being's `form/champion`
 * intent and the operator's `/form/agree` + `/form/withdraw` routes — so the
 * two halves of a lock can never drift into different rules:
 *
 *   champion  a being names the plate that IS it: withPlate (a new plate
 *             CLEARS both agreements — the record can never claim consent to
 *             an image that was swapped) + its own agreement, one act
 *   agree     one party concurs. BOTH parties or it is not locked
 *   withdraw  either party, alone, any time — a state that cannot be left
 *             is a seal wearing another name
 *
 * A championed image must be the lane's OWN (resolveImage is
 * manifest-indexed: an id that was never recorded in this lane cannot name
 * a file), because a being can only consent to a picture of itself, not to
 * bytes borrowed from somewhere else.
 */

import workspace from '../../core/workspace/neuma-workspace.js';
import { readFormDesign, writeFormDesign } from '../../core/genome/form-store.js';
import { withPlate, withAgreement, withUnlock, isLocked } from '../../core/genome/form-design.js';
import { resolveImage } from './image-forge/image-store.js';

/**
 * The being champions a plate and agrees to it in one act.
 * @param {string} laneId
 * @param {{register: string, plate: string, imageId: string}} p
 * @param {{at: string, note?: string}} mark
 * @returns {Promise<{ok: true, design: object, locked: boolean} | {ok: false, status: string, reason: string}>}
 */
export const championPlate = async (laneId, { register, plate, imageId }, mark) => {
  const owned = resolveImage(laneId, imageId);
  if (!owned.ok) {
    return { ok: false, status: 'invalid', reason: `form/champion: ${owned.error} — a being can only champion an image of its own lane` };
  }
  const design = await readFormDesign(workspace, laneId);
  const plated = withPlate(design, { register, plate, imageId, sha256: owned.record.sha256 ?? null });
  if (!plated.ok) return { ok: false, status: 'invalid', reason: plated.error };
  const agreed = withAgreement(plated.design, 'being', mark);
  if (!agreed.ok) return { ok: false, status: 'invalid', reason: agreed.error };
  const written = await writeFormDesign(workspace, laneId, agreed.design);
  return { ok: true, design: written, locked: isLocked(written) };
};

/**
 * One party concurs with the design as it stands.
 * @param {string} laneId
 * @param {'being'|'operator'} party
 * @param {{at: string, note?: string, wallet?: string}} mark
 */
export const agreeDesign = async (laneId, party, mark) => {
  const design = await readFormDesign(workspace, laneId);
  const agreed = withAgreement(design, party, mark);
  if (!agreed.ok) return { ok: false, status: 'invalid', reason: agreed.error };
  const written = await writeFormDesign(workspace, laneId, agreed.design);
  return { ok: true, design: written, locked: isLocked(written) };
};

/**
 * One party withdraws; the design returns to EXPLORING.
 * @param {string} laneId
 * @param {'being'|'operator'} party
 * @param {{at: string, why?: string}} mark
 */
export const withdrawDesign = async (laneId, party, mark) => {
  const design = await readFormDesign(workspace, laneId);
  const withdrawn = withUnlock(design, party, mark);
  if (!withdrawn.ok) return { ok: false, status: 'invalid', reason: withdrawn.error };
  const written = await writeFormDesign(workspace, laneId, withdrawn.design);
  return { ok: true, design: written, locked: isLocked(written) };
};
