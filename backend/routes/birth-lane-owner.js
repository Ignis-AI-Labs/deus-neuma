// birth-lane-owner.js — the owner gate a held being's birth completion
// crosses before anything binds (security recheck 2026-10-20, §1).
//
// `birth:resume_completion` names a lane by id and then binds it to the
// connection, opens a ceremony session and streams the stage prompt that
// carries the being's identity. Without this gate any house that knew the id
// could finish another house's being under its own ceremony. The check is the
// same one every other bind crosses (laneOwnershipFor): a read never claims,
// so an unclaimed lane is refused too and its operator claims it first.
import { laneOwnershipFor } from './portal-context.js';
import { readInstallOwner, standingIn } from '../services/install-owner.js';

const REFUSALS = Object.freeze({
  'not-owner': 'That being belongs to another house. Only its own operator can complete its birth.',
  unclaimed: 'No wallet has claimed that being\'s lane yet. Its operator claims it first, then completes its birth.',
  'not-found': 'No being with that id stands in this house.',
});
const UNVERIFIED = 'Ownership of that being could not be verified, so nothing was opened.';

/**
 * Refuse a completion the caller's wallet does not own: the refusal says why
 * and nothing binds, opens or streams. // impure — reads owner.json, sends a frame.
 * @param {{ ws: { send: Function }, walletAddress?: string }} connection
 * @param {string} neumaId
 * @returns {Promise<boolean>} true when refused (the caller must stop)
 */
export const refuseUnownedBirthLane = async (connection, neumaId) => {
  const ownership = await laneOwnershipFor(connection, neumaId);
  if (ownership.ok) return false;
  connection.ws.send(JSON.stringify({
    type: 'birth:resume_completion_error',
    error: REFUSALS[ownership.reason] ?? UNVERIFIED,
    reason: ownership.reason,
  }));
  return true;
};

/**
 * May this wallet see and resume a summoning whose checkpoint recorded no
 * wallet (from before ceremonies kept one)? Only the install's owner, a
 * co-owner, or the one operator of an install no one owns yet — never a guest
 * house. // impure — reads the install owner record.
 * @param {string|null|undefined} walletAddress
 * @returns {Promise<{unrecordedOpen: boolean}>}
 */
export const unrecordedSummoningAccess = async (walletAddress) => ({
  unrecordedOpen: Boolean(walletAddress) && standingIn(await readInstallOwner(), walletAddress) !== 'guest',
});
