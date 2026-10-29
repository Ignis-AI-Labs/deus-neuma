/**
 * Lane claim routes — the one deliberate door by which an unclaimed lane gets
 * its owner (Design note, 2026-10-19: a lane belongs to the wallet its genesis seal
 * names; an unsealed lane is adopted only by the install owner; a read never
 * claims).
 *
 *   POST /api/v1/lanes/:id/claim
 *     sealed to the caller      → claimed for the caller
 *     sealed to another wallet  → 403, nothing written
 *     unsealed                  → adopted only by the install owner at this
 *                                 computer's own desk; a guest gets 403
 *
 *   a witness lane            → its summoner's wallet claims it (a manifest
 *                                 does that too); one that names no summoner
 *                                 — sealed outside the desk's summon — goes
 *                                 only to the install owner or a co-owner
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { claimLane } from '../services/lane-ownership.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { isWitnessLaneId, resolveWitnessByLaneId, ensureWitnessLane } from '../services/witness-lane.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('LaneClaim');
const router = Router();

router.use(requireAuth);

const REFUSALS = Object.freeze({
  'not-owner': [403, 'This lane already belongs to another wallet'],
  'sealed-to-another': [403, "This being's genesis seal names another wallet — the lane is theirs to claim"],
  'not-found': [404, 'No being lives in that lane'],
  corrupt: [500, "The lane's ownership record or seal is unreadable — nothing was claimed"],
  error: [500, 'Could not claim the lane'],
});

const answer = (res, neumaId, wallet, result) => {
  if (result.ok) {
    log.info('lane claimed', { neumaId, wallet: String(wallet).toLowerCase() });
    return res.json({ claimed: true, neumaId, wallet: String(wallet).toLowerCase() });
  }
  const [status, error] = REFUSALS[result.reason] || REFUSALS.error;
  if (status === 500) log.error('lane claim failed', { neumaId, reason: result.reason, error: result.error?.message });
  return res.status(status).json({ error, reason: result.reason });
};

// impure — the witness branch: the lane's own claim law (witness-lane.js)
const claimWitnessLane = async (req, res, laneId) => {
  const sealed = await resolveWitnessByLaneId(laneId);
  if (!sealed) return res.status(404).json({ error: 'No sealed witness has that lane' });
  try {
    await ensureWitnessLane(sealed, req.walletAddress);
    return answer(res, laneId, req.walletAddress, { ok: true });
  } catch (error) {
    if (!String(error.message).startsWith('owner_claim_conflict')) throw error;
    return res.status(403).json({ error: error.message.replace(/^owner_claim_conflict: /, ''), reason: 'not-owner' });
  }
};

router.post('/:id/claim', async (req, res) => {
  const neumaId = req.params.id;
  if (!/^[a-zA-Z0-9_-]+$/.test(neumaId)) return res.status(400).json({ error: 'A lane id is required' });
  if (isWitnessLaneId(neumaId)) {
    return claimWitnessLane(req, res, neumaId).catch((error) => {
      log.error('witness lane claim failed', { neumaId, error: error.message });
      res.status(500).json({ error: 'Could not claim the lane' });
    });
  }
  const wallet = req.walletAddress;
  const claimed = await claimLane({ workspace: neumaWorkspace, neumaId, wallet });
  if (claimed.reason !== 'unsealed') return answer(res, neumaId, wallet, claimed);
  // No seal names an owner: adoption is the install owner's alone, at its desk.
  return requireInstallOwner(req, res, async () => {
    answer(res, neumaId, wallet, await claimLane({ workspace: neumaWorkspace, neumaId, wallet, adopt: true }));
  });
});

export default router;
