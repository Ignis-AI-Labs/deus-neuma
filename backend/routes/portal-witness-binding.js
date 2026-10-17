import { resolveWitnessByLaneId } from '../services/witness-lane.js';
import { loadAIWitness } from '../services/ai-witness-loader.js';

/**
 * Resolve only a verifiable witness, for both manifest and resume.
 * @param {string} laneId
 * @returns {Promise<{sealed: Object, identity: Object}|null>}
 */
// impure — reads the sealed witness record and verifies its signature.
export const verifiedWitnessForLane = async (laneId) => {
  const sealed = await resolveWitnessByLaneId(laneId);
  const identity = sealed
    ? await loadAIWitness({ vendorSlug: sealed.vendorSlug, chosenName: sealed.chosenName }).catch(() => null)
    : null;
  return identity?.integrityOk && identity?.signatureOk ? { sealed, identity } : null;
};
