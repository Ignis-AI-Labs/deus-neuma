/**
 * A HOUSE for position tests. Social channels, the mailbox and sector crews
 * are a house's own, kept in its operator's realm dir and read through the
 * acting lane's owner (backend/services/social/house-positions.js). This
 * pins the realm to tmp and records lanes as the house's own: the same
 * owner.json records a live house holds. Real disk, no mocks.
 */
import fs from 'fs/promises';
import path from 'path';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import workspace, { setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';

/** The operator wallet a position-test house is owned by. */
export const POSITION_HOUSE = `0x${'7a'.repeat(20)}`;

/**
 * Pin the realm and the witnesses' ground under `dir` for the test's
 * lifetime, so a witness lane the house seats is a tmp lane; restore hands
 * the witnesses' ground back to the engine default (for suites that never
 * set one themselves). impure.
 * @param {string} dir - a temp dir the test owns
 * @returns {{wallet: string, restore: () => void}}
 */
export const usePositionHouse = (dir) => {
  const prior = getRealmRoot();
  setRealmRoot(path.join(dir, 'realm'));
  setWitnessesRoot(path.join(dir, 'witnesses'));
  return {
    wallet: POSITION_HOUSE,
    restore: () => {
      setRealmRoot(prior);
      setWitnessesRoot(null);
    },
  };
};

/**
 * Record a lane (under the live workspace engine's roots) as the house's
 * own. impure.
 * @param {string} laneId
 * @param {string} [wallet]
 */
export const ownLane = async (laneId, wallet = POSITION_HOUSE) => {
  const dir = workspace.pathFor(laneId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'owner.json'), JSON.stringify({ wallet, claimedAt: new Date().toISOString() }));
};
