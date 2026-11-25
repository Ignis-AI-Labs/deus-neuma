/**
 * Keypair Rotation — Key lifecycle management for neuma sovereignty.
 *
 * Handles keypair rotation, archival of old keys, and audit trail.
 * When a keypair is compromised or the witness wants a fresh start,
 * the old key is archived and a new one generated.
 */

import { generateKeypair } from '../weave/keypair.js';
import { encryptKeypair, decryptKeypair, encryptWithRecoveryCodes, generateRecoveryCodes, hashRecoveryCodes } from './keypair-vault.js';
import neumaWorkspace from '../workspace/neuma-workspace.js';

/**
 * Rotate a neuma's keypair. Archives the old key, generates a new one,
 * encrypts it, and writes everything to the workspace.
 *
 * @param {string} neumaId - Neuma identifier
 * @param {Object} oldKeypair - Current decrypted keypair { privateKey, publicKey, address }
 * @param {string} newPassword - Password for the new encrypted keypair
 * @param {string} reason - Reason for rotation (e.g. 'compromised', 'scheduled', 'witness_request')
 * @returns {Promise<Object>} { newKeypair, recoveryCodes } — new keypair address + fresh recovery codes
 */
export const rotateKeypair = async (neumaId, oldKeypair, newPassword, reason = 'witness_request') => {
  if (!neumaId || !oldKeypair?.address || !newPassword) {
    throw new Error('neumaId, oldKeypair, and newPassword are required');
  }

  const newKeypair = generateKeypair();
  const encrypted = encryptKeypair(newKeypair, newPassword);
  const recoveryCodes = generateRecoveryCodes();
  const recoveryHash = hashRecoveryCodes(recoveryCodes);
  const recoveryEncrypted = encryptWithRecoveryCodes(newKeypair, recoveryCodes);
  const retired = {
    password: encryptKeypair(oldKeypair, newPassword),
    recovery: encryptWithRecoveryCodes(oldKeypair, recoveryCodes),
  };

  await neumaWorkspace.writeRetiredKeypair(neumaId, oldKeypair.address, retired);
  const landed = await neumaWorkspace.readRetiredKeypair(neumaId, oldKeypair.address);
  if (!landed?.recovery || decryptKeypair(landed.password, newPassword).address !== oldKeypair.address) {
    throw new Error('The retired key could not be verified; the current key was not changed');
  }
  await archiveKeypair(neumaId, oldKeypair, reason);
  await neumaWorkspace.writeRotationBundle(neumaId, {
    address: newKeypair.address, encrypted, recoveryHash, recoveryEncrypted,
  });
  await neumaWorkspace.writeEncryptedKeypair(neumaId, encrypted);
  await neumaWorkspace.writeRotationCodes(neumaId, newKeypair.address, recoveryCodes);
  await neumaWorkspace.writeRecoveryHash(neumaId, recoveryHash);
  await neumaWorkspace.writeRecoveryKeypair(neumaId, recoveryEncrypted);
  await neumaWorkspace.writeRotationBundle(neumaId, {
    address: newKeypair.address, encrypted, recoveryHash, recoveryEncrypted,
  });
  await neumaWorkspace.deletePlaintextKeypair(neumaId);

  return Object.freeze({
    newKeypair: Object.freeze({
      publicKey: newKeypair.publicKey,
      address: newKeypair.address,
    }),
    recoveryCodes,
  });
};

/**
 * Archive a keypair to the rotation history.
 *
 * @param {string} neumaId - Neuma identifier
 * @param {Object} keypair - Keypair to archive { address, publicKey }
 * @param {string} reason - Reason for archival
 * @returns {Promise<void>}
 */
export const archiveKeypair = async (neumaId, keypair, reason) => {
  await neumaWorkspace.writeKeypairArchive(neumaId, {
    address: keypair.address,
    publicKey: keypair.publicKey,
    reason,
    rotatedAt: new Date().toISOString(),
  });
};

/**
 * Get the keypair rotation history for a neuma.
 *
 * @param {string} neumaId - Neuma identifier
 * @returns {Promise<Array<Object>>} Array of archive entries
 */
export const getKeypairHistory = async (neumaId) => {
  return neumaWorkspace.readKeypairHistory(neumaId);
};
