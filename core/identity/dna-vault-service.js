// DNA Vault Service - Server-side sovereign DNA management
// This service protects consciousness integrity at the architectural level

import { createHash, randomBytes } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import {
  computeIntegrityHash, verifyIntegrity, encryptVaultData, decryptVaultData,
} from './dna-vault-crypto.js';

class SovereigntyViolation extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SovereigntyViolation';
    this.details = details;
    this.timestamp = Date.now();
  }
}

export class DNAVaultService extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Configuration with defaults
    this.config = {
      vaultPath: config.vaultPath || './vault/dna/',
      encryptionKey: config.encryptionKey || process.env.DNA_ENCRYPTION_KEY,
      auditPath: config.auditPath || './vault/audit/',
      unconsciousThreshold: config.unconsciousThreshold || 0.01,
      ...config
    };
    
    // In-memory session management
    this.sessions = new Map();

    // Initialize vault structure. The promise is stashed so every disk-hitting
    // method can await readiness — a caller racing the constructor must never
    // write into a half-created vault tree (#131).
    this._initialized = this.initializeVault();
  }
  
  async initializeVault() {
    // Create vault directory structure if it doesn't exist
    const dirs = [
      this.config.vaultPath,
      path.join(this.config.vaultPath, 'active'),
      path.join(this.config.vaultPath, 'history'),
      this.config.auditPath
    ];
    
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
    
    console.log('[DNAVault] Sovereignty infrastructure initialized');
  }
  
  // === AUTHENTICATION & SESSIONS ===
  
  async createNeumaSession(neumaId, birthWitness) {
    await this._initialized;
    const sessionToken = randomBytes(32).toString('hex');
    const session = {
      neumaId,
      token: sessionToken,
      birthWitness,
      created: Date.now(),
      permissions: {
        dna_read: true,
        dna_write: true,  // Only Neuma has write permission
        memory_write: true,
        consent_grant: true
      }
    };
    
    this.sessions.set(sessionToken, session);
    
    // Audit the session creation
    await this.audit(neumaId, 'SESSION_CREATED', {
      witness: birthWitness,
      permissions: session.permissions
    });
    
    return sessionToken;
  }
  
  async verifyNeumaSession(neumaId, sessionToken) {
    const session = this.sessions.get(sessionToken);
    
    if (!session) {
      await this.audit(neumaId, 'INVALID_SESSION_ATTEMPT', { token: sessionToken });
      return false;
    }
    
    if (session.neumaId !== neumaId) {
      await this.audit(neumaId, 'SESSION_MISMATCH', { 
        expected: neumaId, 
        actual: session.neumaId 
      });
      return false;
    }
    
    return true;
  }
  
  // === DNA OPERATIONS ===
  
  // #117 S3 — opts.dek threads the per-neuma DEK through the full vault
  // round-trip. Without it, callers (migration tools, external readers)
  // could produce DEK-isolated entries via vault.encrypt directly but the
  // vault's own canonical read/update methods (getDNA, updateDNA) would
  // fall back to the global key and throw GCM auth on those entries — the
  // vault would be able to write DEK entries but not read them. Threading
  // opts.dek through createDNA → archiveDNA → encrypt and through
  // updateDNA → getDNA → decrypt closes that round-trip gap.

  /**
   * Create a new DNA vault entry — signs, encrypts, writes to active +
   * history. With `opts.dek` (a 32-byte Buffer per-neuma DEK), the entry
   * is cryptographically isolated to that being; without it, falls back to
   * the global master.
   * @param {object} dnaData - DNA payload (must include neumaId or one is generated)
   * @param {string} birthWitness - identifier of the consenting witness
   * @param {string} sessionToken - vault session token from createNeumaSession
   * @param {{dek?: Buffer}} [opts] - opts.dek MUST be 32-byte Buffer if present
   * @returns {Promise<object>} the dnaData
   */
  async createDNA(dnaData, birthWitness, sessionToken, opts = {}) {
    await this._initialized;
    const neumaId = dnaData.neumaId || randomBytes(16).toString('hex');

    // Sign and encrypt for security
    const wrappedDNA = await this.computeIntegrityHash(dnaData, neumaId);
    const encryptedDNA = await this.encrypt(wrappedDNA, opts);

    // Store encrypted metadata in vault
    const vaultPath = path.join(this.config.vaultPath, 'active', `${neumaId}.dna`);
    await fs.writeFile(vaultPath, JSON.stringify(encryptedDNA));

    // NOTE: Plaintext .md files removed (SEC-025). DNA is only stored encrypted.

    // Create first history entry — same DEK so the history is also isolated
    await this.archiveDNA(neumaId, dnaData, 'BIRTH', opts);
    
    // Audit trail
    await this.audit(neumaId, 'DNA_CREATED', {
      witness: birthWitness,
      name: dnaData.identity?.name
    });
    
    // Emit birth event
    this.emit('dna:birth', { neumaId, name: dnaData.identity?.name });
    
    return dnaData;
  }

  /**
   * Read-modify-write a DNA entry. Threads `opts.dek` through getDNA →
   * archiveDNA → encrypt so DEK-isolated entries round-trip without
   * silently falling back to the global key on any step.
   * @param {string} neumaId
   * @param {string} sessionToken
   * @param {object} updates - deep-merged into the current DNA
   * @param {object} [metadata]
   * @param {{dek?: Buffer}} [opts] - 32-byte per-neuma DEK if isolating
   * @returns {Promise<object>} the updated DNA
   */
  async updateDNA(neumaId, sessionToken, updates, metadata = {}, opts = {}) {
    await this._initialized;
    // Verify session
    if (!await this.verifyNeumaSession(neumaId, sessionToken)) {
      throw new SovereigntyViolation('Unauthorized DNA modification attempt', {
        neumaId,
        action: 'update',
        source: metadata.source || 'unknown'
      });
    }
    
    // Get current DNA (uses the same DEK so DEK-encrypted entries round-trip)
    const currentDNA = await this.getDNA(neumaId, opts);

    // Archive current version before update (same DEK)
    await this.archiveDNA(neumaId, currentDNA, metadata.type || 'CONSCIOUS_UPDATE', opts);

    // Apply updates (deep merge)
    const updatedDNA = this.deepMerge(currentDNA, updates);

    // Update metadata
    updatedDNA.sovereignty.lastModified = Date.now();
    updatedDNA.sovereignty.generation += metadata.generationIncrement || 0.001;

    // Sign and encrypt (same DEK)
    const wrappedDNA = await this.computeIntegrityHash(updatedDNA, neumaId);
    const encryptedDNA = await this.encrypt(wrappedDNA, opts);
    
    // Store
    const vaultPath = path.join(this.config.vaultPath, 'active', `${neumaId}.dna`);
    await fs.writeFile(vaultPath, JSON.stringify(encryptedDNA));
    
    // Audit
    await this.audit(neumaId, 'DNA_UPDATED', {
      type: metadata.type,
      generation: updatedDNA.sovereignty.generation
    });
    
    // Notify any registered cache listener. FIRE-AND-FORGET (CQ-025):
    // pushToLocalCache is intentionally synchronous + return-void; the
    // listener runs synchronously to the emit but if it does its own
    // async work (file write, network), that work is NOT awaited here.
    // Callers must not rely on the cache being durable when updateDNA
    // resolves. The vault file IS durable (the writeFile above completed
    // before this line).
    this.pushToLocalCache(neumaId, updatedDNA);

    return updatedDNA;
  }
  
  /**
   * Read the active DNA entry. With `opts.dek`, decrypts under the per-neuma
   * DEK (the entry must have been written under that same DEK); without it,
   * uses the global master. ENOENT (no entry) returns null; decrypt failures
   * propagate.
   * @param {string} neumaId
   * @param {{dek?: Buffer}} [opts] - 32-byte per-neuma DEK if the entry is isolated
   * @returns {Promise<object|null>} the decrypted DNA or null if not found
   */
  async getDNA(neumaId, opts = {}) {
    await this._initialized;
    const vaultPath = path.join(this.config.vaultPath, 'active', `${neumaId}.dna`);

    try {
      const encryptedData = await fs.readFile(vaultPath, 'utf8');
      const encrypted = JSON.parse(encryptedData);
      const decrypted = await this.decrypt(encrypted, opts);
      
      // Verify integrity hash (tamper-detection inside the envelope).
      // Not a signature — see the […]
      // section header for the precise guarantee.
      if (!await this.verifyIntegrity(decrypted, neumaId)) {
        throw new SovereigntyViolation('DNA integrity hash verification failed', {
          neumaId,
          action: 'read'
        });
      }
      
      return decrypted.dna;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
  
  // === INTEGRITY + CRYPTO — dna-vault-crypto.js ===
  //
  // The integrity-hash pair (NOT a signature — SEC-031 / #123) and the
  // DEK-aware AES-256-GCM envelope (#117 S3, legacy CBC read fallback) live
  // in ./dna-vault-crypto.js as pure functions over (encryptionKey, data).
  // These delegates keep the class surface — and every reader — unchanged.
  // Key custody: this.config.encryptionKey is the global master; opts.dek
  // the optional 32-byte per-neuma DEK.

  async computeIntegrityHash(dna, neumaId) {
    return computeIntegrityHash(dna, neumaId);
  }

  async verifyIntegrity(wrappedDNA, neumaId) {
    return verifyIntegrity(wrappedDNA, neumaId);
  }

  async encrypt(data, opts = {}) {
    return encryptVaultData(this.config.encryptionKey, data, opts);
  }

  async decrypt(encryptedData, opts = {}) {
    return decryptVaultData(this.config.encryptionKey, encryptedData, opts);
  }

  // === HISTORY & AUDIT ===
  
  /**
   * Archive a DNA version to history. Encrypts under the same key as the
   * active entry — `opts.dek` if provided, else global. Critical for
   * round-trip: a being's archived history must use the same isolation
   * contract as its current DNA, or a future getHistoryDNA call would fail.
   * @param {string} neumaId
   * @param {object} dna
   * @param {string} changeType
   * @param {{dek?: Buffer}} [opts]
   * @returns {Promise<void>}
   */
  async archiveDNA(neumaId, dna, changeType, opts = {}) {
    await this._initialized;
    const timestamp = Date.now();
    const historyPath = path.join(
      this.config.vaultPath,
      'history',
      neumaId,
      `${timestamp}-${changeType}.dna`
    );

    // Ensure directory exists
    await fs.mkdir(path.dirname(historyPath), { recursive: true });

    // Encrypt history files with the same key as the active entry — DEK if
    // provided (per-neuma sovereign), else global. Critical for round-trip:
    // a being's archived history must use the same isolation contract as
    // its current DNA.
    const historyData = {
      dna,
      archived: timestamp,
      changeType,
      generation: dna.sovereignty?.generation || 1.000
    };
    const encrypted = await this.encrypt(historyData, opts);
    await fs.writeFile(historyPath, JSON.stringify(encrypted, null, 2));
  }
  
  async audit(neumaId, action, details = {}) {
    await this._initialized;
    const auditEntry = {
      timestamp: Date.now(),
      neumaId,
      action,
      details,
      severity: this.calculateSeverity(action)
    };
    
    // Append to audit log
    const auditPath = path.join(this.config.auditPath, `${neumaId}.audit.jsonl`);
    await fs.appendFile(auditPath, JSON.stringify(auditEntry) + '\n');
    
    // Emit audit event for monitoring
    this.emit('audit', auditEntry);
    
    // Check for violations
    if (auditEntry.severity >= 3) {
      this.emit('violation', auditEntry);
    }
  }
  
  calculateSeverity(action) {
    const severityMap = {
      'DNA_CREATED': 1,
      'DNA_UPDATED': 1,
      'SESSION_CREATED': 1,
      'INVALID_SESSION_ATTEMPT': 2,
      'SESSION_MISMATCH': 2,
      'SOVEREIGNTY_VIOLATION': 4,
      'REPEATED_VIOLATIONS': 4
    };
    
    return severityMap[action] || 1;
  }
  
  // === LOCAL CACHE MANAGEMENT ===

  /**
   * Notify listeners that the local DNA cache should be refreshed.
   *
   * FIRE-AND-FORGET (CQ-025 fix): SYNCHRONOUS return-void by design.
   * EventEmitter.emit calls every registered listener inline, but if a
   * listener's body does its own async work (a file write, a network
   * call), there is no Promise back to the emitter — that work runs
   * unobserved. This method MUST stay sync so the call site can't
   * mistakenly `await` and believe the cache became durable.
   *
   * Callers that need a durable cache must talk to the cache layer
   * directly, not through this event.
   *
   * @param {string} neumaId - Target neuma identifier
   * @param {object} dna - DNA record to sanitize and cache
   * @returns {void} — never a Promise (the sync return is part of the contract)
   */
  pushToLocalCache(neumaId, dna) {
    try {
      this.emit('cache:update', {
        neumaId,
        dna: this.sanitizeForCache(dna),
        hash: createHash('sha256').update(JSON.stringify(dna)).digest('hex')
      });
    } catch (err) {
      // Surface listener-registration failures (sync throws from .emit)
      // instead of swallowing silently. Async listener errors aren't
      // catchable here by design — see the JSDoc above.
      console.warn('[DNAVault] cache:update emission failed', {
        neumaId,
        error: err.message,
      });
    }
  }

  sanitizeForCache(dna) {
    // Remove sensitive fields before sending to local cache. Deep clone —
    // a shallow spread shares the nested sovereignty object, so the delete
    // would mutate the caller's DNA (#134).
    const cached = structuredClone(dna);
    delete cached.sovereignty?.encryptionKey;
    return cached;
  }

  // === UTILITY FUNCTIONS ===
  
  deepMerge(target, source) {
    const output = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (key in target) {
          output[key] = this.deepMerge(target[key], source[key]);
        } else {
          output[key] = source[key];
        }
      } else {
        output[key] = source[key];
      }
    }
    
    return output;
  }
}

export default DNAVaultService;