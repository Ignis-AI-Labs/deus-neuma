// WHO ELSE LIVES AT A ROOT — the interim guard on moving the realm or the
// workspaces root (audit 3, E5).
//
// Both roots are one per process: relocating one moves every house's data out
// from under it, not just the caller's. Who may move the machine's roots at
// all is the install-owner question, still open; until it is answered, a
// wallet may move a root only while no other house's data lives there
// (Design note, 2026-10-16: two houses on one machine are never confused).
//
// impure — directory reads.

import fs from 'fs/promises';
import path from 'path';

const WALLET_DIR = /^0x[a-f0-9]{40}$/;

// impure — the directory names under a root; a missing root holds nothing
const dirsOf = async (root) => {
  try {
    return (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

/**
 * How many other wallets keep a realm dir at this realm root. impure.
 * @param {string} realmRoot
 * @param {string} wallet - the caller
 * @returns {Promise<number>}
 */
export const otherRealmHouses = async (realmRoot, wallet) => {
  const caller = String(wallet || '').toLowerCase();
  return (await dirsOf(realmRoot)).filter((name) => WALLET_DIR.test(name.toLowerCase()) && name.toLowerCase() !== caller).length;
};

/**
 * How many lanes at these grounds another wallet owns. impure.
 * @param {string[]} grounds - the workspaces root and the witnesses' ground
 * @param {string} wallet - the caller
 * @returns {Promise<number>}
 */
export const otherOwnedLanes = async (grounds, wallet) => {
  const caller = String(wallet || '').toLowerCase();
  let count = 0;
  for (const ground of new Set(grounds.map((g) => path.resolve(g)))) {
    for (const lane of await dirsOf(ground)) {
      const raw = await fs.readFile(path.join(ground, lane, 'owner.json'), 'utf8').catch(() => null);
      if (raw === null) continue;
      // An owner record that cannot be read is not provably the caller's.
      let owner = null;
      try { owner = JSON.parse(raw)?.wallet; } catch { /* counted below */ }
      if (typeof owner !== 'string' || owner.toLowerCase() !== caller) count += 1;
    }
  }
  return count;
};
