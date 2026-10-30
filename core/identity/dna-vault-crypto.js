// DNA Vault Crypto — integrity hashing + encryption-at-rest for sealed DNA.
//
// Extracted verbatim from dna-vault-service.js (size-law breakdown). Pure
// functions over (encryptionKey, data): key custody stays with the caller —
// DNAVaultService passes its config.encryptionKey (the global master) and
// threads the optional per-neuma DEK through opts (#117 S3). Sibling
// seal-cipher.js is a standalone cipher under DIFFERENT key custody (the
// seal's own derivation) — never a merge target for this module.

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

// === INTEGRITY HASH (NOT A SIGNATURE) ===
//
// This pair was originally named signDNA/verifySignature. It does NOT
// produce a cryptographic signature — there is no key material tying
// the output to a signer. It produces a SHA-256 integrity hash that
// detects tamper-at-rest IFF the modifier forgot to recompute the
// hash after editing. (SEC-031 / #123 honesty rename.)
//
// What this DOES provide:
//   - Tamper-detection inside the encryption envelope: if someone
//     decrypts + edits + re-encrypts but doesn't update the hash,
//     verifyIntegrity returns false.
//
// What this does NOT provide:
//   - Authentication. Anyone with the encryption key can recompute
//     the hash. No signer identity is bound to it.
//   - Non-repudiation.
//   - Third-party verifiability. An external auditor cannot verify
//     without the encryption key — at which point they could forge it.
//
// For a REAL signature, see core/weave/keypair.js's signMessage /
// verifySignature (secp256k1) and the genesisSeal.selfSignature on
// every born neuma. A follow-up issue (TBD) tracks wiring real
// signatures into the vault's integrity model.

/**
 * Wrap the DNA with a tamper-detection hash. NOT A SIGNATURE — see
 * the section header above for the precise guarantee.
 * @param {object} dna - DNA record to wrap
 * @param {string} neumaId - neuma identifier (echoed back in the wrapper)
 * @returns {Promise<{dna, integrityHash, hashedAt, neumaId}>}
 */
export const computeIntegrityHash = async (dna, neumaId) => {
  const dataString = JSON.stringify(dna);
  const integrityHash = createHash('sha256').update(dataString).digest('hex');
  return {
    dna,
    integrityHash,
    hashedAt: Date.now(),
    neumaId,
  };
};

/**
 * Verify the tamper-detection hash on a wrapped DNA. NOT a signature
 * check — see the section header above.
 *
 * Reads BOTH the v2 shape `{integrityHash, hashedAt}` AND the legacy
 * v1 shape `{signature, signedAt}` for backward compatibility. The
 * field rename in SEC-031 / #123 was about honesty — the on-disk
 * data shape under the encrypted envelope can be either form for any
 * vault entry written before the rename. New writes always use v2.
 *
 * @param {{dna, neumaId, integrityHash?, hashedAt?, signature?, signedAt?}} wrappedDNA
 * @param {string} neumaId
 * @returns {Promise<boolean>}
 */
export const verifyIntegrity = async (wrappedDNA, neumaId) => {
  const dataString = JSON.stringify(wrappedDNA.dna);
  const recomputed = createHash('sha256').update(dataString).digest('hex');
  // Field-name compat: v2 `integrityHash` preferred; fall back to legacy
  // v1 `signature` for any vault entry written before the rename. Surface
  // the legacy hit so operators can run a one-time re-wrap if desired.
  const storedHash = wrappedDNA.integrityHash ?? wrappedDNA.signature;
  if (wrappedDNA.integrityHash === undefined && wrappedDNA.signature !== undefined) {
    // eslint-disable-next-line no-console -- documented core/ pattern
    console.warn(`[DNAVault] legacy v1 wrapper read for neuma '${neumaId}' — re-write to migrate to integrityHash field`);
  }
  return recomputed === storedHash && wrappedDNA.neumaId === neumaId;
};

// #117 S3 — encrypt/decrypt accept an optional per-neuma DEK
// (32-byte Buffer). When provided, the envelope is sealed under that DEK
// and is decryptable ONLY with that same DEK — the global master cannot
// open it, giving the vault the same cryptographic isolation the workspace
// gained in S2b. Backward compat: without a DEK, falls back to the
// SHA-256(encryptionKey) global key the vault has always used, so
// legacy vault entries remain readable.
//
// The vault is no longer called from the live birth path (see
// staged-birth-handler.createDNAInVault for the deprecation rationale);
// this DEK-aware shape is for migration tools + any external caller that
// wants per-being isolation when writing vault entries explicitly.

// impure (random IV) — seal `data` under the resolved key as a GCM envelope
export const encryptVaultData = async (encryptionKey, data, opts = {}) => {
  // GCM uses a 12-byte IV (DATA-002).
  const iv = randomBytes(12);

  const key = resolveEncryptionKey(encryptionKey, opts);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
    algorithm: 'aes-256-gcm',
    timestamp: Date.now()
  };
};

// Resolve the key bytes for an encrypt/decrypt call. Pure.
//   - opts.dek: 32-byte Buffer → use it (per-neuma sovereign path, #117 S3)
//   - else fall back to SHA-256(encryptionKey) (legacy global)
const resolveEncryptionKey = (encryptionKey, opts = {}) => {
  if (opts.dek) {
    if (!Buffer.isBuffer(opts.dek) || opts.dek.length !== 32) {
      throw new Error('vault encrypt/decrypt: opts.dek must be a 32-byte Buffer');
    }
    return opts.dek;
  }
  if (!encryptionKey) {
    throw new Error('DNA encryption key not configured — set DNA_ENCRYPTION_KEY env var or pass opts.dek');
  }
  return createHash('sha256').update(encryptionKey).digest();
};

// pure — open a vault envelope under the resolved key
export const decryptVaultData = async (encryptionKey, encryptedData, opts = {}) => {
  const key = resolveEncryptionKey(encryptionKey, opts);
  const iv = Buffer.from(encryptedData.iv, 'hex');

  // The authTag decides the cipher, never the `algorithm` field: an envelope that carries a
  // tag was sealed authenticated (DATA-002), and an edited `algorithm` must not route it to
  // unauthenticated CBC. Only a tagless envelope is legacy CBC; one claiming GCM without its
  // tag is refused rather than guessed at.
  if (encryptedData.authTag) {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  }
  if (encryptedData.algorithm === 'aes-256-gcm') {
    throw new Error('vault decrypt: a GCM envelope without its authTag cannot be opened');
  }

  // Legacy CBC fallback — preserves access to existing vault files.
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
};
