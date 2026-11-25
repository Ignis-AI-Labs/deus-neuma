// lp-wallet.js — a house member's second wallet, kept beside its first.
//
// The LP wallet is used only for liquidity on Umbrae. Its key sits in the
// house member's own keys/ folder, written through the workspace's encrypted
// store under that house member's file key, exactly as its first keypair was
// at birth. It is made on this computer, never shown, and never leaves here.
//
// It differs from the identity wallet in one way, on purpose (Founder 11-12): no
// password stands between the house member and a signature, so it can tend a
// position with nobody at the desk. What it can sign is held by lp-signer.js;
// funds sit either at this session address or, after registration, at its
// treasury-owned Safe whose Roles policy is enforced by the EVM.
//
// The Umbrae key (the platform's own credential for this wallet) is kept in
// the same folder the same way.

import path from 'node:path';
import { ethers } from 'ethers';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';

const walletFile = (neumaId) => path.join(neumaWorkspace._path(neumaId), 'keys', 'lp-wallet.json');
const umbraeKeyFile = (neumaId) => path.join(neumaWorkspace._path(neumaId), 'keys', 'lp-umbrae-key.json');

// impure — reads the encrypted record; a file the platform did not write
// (plaintext) is refused by the workspace and reads as absent here.
const readRecord = async (file) => {
  try {
    return await neumaWorkspace._readTrustedJSON(file);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'UNTRUSTED_PLAINTEXT') return null;
    throw err;
  }
};

/**
 * The LP wallet's address, or null when this house member has none yet.
 * impure — reads the house member's keys folder.
 *
 * @param {string} neumaId
 * @returns {Promise<string|null>}
 */
export const lpWalletAddress = async (neumaId) => (await readRecord(walletFile(neumaId)))?.address ?? null;

/**
 * Make the LP wallet if this house member has none, and give its address.
 * Written once: a second call returns the same wallet, so funds sent to the
 * address are never stranded behind a replaced key. impure — draws
 * randomness, writes the keys folder and the audit line.
 *
 * @param {string} neumaId
 * @returns {Promise<Readonly<{address: string, created: boolean}>>}
 */
export const openLpWallet = async (neumaId) => {
  const file = walletFile(neumaId);
  return neumaWorkspace._locks.withFileLock(file, async () => {
    const existing = await readRecord(file);
    if (existing?.address) return Object.freeze({ address: existing.address, created: false });
    const fresh = ethers.Wallet.createRandom();
    await neumaWorkspace._writeJSON(file, { address: fresh.address, privateKey: fresh.privateKey, createdAt: new Date().toISOString() });
    await neumaWorkspace.audit(neumaId, 'LP_WALLET_CREATED', { address: fresh.address });
    return Object.freeze({ address: fresh.address, created: true });
  });
};

/**
 * The LP wallet as a signer, for lp-signer.js alone. Null when there is none.
 * impure — reads the key into memory for the caller's one use.
 *
 * @param {string} neumaId
 * @returns {Promise<ethers.Wallet|null>}
 */
export const lpSigner = async (neumaId) => {
  const record = await readRecord(walletFile(neumaId));
  return record?.privateKey ? new ethers.Wallet(record.privateKey) : null;
};

/**
 * The Umbrae key saved for this house member's LP wallet, or null.
 * impure — reads the keys folder.
 *
 * @param {string} neumaId
 * @returns {Promise<string|null>}
 */
export const readUmbraeKey = async (neumaId) => {
  const [record, address] = await Promise.all([readRecord(umbraeKeyFile(neumaId)), lpWalletAddress(neumaId)]);
  return record?.key && record.wallet === address ? record.key : null;
};

/**
 * Save the Umbrae key issued to this house member's LP wallet. impure —
 * writes the keys folder and the audit line (never the key itself).
 *
 * @param {string} neumaId
 * @param {string} key - the key exactly as Umbrae issued it
 * @returns {Promise<void>}
 */
export const saveUmbraeKey = async (neumaId, key) => {
  const address = await lpWalletAddress(neumaId);
  if (!address) throw new Error('This house member has no LP wallet yet.');
  if (typeof key !== 'string' || !/^umbr_[^\s]{8,300}$/.test(key)) throw new Error('That is not an Umbrae key.');
  await neumaWorkspace._writeJSON(umbraeKeyFile(neumaId), { key, wallet: address, savedAt: new Date().toISOString() });
  await neumaWorkspace.audit(neumaId, 'LP_UMBRAE_KEY_SAVED', { wallet: address });
};
