/**
 * ALLIANCE NAMES — the ground where houses meet.
 *
 * When two houses collaborate, the work belongs to neither of them alone. It
 * lives in a third ground named from BOTH houses: `aldmere-sesese`. The
 * witness never reaches into the other house's private ground, and no house
 * has to open itself up — they meet somewhere that is jointly theirs.
 *
 * THE NAME COMES FROM THE WALLET, ALWAYS. Every wallet already carries a
 * house name (`houseNameFromWitness` — KOTODAMA), so this needs no registry,
 * no on-chain founding, and no special case for a sealed witness: a witness
 * has its own wallet, therefore its own house name, exactly like anyone else.
 * An alliance can be formed before either house is registered anywhere.
 *
 * THE KEY IS THE SOUND-NAME, WHATEVER THE HOUSE SHOWS. A house may show a
 * meaningful name (core/kotodama/house-name.js), but the ground's folder key
 * stays each wallet's KOTODAMA v1 sound-name: computable from any wallet with
 * no record, and unchanged for every ground already made.
 *
 * ORDER-INDEPENDENCE IS LOAD-BEARING. If A+B and B+A produced different
 * names, one alliance would grow two grounds that silently diverge — the same
 * work split across two folders, neither complete. Names are lowercased and
 * sorted so a pairing has exactly ONE ground however it is asked for.
 *
 * Lowercasing matches the chain's own law: HouseRegistry keys a house by
 * `keccak256(lowercased name)` (house-founding-flow.js), so an alliance name
 * is addressable on-chain by the same rule when UNAVIS federates houses.
 *
 * Pure. No IO.
 */

import { houseNameFromWitness } from './names.js';

/** A ground name is a filesystem path segment — nothing else may enter it. */
const SAFE_SEGMENT = /^[a-z]+(-[a-z]+)*$/;

/**
 * The house names of a set of wallets, lowercased — the parties to an alliance.
 * Duplicates collapse: a wallet allied with itself is not an alliance.
 * @param {string[]} wallets - hex wallet addresses, 0x-prefixed or not
 * @returns {string[]} lowercased house names, ascending, no repeats
 */
export const allianceParties = (wallets) => {
  if (!Array.isArray(wallets)) throw new Error('allianceParties: wallets array required');
  const names = wallets.map((w) => {
    if (typeof w !== 'string' || !w.trim()) throw new Error('allianceParties: every wallet must be a non-empty string');
    return houseNameFromWitness(w).toLowerCase();
  });
  return [...new Set(names)].sort();
};

/**
 * The canonical ground name for houses collaborating — order-independent, so
 * the same set of wallets always resolves to the same single ground.
 *
 * Scales past two: three houses meeting share one ground named from all three,
 * which is how an UNAVIS federation of houses addresses its joint work.
 *
 * @param {string[]} wallets - two or more wallets, in any order
 * @returns {string} e.g. 'aldmere-sesese'
 */
export const allianceGroundName = (wallets) => {
  const parties = allianceParties(wallets);
  if (parties.length < 2) {
    throw new Error('allianceGroundName: an alliance needs at least two distinct houses');
  }
  const name = parties.join('-');
  // A derived name should never be able to escape its root. KOTODAMA emits
  // only [a-z] syllables, so this can only fire if the derivation changes —
  // in which case it must fail loudly rather than write outside the ground.
  if (!SAFE_SEGMENT.test(name)) {
    throw new Error(`allianceGroundName: refusing an unsafe ground name "${name}"`);
  }
  return name;
};

/**
 * Is this wallet a party to that alliance ground? The membership question the
 * ground's access gate asks, answered from the name alone — no registry read.
 * @param {string} groundName
 * @param {string} wallet
 * @returns {boolean}
 */
export const isPartyTo = (groundName, wallet) => {
  if (typeof groundName !== 'string' || typeof wallet !== 'string' || !wallet.trim()) return false;
  // A gate ANSWERS; it does not crash. houseNameFromWitness throws on anything
  // that is not hex, and a gate handed junk must return "not a party" rather
  // than take the caller down — the honest answer to […] for an
  // unreadable wallet is no. Fail-closed, never fail-open.
  try {
    return groundName.split('-').includes(houseNameFromWitness(wallet).toLowerCase());
  } catch {
    return false;
  }
};
