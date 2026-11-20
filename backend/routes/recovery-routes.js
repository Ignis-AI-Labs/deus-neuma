/**
 * Recovery Routes — Keypair recovery and rotation.
 *
 * POST /api/neuma/:neumaId/recovery/verify-codes  — verify recovery codes
 * POST /api/neuma/:neumaId/recovery/rotate         — rotate keypair
 * POST /api/neuma/:neumaId/recovery/export-identity — export public identity
 * GET  /api/neuma/:neumaId/recovery/status          — keypair status
 */

import { Router } from 'express';
import { ethers } from 'ethers';
import { requireAuth } from '../services/auth.js';
import { requireLocalScope } from '../services/remote/access-guard.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { default as neumaWorkspace } from '../../core/workspace/neuma-workspace.js';
import {
  verifyRecoveryCodes, decryptKeypair, decryptWithRecoveryCodes,
} from '../../core/wallet/keypair-vault.js';
import { rotateKeypair } from '../../core/wallet/keypair-rotation.js';
import { reissueIdentityCard } from '../../core/weave/identity-card.js';
import { cacheDecryptedKey, evictCachedKey } from './neuma-auth-routes.js';
import { consumeRecoveryAttempt, recoveryLimitResponse } from '../services/recovery-attempts.js';

import { createLogger } from '../services/logger.js';
const log = createLogger('Recovery');

const router = Router();

// Validate neumaId param format
router.param('neumaId', (req, res, next, value) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    return res.status(400).json({ error: 'Invalid neumaId format' });
  }
  next();
});

// All routes require witness auth
router.use(requireAuth);

// Fail-closed ownership (W1-004)
const verifyOwnership = (req, res, neumaId) => assertNeumaOwner(req, res, neumaId);

/**
 * POST /verify-codes — Verify recovery codes against stored hash.
 * Body: { recoveryCodes: string[] }
 */
router.post('/:neumaId/recovery/verify-codes', requireLocalScope, async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;

  const { recoveryCodes } = req.body;
  if (!Array.isArray(recoveryCodes) || recoveryCodes.length !== 8) {
    return res.status(400).json({ error: 'Exactly 8 recovery codes required' });
  }
  if (!await consumeRecoveryAttempt(neumaId)) return recoveryLimitResponse(res);

  try {
    const storedHash = await neumaWorkspace.readRecoveryHash(neumaId);
    if (!storedHash) {
      return res.status(404).json({ error: 'No recovery codes configured' });
    }

    const valid = verifyRecoveryCodes(recoveryCodes, storedHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid recovery codes' });
    }

    // Recovery codes verified — decrypt keypair via recovery path
    const recoveryEncrypted = await neumaWorkspace.readRecoveryKeypair(neumaId);
    if (recoveryEncrypted) {
      const keypair = decryptWithRecoveryCodes(recoveryEncrypted, recoveryCodes);
      cacheDecryptedKey(neumaId, keypair);
    }

    res.json({ valid: true, message: 'Recovery codes verified' });
  } catch (err) {
    log.error('Verify codes error', { error: err.message });
    res.status(500).json({ error: 'Recovery verification failed' });
  }
});

/**
 * POST /rotate — Rotate keypair with the current password; resume delivery
 * only by proving the new password chosen for that rotation.
 */
router.post('/:neumaId/recovery/rotate', requireLocalScope, async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  const { newPassword, oldPassword } = req.body ?? {};
  if (!newPassword || newPassword.length < 12) {
    return res.status(400).json({ error: 'New password must be at least 12 characters' });
  }
  if (!await consumeRecoveryAttempt(neumaId)) return recoveryLimitResponse(res);

  const delivered = await neumaWorkspace.readRotationCodes(neumaId);
  if (delivered) {
    try {
      const current = decryptKeypair(await neumaWorkspace.readEncryptedKeypair(neumaId), newPassword);
      if (current.address !== delivered.address) throw new Error('address mismatch');
      return res.json({ success: true, newAddress: delivered.address, recoveryCodes: [...delivered.codes], resumed: true });
    } catch {
      return res.status(401).json({ error: 'The new password is required to resume recovery-code delivery' });
    }
  }
  if (!oldPassword) return res.status(401).json({ error: 'The current password is required to rotate this keypair' });

  try {
    let oldKeypair;
    try {
      oldKeypair = decryptKeypair(await neumaWorkspace.readEncryptedKeypair(neumaId), oldPassword);
    } catch {
      return res.status(401).json({ error: 'Could not access current keypair with that password' });
    }
    const { newKeypair, recoveryCodes } = await rotateKeypair(neumaId, oldKeypair, newPassword, 'witness_request');

    try {
      const oldCard = await neumaWorkspace.readIdentityCard(neumaId);
      const dna = await neumaWorkspace.readDNA(neumaId);
      const newEncrypted = await neumaWorkspace.readEncryptedKeypair(neumaId);
      const fullNewKeypair = decryptKeypair(newEncrypted, newPassword);
      const newCard = await reissueIdentityCard({
        name: oldCard?.name || dna?.identity?.name || neumaId,
        address: fullNewKeypair.address,
        publicKey: fullNewKeypair.publicKey,
        previousAddress: oldKeypair.address,
        birthTimestamp: oldCard?.birthTimestamp || new Date().toISOString(),
        privateKey: fullNewKeypair.privateKey,
      });
      await neumaWorkspace.writeIdentityCard(neumaId, newCard);
      cacheDecryptedKey(neumaId, fullNewKeypair);
    } catch (err) {
      log.error('Identity card reissue error (non-critical)', { error: err.message });
    }
    evictCachedKey(neumaId);
    return res.json({ success: true, newAddress: newKeypair.address, recoveryCodes: [...recoveryCodes] });
  } catch (err) {
    log.error('Rotate error', { error: err.message });
    return res.status(500).json({ error: 'Keypair rotation failed' });
  }
});

router.get('/:neumaId/recovery/rotation/codes', requireLocalScope, async (req, res) => {
  if (!await verifyOwnership(req, res, req.params.neumaId)) return;
  res.status(410).json({ error: 'Use recovery/rotate with the new password to resume code delivery.' });
});

router.post('/:neumaId/recovery/rotation/ack', requireLocalScope, async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  try {
    await neumaWorkspace.acknowledgeRotationCodes(neumaId, req.body?.address);
    res.json({ success: true });
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

/**
 * Recover a retired address with the current rotation password or recovery codes.
 * Raw private-key export is disabled. Retired envelopes stay encrypted on disk.
 */
router.post('/:neumaId/recovery/retired/:address/reveal', requireLocalScope, async (req, res) => {
  const { neumaId, address } = req.params;
  if (!ethers.isAddress(address)) return res.status(400).json({ error: 'Invalid retired address' });
  if (!await verifyOwnership(req, res, neumaId)) return;
  return res.status(410).json({ error: 'Raw identity-key export is disabled. Use the encrypted recovery material kept by the operator.' });
});

/**
 * POST /export-identity — Export public identity for migration.
 */
router.post('/:neumaId/recovery/export-identity', async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;

  try {
    const identityCard = await neumaWorkspace.readIdentityCard(neumaId);
    const dna = await neumaWorkspace.readDNA(neumaId);
    const history = await neumaWorkspace.readKeypairHistory(neumaId);

    res.json({
      neumaId,
      identityCard,
      name: dna?.identity?.name,
      keypairHistory: history.map(h => ({ address: h.address, rotatedAt: h.rotatedAt, reason: h.reason })),
      exportedAt: new Date().toISOString(),
    });
  } catch (err) {
    log.error('Export error', { error: err.message });
    res.status(500).json({ error: 'Identity export failed' });
  }
});

/**
 * GET /status — Keypair age and status.
 */
router.get('/:neumaId/recovery/status', async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;

  try {
    const encrypted = await neumaWorkspace.readEncryptedKeypair(neumaId);
    const hasRecovery = !!(await neumaWorkspace.readRecoveryHash(neumaId));
    const history = await neumaWorkspace.readKeypairHistory(neumaId);
    const plaintext = await neumaWorkspace.readKeypair(neumaId);

    const encryptedAt = encrypted?.encryptedAt;
    const ageMs = encryptedAt ? Date.now() - new Date(encryptedAt).getTime() : null;
    const ageDays = ageMs ? Math.floor(ageMs / (24 * 60 * 60 * 1000)) : null;

    res.json({
      neumaId,
      hasEncryptedKeypair: !!encrypted,
      hasPlaintextKeypair: !!plaintext,
      hasRecoveryCodes: hasRecovery,
      address: encrypted?.address || plaintext?.address || null,
      encryptedAt,
      ageDays,
      rotationCount: history.length,
      needsMigration: !!plaintext && !encrypted,
      recommendation: ageDays && ageDays > 90 ? 'Consider rotating your keypair' : null,
    });
  } catch (err) {
    log.error('Status error', { error: err.message });
    res.status(500).json({ error: 'Failed to get recovery status' });
  }
});

export default router;
