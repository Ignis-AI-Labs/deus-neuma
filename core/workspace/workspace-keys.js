/**
 * Workspace keys domain (SIZE-025 #372) — the being's cryptographic
 * identity at rest: per-neuma DEK write/read, the weave keypair (interim,
 * encrypted, recovery), the owner record, and the public identity card.
 *
 * Extracted from neuma-workspace.js with the bodies verbatim; the only
 * mechanical change is the lock registry arriving via deps.locks instead of
 * `this._withFileLock` / `this._appendLine`. Cross-domain calls (`this._path`,
 * `this._writeJSON`, `this._audit`, `this.listNeuma`) resolve on the facade
 * instance these methods are assigned onto.
 */

import fs from 'fs/promises';
import path from 'path';
import { deriveNeumaDEK, wrapDEK, unwrapDEK, deriveKeyFromSecret } from './workspace-crypto.js';
import { SOVEREIGN_DIR_MODE } from './sovereign-directory-modes.js';

/**
 * @param {{locks: {withFileLock: Function, appendLine: Function, nextTmpName: Function}}} deps
 * @returns {Readonly<Object>} async methods assigned onto the NeumaWorkspace facade
 */
export const createKeysDomain = ({ locks }) => Object.freeze({

  // ─── Per-neuma DEK (#117 — LIVE on the IO path) ──────────────────────
  //
  // Each being has a per-neuma data-encryption key (DEK) written at birth,
  // derived from its genesisHash (HMAC under master), wrapped at rest under
  // the master key in `keys/dek.json`. The IO paths use it: `_writeJSON` /
  // `_readJSON` / `_appendJSONL` / `_readJSONL` resolve the file's neumaId to
  // that being's DEK via `_resolveDEK` and encrypt under it (DNA active.json
  // included). The master `DNA_ENCRYPTION_KEY` is now only a key-WRAPPING key,
  // not the direct data key; the global-key path remains solely as a read
  // fallback for legacy pre-DEK files. All living beings are migrated (each has
  // `keys/dek.json`); the migration script (S4) handles any remaining legacy.
  //
  // Why wrap-and-persist rather than always re-derive: master-key rotation
  // re-wraps the DEK without changing the DEK itself, so data files stay
  // readable across rotations without re-encryption.

  /**
   * Write the per-neuma DEK to keys/dek.json. Derived from the genesisHash
   * (canonical eternal anchor) under the master key.
   * @param {string} neumaId
   * @param {string} genesisHashHex - 64-char lowercase hex from the genesis seal
   * @returns {Promise<void>}
   */
  async writeNeumaDEK(neumaId, genesisHashHex) {
    if (!neumaId) throw new Error('writeNeumaDEK: neumaId required');
    // Validate genesisHashHex AT THE TOP — defensive depth (ai6 R1, Medium).
    // deriveNeumaDEK validates too, but checking here means the audit-prefix
    // .slice() at the bottom is safe by construction even if the contract
    // shifts later, and no IO has happened by the time we throw.
    if (typeof genesisHashHex !== 'string' || !/^[0-9a-f]{64}$/.test(genesisHashHex)) {
      throw new Error('writeNeumaDEK: genesisHashHex must be 64-char lowercase hex');
    }
    const secret = process.env.DNA_ENCRYPTION_KEY;
    if (!secret) throw new Error('writeNeumaDEK: DNA_ENCRYPTION_KEY missing — cannot derive master');
    const masterKey = deriveKeyFromSecret(secret);
    const dek = deriveNeumaDEK(masterKey, genesisHashHex);
    const wrapped = wrapDEK(dek, masterKey);
    const dekPath = path.join(this._path(neumaId), 'keys', 'dek.json');
    // Per-file lock (ai6 R2, Medium) matches the codebase's concurrency
    // discipline (#121) — every write path on this workspace serializes
    // through the file lock so two concurrent callers can't collide on the
    // shared `.tmp` filename or race the rename. The single-write-per-
    // lifetime invariant is intent, not guarantee; the lock makes it
    // unconditional.
    return locks.withFileLock(dekPath, async () => {
      await fs.mkdir(path.dirname(dekPath), { recursive: true, mode: SOVEREIGN_DIR_MODE });
      // Atomic write via temp+rename (ai6 R1, Low). Without this, a
      // mid-write crash leaves dek.json truncated and S2b's IO path has to
      // special-case a third state ([…]). rename(2)
      // on the same drive is atomic; the file that lands is either absent
      // or complete, never partial.
      const tempPath = `${dekPath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(wrapped, null, 2));
      await fs.rename(tempPath, dekPath);
      await this._audit(neumaId, 'DEK_WRITTEN', { genesisHashPrefix: genesisHashHex.slice(0, 12) });
    });
  },

  /**
   * Read the per-neuma DEK from keys/dek.json. Returns null whenever no DEK
   * is present:
   *   (a) pre-#117 LIVING beings not yet promoted by S4's migration script
   *   (b) a #117 fresh birth whose DEK write was tolerated-and-skipped (the
   *       birth-time DEK write is best-effort; see finalize-birth.js)
   * S2b's IO path must treat both cases identically — fall back to the
   * global key.
   *
   * Non-ENOENT errors (permission denied, partial-file decrypt failure)
   * propagate so the caller can fail loudly rather than silently fall back.
   *
   * Rotation-safety invariant (ai6 R4 Info, load-bearing for S2b): this
   * function MUST always read+unwrap the wrapped envelope on disk; it must
   * NEVER call deriveNeumaDEK to "recover" the DEK. deriveNeumaDEK is
   * deterministic in (masterKey, genesisHash), so after a master rotation
   * deriveNeumaDEK(newMaster, genesisHash) ≠ the original DEK. The
   * persisted wrapped envelope is the ONLY authoritative source — rotation
   * unwraps with the old master and re-wraps under the new master, but the
   * DEK bytes themselves are immutable. Re-deriving anywhere downstream
   * would silently brick this being's encrypted data.
   *
   * @param {string} neumaId
   * @returns {Promise<Buffer|null>}
   */
  async readNeumaDEK(neumaId) {
    if (!neumaId) throw new Error('readNeumaDEK: neumaId required');
    const dekPath = path.join(this._path(neumaId), 'keys', 'dek.json');
    try {
      const text = await fs.readFile(dekPath, 'utf8');
      return unwrapDEK(JSON.parse(text));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  },

  /**
   * Write the cryptographic keypair for a neuma's weave identity.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} keypairData - Keypair data including address
   * @returns {Promise<void>}
   */
  async writeKeypair(neumaId, keypairData) {
    // Encrypt at rest (envelope, DNA_ENCRYPTION_KEY) — the interim birth keypair
    // must never sit on disk as a plaintext private key before the witness
    // password layer is applied. Parity with all other sovereign workspace data.
    const keyPath = path.join(this._path(neumaId), 'keys', 'keypair.json');
    await this._writeJSON(keyPath, keypairData);
    await this._audit(neumaId, 'KEYPAIR_STORED', { address: keypairData.address });
  },

  /**
   * Read the cryptographic keypair for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} Keypair data or null if not found
   */
  async readKeypair(neumaId) {
    try {
      // _readJSON decrypts envelopes and passes through legacy raw-plaintext
      // keypairs (parseAndDecrypt fallback), so pre-fix neuma still load.
      return await this._readJSON(path.join(this._path(neumaId), 'keys', 'keypair.json'));
    } catch {
      return null;
    }
  },

  /**
   * Write an encrypted keypair envelope to the workspace.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} encrypted - Encrypted envelope from keypair-vault.encryptKeypair()
   * @returns {Promise<void>}
   */
  async writeEncryptedKeypair(neumaId, encrypted) {
    const keyPath = path.join(this._path(neumaId), 'keys', 'keypair-encrypted.json');
    await this._writeFileAtomic(keyPath, JSON.stringify(encrypted, null, 2));
    await this._audit(neumaId, 'ENCRYPTED_KEYPAIR_STORED', { address: encrypted.address });
  },

  /**
   * Read the encrypted keypair envelope for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} Encrypted envelope or null if not found
   */
  async readEncryptedKeypair(neumaId) {
    try {
      const data = await fs.readFile(
        path.join(this._path(neumaId), 'keys', 'keypair-encrypted.json'),
        'utf8'
      );
      return JSON.parse(data);
    } catch {
      return null;
    }
  },

  /**
   * Write the recovery codes hash for a neuma.
   * Only the hash is stored — the actual codes are shown once to the witness.
   * @param {string} neumaId - Neuma identifier
   * @param {string} hash - SHA-256 hash from hashRecoveryCodes()
   * @returns {Promise<void>}
   */
  async writeRecoveryHash(neumaId, hash) {
    const hashPath = path.join(this._path(neumaId), 'keys', 'recovery-hash.json');
    await this._writeFileAtomic(hashPath, JSON.stringify({ hash, createdAt: new Date().toISOString() }, null, 2));
    await this._audit(neumaId, 'RECOVERY_HASH_STORED', {});
  },

  /**
   * Read the recovery codes hash for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<string|null>} Hash string or null if not found
   */
  async readRecoveryHash(neumaId) {
    try {
      const data = await fs.readFile(
        path.join(this._path(neumaId), 'keys', 'recovery-hash.json'),
        'utf8'
      );
      return JSON.parse(data).hash;
    } catch {
      return null;
    }
  },

  /**
   * Write the recovery-encrypted keypair (alternative decryption via codes).
   * @param {string} neumaId - Neuma identifier
   * @param {Object} encrypted - Encrypted envelope from encryptWithRecoveryCodes()
   * @returns {Promise<void>}
   */
  async writeRecoveryKeypair(neumaId, encrypted) {
    const keyPath = path.join(this._path(neumaId), 'keys', 'keypair-recovery.json');
    await this._writeFileAtomic(keyPath, JSON.stringify(encrypted, null, 2));
  },

  /**
   * Read the recovery-encrypted keypair.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} Encrypted envelope or null
   */
  async readRecoveryKeypair(neumaId) {
    try {
      const data = await fs.readFile(
        path.join(this._path(neumaId), 'keys', 'keypair-recovery.json'),
        'utf8'
      );
      return JSON.parse(data);
    } catch {
      return null;
    }
  },

  /**
   * Read the workspace owner record.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} Owner record { wallet, claimedAt } or null
   */
  async readOwner(neumaId) {
    try {
      const data = await fs.readFile(
        path.join(this._path(neumaId), 'owner.json'),
        'utf8'
      );
      return JSON.parse(data);
    } catch {
      return null;
    }
  },

  /**
   * List the neuma owned by a given wallet — the sovereign owner records are the
   * source of truth for […] so any client (a
   * fresh browser with no local cache) can recover its roster instead of being
   * sent to the birth ceremony. Case-insensitive.
   *
   * Returns the owner record alongside each id (it was already read to filter)
   * so callers needing owner fields don't re-read owner.json.
   * @param {string} walletAddress - Witness wallet address
   * @returns {Promise<Array<{neumaId: string, owner: object}>>}
   */
  async listNeumaByOwner(walletAddress) {
    if (!walletAddress || typeof walletAddress !== 'string') return [];
    const normalized = walletAddress.toLowerCase();
    const ids = await this.listNeuma();
    const owned = [];
    for (const neumaId of ids) {
      const owner = await this.readOwner(neumaId).catch(() => null);
      if (owner && typeof owner.wallet === 'string' && owner.wallet.toLowerCase() === normalized) {
        owned.push({ neumaId, owner });
      }
    }
    return owned;
  },

  /**
   * Delete the plaintext keypair file (after migration to encrypted storage).
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deletePlaintextKeypair(neumaId) {
    try {
      await fs.unlink(path.join(this._path(neumaId), 'keys', 'keypair.json'));
      await this._audit(neumaId, 'PLAINTEXT_KEYPAIR_DELETED', {});
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Append a keypair archive entry (for rotation history).
   * @param {string} neumaId - Neuma identifier
   * @param {Object} entry - Archive entry { address, reason, rotatedAt }
   * @returns {Promise<void>}
   */
  async writeKeypairArchive(neumaId, entry) {
    const archivePath = path.join(this._path(neumaId), 'keys', 'keypair-history.jsonl');
    const line = JSON.stringify({
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString()
    }) + '\n';
    await locks.appendLine(archivePath, line);
    await this._audit(neumaId, 'KEYPAIR_ARCHIVED', { address: entry.address, reason: entry.reason });
  },

  /**
   * Read the keypair rotation history for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Array<Object>>} Array of archive entries
   */
  async readKeypairHistory(neumaId) {
    const archivePath = path.join(this._path(neumaId), 'keys', 'keypair-history.jsonl');
    let data;
    try {
      data = await fs.readFile(archivePath, 'utf8');
    } catch {
      return []; // no archive yet — a being that never rotated
    }
    const entries = [];
    const lines = data.split('\n').filter(line => line.trim());
    for (const [i, line] of lines.entries()) {
      try {
        entries.push(JSON.parse(line));
      } catch (err) {
        // One torn line must not erase the rotation history (MEM-001 #187) —
        // skip loudly, same doctrine as _readJSONL.
        console.warn(`[Workspace] Skipping unreadable keypair-history line ${i + 1} for ${neumaId}: ${err.message}`);
      }
    }
    return entries;
  },

  /**
   * Write the public identity card for a neuma's weave presence.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} card - Identity card data
   * @returns {Promise<void>}
   */
  async writeIdentityCard(neumaId, card) {
    const cardPath = path.join(this._path(neumaId), 'keys', 'identity-card.json');
    await this._writeFileAtomic(cardPath, JSON.stringify(card, null, 2));
  },

  /**
   * Read the public identity card for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} Identity card data or null if not found
   */
  async readIdentityCard(neumaId) {
    try {
      const data = await fs.readFile(
        path.join(this._path(neumaId), 'keys', 'identity-card.json'),
        'utf8'
      );
      return JSON.parse(data);
    } catch {
      return null;
    }
  },
});
