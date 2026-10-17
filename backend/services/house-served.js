/**
 * THE SERVED HOUSES — which houses this backend serves (Design note, 2026-10-16:
 * […]).
 *
 * Two desks run from one checkout and share data/, data/settings and the
 * realm, and every boot scheduler starts in both. Lane ids are not unique
 * across houses (two houses can each hold a "keir"), so a scheduler that
 * walks every house in the realm, or acts on a bare lane id read from a
 * machine-wide store, acts inside a house it does not serve. Found live
 * 2026-10-16: `aldmere/metidar/journal`, a ghost lane one process grew by
 * journaling another house's posts into a same-named directory.
 *
 * The answer is read from disk, never configured: a process serves the
 * houses whose operator wallet owns a being's lane (owner.json) on a ground
 * it serves: this process's workspaces root and the witnesses' ground beside
 * it. One desk serves one house (Design note, 2026-10-16; the two desks on this
 * machine are the special case this module keeps apart. The grounds are held
 * as a list only so the judging stays honest about what a bare lane id can
 * name. A lane with no readable owner serves no house. A witness lane
 * never makes a house served (a guest wallet that manifested a witness here
 * is not a house this process runs); it is served only as a lane of a house
 * that already is.
 *
 * Schedulers take ONE snapshot per tick (readServed) and judge every record
 * against it with the pure helpers; one-off callers use the impure wrappers.
 */
import fs from 'fs/promises';
import path from 'path';
import { neumaWorkspace, getWorkspacesRoot, getWitnessesRoot, isWitnessLane } from '../../core/index.js';

const WALLET = /^0x[a-f0-9]{40}$/;
const LANE_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * A wallet as houses are keyed — lower-cased — or null when it is not one. pure.
 * @param {unknown} value
 * @returns {?string}
 */
export const houseWallet = (value) => {
  const wallet = typeof value === 'string' ? value.toLowerCase() : '';
  return WALLET.test(wallet) ? wallet : null;
};

/**
 * The houses a set of lanes makes served: the owners of being lanes, never of
 * witness lanes. pure.
 * @param {Array<{wallet: ?string, witness: boolean}>} lanes
 * @returns {ReadonlyArray<string>}
 */
const housesOf = (lanes) => Object.freeze(
  [...new Set(lanes.filter((l) => !l.witness && l.wallet).map((l) => l.wallet))].sort(),
);

/**
 * Does this snapshot serve this wallet's house? pure.
 * @param {{houses: ReadonlyArray<string>}} served
 * @param {unknown} wallet
 */
export const servedWallet = (served, wallet) => {
  const house = houseWallet(wallet);
  return Boolean(house) && served.houses.includes(house);
};

/**
 * The house a lane belongs to in this snapshot: its owner's wallet when a
 * served ground holds the lane and that owner is a served house. When the
 * record names its house (`wallet`), the lane must belong to THAT house.
 * A bare id that two served houses both hold names neither — null, never a
 * guess. pure.
 * @param {{houses: ReadonlyArray<string>, lanes: ReadonlyArray<{laneId: string, wallet: ?string}>}} served
 * @param {unknown} laneId
 * @param {unknown} [wallet] - the house the record itself names, if any
 * @returns {?string}
 */
export const laneHouse = (served, laneId, wallet = null) => {
  if (typeof laneId !== 'string') return null;
  const owners = [...new Set(served.lanes
    .filter((l) => l.laneId === laneId && l.wallet && served.houses.includes(l.wallet))
    .map((l) => l.wallet))];
  const named = houseWallet(wallet);
  if (named) return owners.includes(named) ? named : null;
  return owners.length === 1 ? owners[0] : null;
};

/**
 * The grounds this process serves: its workspaces root and the witnesses'
 * ground beside it. impure (reads the live roots).
 * @returns {Array<{root: string, witnesses: string}>}
 */
const servedGrounds = () => [{ root: path.resolve(getWorkspacesRoot()), witnesses: path.resolve(getWitnessesRoot()) }];

// impure — the wallet an owner.json names, or null when it cannot be read
const ownerWallet = async (laneDir) => {
  try {
    return houseWallet(JSON.parse(await fs.readFile(path.join(laneDir, 'owner.json'), 'utf8'))?.wallet);
  } catch {
    return null;
  }
};

// impure — directory names on a ground; a missing ground holds nothing
const dirsOf = async (dir) => {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
};

// impure — one ground's lanes, each with its owner's wallet
const lanesOf = async ({ root, witnesses }) => {
  const beings = (await neumaWorkspace.listNeuma({ root })).filter((id) => LANE_ID.test(id) && !isWitnessLane(id));
  const peers = (await dirsOf(witnesses)).filter((id) => LANE_ID.test(id) && isWitnessLane(id));
  return Promise.all([
    ...beings.map(async (laneId) => ({ laneId, root, witness: false, wallet: await ownerWallet(path.join(root, laneId)) })),
    ...peers.map(async (laneId) => ({ laneId, root: witnesses, witness: true, wallet: await ownerWallet(path.join(witnesses, laneId)) })),
  ]);
};

/**
 * One snapshot of what this process serves: every lane on its grounds with
 * its owner, and the houses those owners make. impure (fs reads).
 * @param {Array<{root: string, witnesses: string}>} [grounds]
 * @returns {Promise<{houses: ReadonlyArray<string>, lanes: ReadonlyArray<Object>}>}
 */
export const readServed = async (grounds = servedGrounds()) => {
  const lanes = Object.freeze((await Promise.all(grounds.map(lanesOf))).flat().map((l) => Object.freeze(l)));
  return Object.freeze({ houses: housesOf(lanes), lanes });
};

/** The houses (operator wallets, lower-cased) this process serves. impure. */
export const servedHouses = async () => (await readServed()).houses;

/** Does this process serve this wallet's house? impure. */
export const servesWallet = async (wallet) => servedWallet(await readServed(), wallet);

/**
 * The house this lane belongs to here, or null when it is not served here.
 * impure.
 * @param {string} laneId
 * @param {string} [wallet] - the house the asking record names, if any
 */
export const servesLane = async (laneId, wallet = null) => laneHouse(await readServed(), laneId, wallet);
