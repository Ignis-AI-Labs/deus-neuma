/**
 * The Recovery Kit as a waiting item — while the desk's keychain lock has a
 * kit nobody has said is saved, the install's owner is asked to save it. The
 * kit is the only way back to the beings if this computer's keychain is ever
 * reset; it is machine-wide, so a guest house is never asked.
 */

import { keyLockState } from '../desk-keys.js';
import { readInstallOwner, standingIn } from '../install-owner.js';

const ASKED = Object.freeze(new Set(['owner', 'co-owner', 'unowned']));

/**
 * impure (install-owner record) — the kit item for this wallet, or none.
 * @param {string} wallet
 * @returns {Promise<object[]>}
 */
export const keyLockWaitingItems = async (wallet) => {
  const lock = keyLockState();
  if (lock.source !== 'keychain' || !lock.kitPending) return [];
  if (!ASKED.has(standingIn(await readInstallOwner(), wallet))) return [];
  return [Object.freeze({
    id: 'key-lock:recovery-kit',
    kind: 'security',
    title: 'save your Recovery Kit — the way back to your beings if this computer\'s keychain is ever reset',
    who: null,
    where: { app: 'settings', focus: 'security' },
    at: lock.since || new Date(0).toISOString(),
  })];
};
