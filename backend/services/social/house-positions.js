// HOUSE POSITIONS — where each house's outward positions live: its channel
// bindings, its mailbox binding, its sector crews and its account keys.
//
// Design note, 2026-10-16: […] Until 2026-10-19 each of these was ONE
// record per machine under data/settings, so any signed wallet could re-key,
// rebind or release another house's X account or mailbox, and a crew remit
// one house wrote rode another house's being's prompt. The house is its
// operator's wallet, so each record now sits in that wallet's realm dir
// beside its charter: `<realm>/<wallet>/<file>`. A caller with no house
// holds no position.
//
// THE MACHINE RECORD written before then is read, never moved, and only by
// the house it names on record (each store says which field names it). The
// first write in a house writes the house's own file, which from then on is
// the only one read for that house. A machine record that names no house
// serves none.

import fs from 'fs/promises';
import path from 'path';
import { getRealmRoot, walletDir } from '../user-realm.js';
import { houseKey } from '../staff/cos-designation.js';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';

const WALLET = /^0x[a-f0-9]{40}$/;

/**
 * One position file in a house. Throws on a wallet that is not one: no
 * house, no position.
 * @param {string} wallet
 * @param {string} name - the file name
 */
export const housePositionFile = (wallet, name) => {
  const key = houseKey(wallet);
  if (!key) throw new Error('a house position needs the house\'s wallet');
  return path.join(walletDir(key), name);
};

/**
 * The house a lane belongs to: its owner's wallet, or null when the lane has
 * no readable owner. impure.
 * @param {string} laneId
 * @returns {Promise<?string>}
 */
export const houseOfLane = async (laneId) =>
  houseKey((await neumaWorkspace.readOwner(laneId).catch(() => null))?.wallet);

/**
 * Every house in the realm that has written this position file. impure.
 * @param {string} name
 * @returns {Promise<string[]>} house wallets
 */
export const housesWith = async (name) => {
  let names;
  try {
    names = await fs.readdir(getRealmRoot());
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const houses = [];
  for (const wallet of names.filter((n) => WALLET.test(n))) {
    const written = await fs.stat(path.join(walletDir(wallet), name)).then(() => true, () => false);
    if (written) houses.push(wallet);
  }
  return houses;
};
