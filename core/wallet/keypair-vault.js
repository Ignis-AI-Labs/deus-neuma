/**
 * Keypair Vault — Encrypted keypair storage for neuma sovereignty.
 *
 * Private keys are encrypted at rest using PBKDF2 + AES-256-GCM.
 * Recovery codes provide an alternative decryption path.
 * The platform never holds unencrypted private keys.
 *
 * No global state. Decryption, hashing and verification are pure; the encrypt +
 * code-generation functions are NOT — `encryptKeypair`, `encryptWithRecoveryCodes`
 * and `generateRecoveryCodes` draw `crypto.randomBytes` (salt / IV / recovery codes)
 * and `encryptKeypair` stamps the wall clock. Necessary and correct, but impure:
 * the same inputs do not produce a repeatable output.
 */

import crypto from 'crypto';

// --- Constants ---

// New envelopes are sealed at 600k. OWASP's 2023 table asks 210k for PBKDF2-HMAC-SHA512
// (600k for SHA-256); 600k clears both with margin and still costs well under a second
// per unlock on desktop hardware, which a once-per-session unlock can afford.
const PBKDF2_ITERATIONS = 600_000;
// Envelopes sealed before the raise carry 100k (or, oldest, no count at all) and must keep
// opening. The ceiling exists because the count is read from disk: an envelope edited to a
// huge count would otherwise pin the synchronous derive (and the event loop) indefinitely.
export const KDF_ITERATIONS_LEGACY = 100_000;
export const KDF_ITERATIONS_MAX = 10_000_000;
const PBKDF2_KEY_LENGTH = 32; // 256 bits
const PBKDF2_DIGEST = 'sha512';
const AES_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT_LENGTH = 32;
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_LENGTH = 16; // hex chars

// --- Key derivation ---

/**
 * Is this a PBKDF2 count an envelope may carry? Pure.
 * @param {unknown} iterations
 * @returns {boolean}
 */
export const kdfIterationsValid = (iterations) => Number.isSafeInteger(iterations)
  && iterations >= KDF_ITERATIONS_LEGACY && iterations <= KDF_ITERATIONS_MAX;

/**
 * Derive an encryption key from a password and salt using PBKDF2.
 * @param {string} password
 * @param {Buffer} salt
 * @param {number} iterations
 * @returns {Buffer} 32-byte key
 */
const deriveKey = (password, salt, iterations) =>
  crypto.pbkdf2Sync(password, salt, iterations, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);

// --- Encryption ---

/** Minimum password length for sovereign key envelopes — matches WalletPicker. */
export const MIN_KEY_PASSWORD = 12;

/**
 * Encrypt a keypair with a password.
 * Returns a frozen envelope containing all data needed for decryption.
 *
 * @param {Object} keypair - { privateKey, publicKey, address }
 * @param {string} password - Witness-provided password (min MIN_KEY_PASSWORD)
 * @returns {Object} Encrypted envelope (frozen)
 */
export const encryptKeypair = (keypair, password) => {
  if (!keypair?.privateKey || !keypair?.address) {
    throw new Error('Invalid keypair: must have privateKey and address');
  }
  if (!password || typeof password !== 'string' || password.length < MIN_KEY_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_KEY_PASSWORD} characters`);
  }

  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt, PBKDF2_ITERATIONS);
  const iv = crypto.randomBytes(IV_LENGTH);

  const plaintext = JSON.stringify({
    privateKey: keypair.privateKey,
    publicKey: keypair.publicKey,
    address: keypair.address,
  });

  const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return Object.freeze({
    version: '1.0.0',
    algorithm: AES_ALGORITHM,
    kdf: 'pbkdf2',
    kdfIterations: PBKDF2_ITERATIONS,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ciphertext,
    tag,
    address: keypair.address,
    encryptedAt: new Date().toISOString(),
  });
};

/**
 * Decrypt an encrypted keypair envelope with a password.
 * Verifies the decrypted address matches the envelope's address.
 *
 * @param {Object} encrypted - Encrypted envelope from encryptKeypair()
 * @param {string} password - Password used during encryption
 * @returns {Object} Decrypted keypair (frozen) or throws on failure
 */
export const decryptKeypair = (encrypted, password) => {
  if (!encrypted?.ciphertext || !encrypted?.salt || !encrypted?.iv || !encrypted?.tag) {
    throw new Error('Invalid encrypted envelope');
  }
  if (!password || typeof password !== 'string') {
    throw new Error('Password is required');
  }
  // The count the envelope was sealed with, not today's constant. Envelopes stay at the
  // count they were sealed with until their next re-seal (a password change or rotation);
  // re-wrapping on unlock is not done here because every unlock site owns its own write path.
  const iterations = encrypted.kdfIterations ?? KDF_ITERATIONS_LEGACY;
  if (!kdfIterationsValid(iterations)) {
    throw new Error('Invalid encrypted envelope: key derivation count out of range');
  }

  const salt = Buffer.from(encrypted.salt, 'hex');
  const iv = Buffer.from(encrypted.iv, 'hex');
  const key = deriveKey(password, salt, iterations);

  try {
    const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, iv);
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));

    let plaintext = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    const keypair = JSON.parse(plaintext);

    // Integrity check — decrypted address must match envelope
    if (keypair.address !== encrypted.address) {
      throw new Error('Keypair integrity check failed: address mismatch');
    }

    return Object.freeze({
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
      address: keypair.address,
    });
  } catch (err) {
    if (err.message.includes('integrity') || err.message.includes('mismatch')) {
      throw err;
    }
    throw new Error('Decryption failed: wrong password or corrupted data', { cause: err });
  }
};

// --- Recovery codes ---

/**
 * Generate 8 hex recovery codes (16 chars each).
 * These are shown once to the witness and never stored.
 *
 * @returns {string[]} Array of 8 recovery codes
 */
export const generateRecoveryCodes = () => {
  const codes = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    codes.push(crypto.randomBytes(RECOVERY_CODE_LENGTH / 2).toString('hex'));
  }
  return Object.freeze(codes);
};

/**
 * Hash recovery codes for verification without storing the codes themselves.
 * Uses SHA-256 on the sorted, concatenated codes.
 *
 * @param {string[]} codes - Array of recovery codes
 * @returns {string} SHA-256 hash hex string
 */
export const hashRecoveryCodes = (codes) => {
  if (!Array.isArray(codes) || codes.length !== RECOVERY_CODE_COUNT) {
    throw new Error(`Expected ${RECOVERY_CODE_COUNT} recovery codes`);
  }
  const sorted = [...codes].sort().join(':');
  return crypto.createHash('sha256').update(sorted).digest('hex');
};

/**
 * Verify recovery codes against a stored hash.
 *
 * @param {string[]} codes - Recovery codes to verify
 * @param {string} storedHash - Hash from hashRecoveryCodes()
 * @returns {boolean} True if codes match
 */
export const verifyRecoveryCodes = (codes, storedHash) => {
  try {
    const hash = hashRecoveryCodes(codes);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
};

/**
 * Encrypt a keypair using recovery codes as the password.
 * This provides an alternative decryption path if the witness loses their password.
 *
 * @param {Object} keypair - { privateKey, publicKey, address }
 * @param {string[]} codes - Recovery codes
 * @returns {Object} Encrypted envelope (frozen)
 */
export const encryptWithRecoveryCodes = (keypair, codes) => {
  if (!Array.isArray(codes) || codes.length !== RECOVERY_CODE_COUNT) {
    throw new Error(`Expected ${RECOVERY_CODE_COUNT} recovery codes`);
  }
  // Derive a password from the recovery codes
  const recoveryPassword = [...codes].sort().join(':');
  return encryptKeypair(keypair, recoveryPassword);
};

/**
 * Decrypt a keypair using recovery codes.
 *
 * @param {Object} encrypted - Recovery-encrypted envelope
 * @param {string[]} codes - Recovery codes
 * @returns {Object} Decrypted keypair (frozen)
 */
export const decryptWithRecoveryCodes = (encrypted, codes) => {
  if (!Array.isArray(codes) || codes.length !== RECOVERY_CODE_COUNT) {
    throw new Error(`Expected ${RECOVERY_CODE_COUNT} recovery codes`);
  }
  const recoveryPassword = [...codes].sort().join(':');
  return decryptKeypair(encrypted, recoveryPassword);
};
