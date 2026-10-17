// security.js — the witness's data-security controls (Settings > Security).
//
// impure — talks to the local backend with the session token. Read + plan +
// backup only in this phase; the destructive actions (DEK migration execute,
// key rotation) stay out of the UI until they're made safe to run live.

import { apiCall } from '../utils/http.js';

/**
 * The witness's security posture: roots (active vs persisted + alignment),
 * storage, and per-being encryption status.
 * @returns {Promise<{roots:object, storage:object, beings:Array, encryption:object}>}
 */
// impure
export const getSecurityStatus = async () =>
  apiCall('GET', '/api/v1/security/status', {
    strictJson: true, useServerError: false, errorPrefix: 'Could not read security status',
  });

/**
 * Dry-run the per-neuma DEK backfill — reports what would change and whether
 * the master key can open every file. Zero writes.
 * @returns {Promise<{beings:Array, needsMigration:number, blocked:number, ready:boolean}>}
 */
// impure
export const getEncryptionPlan = async () =>
  apiCall('POST', '/api/v1/security/encryption/plan', { errorPrefix: 'Could not compute the plan' });

/**
 * Per-being keypair/recovery status.
 * @param {string} neumaId
 * @returns {Promise<{hasRecoveryCodes:boolean, address:string, ageDays:number, rotationCount:number}>}
 */
// impure
export const getRecoveryStatus = async (neumaId) =>
  apiCall('GET', `/api/v1/neuma/${encodeURIComponent(neumaId)}/recovery/status`, {
    strictJson: true, useServerError: false, errorPrefix: 'Could not read recovery status',
  });

/**
 * Create a backup of the witness's beings (a copy of their encrypted files).
 * @returns {Promise<{backup:{id:string, createdAt:string, beings:string[], beingCount:number, sizeBytes:number}}>}
 */
// impure
export const createBackup = async () =>
  apiCall('POST', '/api/v1/security/backup', { errorPrefix: 'Could not create the backup' });

/**
 * Where backups land, and what that actually protects against. The same-drive
 * answer is MEASURED server-side (stat().dev), not inferred from the path.
 * @returns {Promise<{destination:{state:string, ok:boolean, protects:boolean,
 *   reason:string, path:(string|null), sameDevice:(boolean|null)}}>}
 */
export const getBackupDestination = async () =>
  apiCall('GET', '/api/v1/security/backup-destination', { errorPrefix: 'Could not read the backup destination' });

/**
 * Choose a destination — an external disk or USB — or pass null to clear it.
 * A same-drive choice is accepted and marked; an unwritable one is refused.
 */
export const setBackupDestination = async (destPath) =>
  apiCall('PUT', '/api/v1/security/backup-destination', {
    body: { path: destPath },
    errorPrefix: 'Could not set the backup destination',
  });

/**
 * List the witness's own backups, newest first.
 * @returns {Promise<{backups:Array<{id:string, createdAt:string, beings:string[], beingCount:number, sizeBytes:number}>}>}
 */
// impure
export const listBackups = async () =>
  apiCall('GET', '/api/v1/security/backups', {
    strictJson: true, useServerError: false, errorPrefix: 'Could not list backups',
  });

/**
 * Delete one of the witness's own backups by id.
 * @param {string} id
 * @returns {Promise<{removed:boolean, id:string}>}
 */
// impure
export const deleteBackup = async (id) =>
  apiCall('DELETE', `/api/v1/security/backups/${encodeURIComponent(id)}`, { errorPrefix: 'Could not delete the backup' });
