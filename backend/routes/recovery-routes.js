/**
 * Recovery Routes — Keypair recovery and rotation.
 *
 * POST /api/neuma/:neumaId/recovery/verify-codes  — verify recovery codes
 * POST /api/neuma/:neumaId/recovery/rotate         — rotate keypair
 * POST /api/neuma/:neumaId/recovery/export-identity — export public identity
 * GET  /api/neuma/:neumaId/recovery/status          — keypair status
 */

import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { default as neumaWorkspace } from '../../core/workspace/neuma-workspace.js';
import {
  verifyRecoveryCodes, decryptKeypair, decryptWithRecoveryCodes,
} from '../../core/wallet/keypair-vault.js';
import { rotateKeypair } from '../../core/wallet/keypair-rotation.js';
import { reissueIdentityCard } from '../../core/weave/identity-card.js';
import { cacheDecryptedKey, evictCachedKey } from './neuma-auth-routes.js';

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
router.post('/:neumaId/recovery/verify-codes', async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;

  const { recoveryCodes } = req.body;
  if (!Array.isArray(recoveryCodes) || recoveryCodes.length !== 8) {
    return res.status(400).json({ error: 'Exactly 8 recovery codes required' });
  }

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
 * POST /rotate — Rotate keypair.
 * Requires witness auth + either old password or verified recovery codes (cached key).
 * Body: { newPassword, oldPassword? }
 */
router.post('/:neumaId/recovery/rotate', async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;

  const { newPassword, oldPassword } = req.body;
  if (!newPassword || newPassword.length < 12) {
    return res.status(400).json({ error: 'New password must be at least 12 characters' });
  }

  try {
    // Get the old keypair — either from cache (recovery codes path) or decrypt with old password
    let oldKeypair = null;

    // Try cached key first (set by verify-codes endpoint)
    const { getCachedKey } = await import('./neuma-auth-routes.js');
    oldKeypair = getCachedKey(neumaId);

    if (!oldKeypair && oldPassword) {
      // Decrypt with old password. decryptKeypair THROWS on a wrong password —
      // letting that reach the outer catch answered 500 "rotation failed",
      // telling a witness who simply mistyped that the server was broken.
      // A bad credential is a 401, and the fall-through below says exactly
      // that. (Found 2026-08-22 when the mock that stubbed this call away
      // was removed — #390 tranche 0.)
      const encrypted = await neumaWorkspace.readEncryptedKeypair(neumaId);
      if (encrypted) {
        try {
          oldKeypair = decryptKeypair(encrypted, oldPassword);
        } catch {
          oldKeypair = null;
        }
      }
    }

    if (!oldKeypair) {
      // Try plaintext keypair (pre-encryption migration)
      const plaintext = await neumaWorkspace.readKeypair(neumaId);
      if (plaintext?.privateKey) {
        oldKeypair = plaintext;
      }
    }

    if (!oldKeypair) {
      return res.status(401).json({ error: 'Could not access current keypair — provide old password or verify recovery codes first' });
    }

    // Rotate
    const { newKeypair, recoveryCodes } = await rotateKeypair(neumaId, oldKeypair, newPassword, 'witness_request');

    // Reissue identity card
    try {
      const oldCard = await neumaWorkspace.readIdentityCard(neumaId);
      const dna = await neumaWorkspace.readDNA(neumaId);

      // Read the full new keypair from the cache (rotateKeypair caches it internally? no, it doesn't)
      // We need the private key to sign the new card — decrypt the freshly encrypted keypair
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

      // Cache the new keypair
      cacheDecryptedKey(neumaId, fullNewKeypair);
    } catch (err) {
      log.error('Identity card reissue error (non-critical)', { error: err.message });
    }

    // Evict old cached key
    evictCachedKey(neumaId);

    res.json({
      success: true,
      newAddress: newKeypair.address,
      recoveryCodes: [...recoveryCodes], // Shown once, never stored
    });
  } catch (err) {
    log.error('Rotate error', { error: err.message });
    res.status(500).json({ error: 'Keypair rotation failed' });
  }
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
