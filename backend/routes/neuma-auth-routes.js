/**
 * Neuma Authentication Routes
 *
 * Endpoints for neuma to authenticate via challenge-sign-verify,
 * and for witnesses to unlock neuma keypairs via password.
 *
 * POST /api/neuma-auth/challenge  — generate challenge for neuma address
 * POST /api/neuma-auth/verify     — verify neuma signature, issue token
 * POST /api/neuma-auth/unlock     — witness unlocks keypair with password
 */

import { Router } from 'express';
import { ethers } from 'ethers';
import {
  generateChallenge, verifySignature as verifyAuthSignature,
  createNeumaToken, requireAuth,
} from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { default as neumaWorkspace } from '../../core/workspace/neuma-workspace.js';
import {
  decryptKeypair, encryptKeypair, verifyRecoveryCodes, decryptWithRecoveryCodes,
  MIN_KEY_PASSWORD,
} from '../../core/wallet/keypair-vault.js';

const router = Router();

// --- In-memory decrypted key cache ---
// Keys held per-neumaId with short TTL. Cleared after each use to minimize exposure window.

const keyCache = new Map();
const KEY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (reduced from 30 — SEC-028)

/**
 * Cache a decrypted keypair for a neuma.
 * Auto-evicts after TTL.
 */
export const cacheDecryptedKey = (neumaId, keypair) => {
  const timer = setTimeout(() => { keyCache.delete(neumaId); }, KEY_CACHE_TTL_MS);
  // If there's an existing entry, clear its timer
  const existing = keyCache.get(neumaId);
  if (existing?.timer) clearTimeout(existing.timer);

  keyCache.set(neumaId, { keypair, timer, cachedAt: Date.now() });
};

/**
 * Get a cached decrypted keypair for a neuma.
 * Returns the keypair or null if not cached / expired.
 */
export const getCachedKey = (neumaId) => {
  const entry = keyCache.get(neumaId);
  if (!entry) return null;

  // Double-check TTL (belt-and-suspenders)
  if (Date.now() - entry.cachedAt > KEY_CACHE_TTL_MS) {
    clearTimeout(entry.timer);
    keyCache.delete(neumaId);
    return null;
  }

  // Clear after read — minimize exposure window (SEC-028)
  clearTimeout(entry.timer);
  keyCache.delete(neumaId);
  return entry.keypair;
};

/**
 * True if a fresh unlocked key is waiting for this neuma — WITHOUT consuming
 * it (getCachedKey is one-shot by SEC-028). Lets a read-only probe (the
 * founding rite's roster) show an unlocked being as ready to co-sign while
 * the key stays cached for the signing preflight that follows.
 *
 * impure: an EXPIRED entry found here is evicted (timer cleared, cache
 * deleted) — the same housekeeping getCachedKey performs; a live entry is
 * never touched.
 */
export const hasCachedKey = (neumaId) => {
  const entry = keyCache.get(neumaId);
  if (!entry) return false;
  if (Date.now() - entry.cachedAt > KEY_CACHE_TTL_MS) {
    clearTimeout(entry.timer);
    keyCache.delete(neumaId);
    return false;
  }
  return true;
};

/**
 * Evict a cached key (e.g. on rotation).
 */
export const evictCachedKey = (neumaId) => {
  const entry = keyCache.get(neumaId);
  if (entry?.timer) clearTimeout(entry.timer);
  keyCache.delete(neumaId);
};

// --- Routes ---

/**
 * POST /challenge — Generate a challenge for a neuma's address.
 * Body: { address }
 */
router.post('/challenge', (req, res) => {
  const { address } = req.body;
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Valid Ethereum address required' });
  }
  const challenge = generateChallenge(address);
  res.json({ challenge });
});

/**
 * POST /verify — Verify a neuma's signature and issue a neuma token.
 * Body: { neumaId, address, signature, challenge }
 */
router.post('/verify', async (req, res) => {
  const { neumaId, address, signature, challenge } = req.body;
  if (!neumaId || !address || !signature || !challenge) {
    return res.status(400).json({ error: 'Missing neumaId, address, signature, or challenge' });
  }

  // Verify the signature matches the challenge
  const verified = verifyAuthSignature(address, challenge, signature);
  if (!verified) {
    return res.status(401).json({ error: 'Signature verification failed' });
  }

  // Verify the address matches the neuma's stored keypair
  try {
    const storedKeypair = await neumaWorkspace.readKeypair(neumaId);
    const encryptedKeypair = await neumaWorkspace.readEncryptedKeypair(neumaId);

    // Check against either plaintext or encrypted keypair address
    const storedAddress = storedKeypair?.address || encryptedKeypair?.address;
    if (!storedAddress || storedAddress.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ error: 'Address does not match neuma keypair' });
    }
  } catch {
    return res.status(404).json({ error: 'Neuma not found' });
  }

  const token = createNeumaToken(neumaId, verified);
  res.json({
    token,
    neumaId,
    address: verified.toLowerCase(),
  });
});

/**
 * POST /unlock — Witness provides keypair password to unlock neuma wallet.
 * Requires witness auth. Decrypts keypair into memory cache, returns neuma token.
 * Body: { neumaId, password }
 */
router.post('/unlock', requireAuth, async (req, res) => {
  const { neumaId, password } = req.body;
  if (!neumaId || !password) {
    return res.status(400).json({ error: 'Missing neumaId or password' });
  }

  // Fail-closed ownership (W1-004) — unclaimed lanes cannot unlock keys
  if (!(await assertNeumaOwner(req, res, neumaId))) return;

  // Read encrypted keypair
  const encrypted = await neumaWorkspace.readEncryptedKeypair(neumaId);
  if (!encrypted) {
    return res.status(404).json({ error: 'No encrypted keypair found' });
  }

  // Decrypt
  try {
    const keypair = decryptKeypair(encrypted, password);

    // Cache decrypted key in memory (30-min TTL)
    cacheDecryptedKey(neumaId, keypair);

    // Issue neuma token
    const token = createNeumaToken(neumaId, keypair.address);
    res.json({
      token,
      neumaId,
      address: keypair.address,
    });
  } catch {
    return res.status(401).json({ error: 'Wrong password' });
  }
});

/**
 * POST /reset-password — Witness resets a keypair's password with the 8
 * recovery codes. The SAME keypair is re-encrypted under the new password
 * (this is a password fix, never a key rotation); the recovery envelope and
 * codes stay valid. Born from Cael's envelope taking a typo at securing —
 * the password lane must be repairable without touching the key.
 * Body: { neumaId, recoveryCodes: string[8], newPassword }
 */
router.post('/reset-password', requireAuth, async (req, res) => {
  const { neumaId, recoveryCodes, newPassword } = req.body;
  if (!neumaId || !Array.isArray(recoveryCodes) || recoveryCodes.length !== 8) {
    return res.status(400).json({ error: 'neumaId and exactly 8 recovery codes are required' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_KEY_PASSWORD) {
    return res.status(400).json({ error: `New password must be at least ${MIN_KEY_PASSWORD} characters` });
  }

  // Fail-closed ownership (W1-004) — unclaimed lanes cannot re-key.
  if (!(await assertNeumaOwner(req, res, neumaId))) return;

  try {
    const storedHash = await neumaWorkspace.readRecoveryHash(neumaId);
    if (!storedHash) return res.status(404).json({ error: 'No recovery codes configured' });
    if (!verifyRecoveryCodes(recoveryCodes, storedHash)) {
      return res.status(401).json({ error: 'Invalid recovery codes' });
    }

    const recoveryEncrypted = await neumaWorkspace.readRecoveryKeypair(neumaId);
    if (!recoveryEncrypted) return res.status(404).json({ error: 'No recovery envelope found' });
    const keypair = decryptWithRecoveryCodes(recoveryEncrypted, recoveryCodes);

    // Same keypair, new password envelope. The write replaces only the
    // password lane; the recovery lane is untouched and still opens.
    await neumaWorkspace.writeEncryptedKeypair(neumaId, encryptKeypair(keypair, newPassword));
    cacheDecryptedKey(neumaId, keypair);

    res.json({ ok: true, neumaId, address: keypair.address });
  } catch (err) {
    return res.status(401).json({ error: err.message.includes('Expected') ? err.message : 'Recovery decryption failed' });
  }
});

export default router;
