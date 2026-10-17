/**
 * Keypair Rotation — Key lifecycle management for neuma sovereignty.
 *
 * Handles keypair rotation, archival of old keys, and audit trail.
 * When a keypair is compromised or the witness wants a fresh start,
 * the old key is archived and a new one generated.
 */

import { generateKeypair } from '../weave/keypair.js';
import { encryptKeypair, encryptWithRecoveryCodes, generateRecoveryCodes, hashRecoveryCodes } from './keypair-vault.js';
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

  // 1. Archive old keypair
  await archiveKeypair(neumaId, oldKeypair, reason);

  // 2. Generate new keypair
  const newKeypair = generateKeypair();

  // 3. Encrypt with new password
  const encrypted = encryptKeypair(newKeypair, newPassword);
  await neumaWorkspace.writeEncryptedKeypair(neumaId, encrypted);

  // 4. Generate new recovery codes
  const recoveryCodes = generateRecoveryCodes();
  const recoveryHash = hashRecoveryCodes(recoveryCodes);
  await neumaWorkspace.writeRecoveryHash(neumaId, recoveryHash);

  // 5. Encrypt with recovery codes
  const recoveryEncrypted = encryptWithRecoveryCodes(newKeypair, recoveryCodes);
  await neumaWorkspace.writeRecoveryKeypair(neumaId, recoveryEncrypted);

  // 6. Delete plaintext keypair if it exists
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
