// Vault crypto core — the witness wallet's at-rest encryption.
//
// Pure and dependency-free (Node's built-in crypto only) so it runs in the
// Electron main process AND under vitest with no electron import. The renderer
// fallback (frontend) mirrors THIS envelope format with WebCrypto + @noble.
//
// Design — a versioned, crypto-agile envelope:
//   - The secret payload (the BIP-39 mnemonic, or an imported private key) is
//     sealed with AES-256-GCM under a key derived from the witness password via
//     scrypt — the same memory-hard KDF the Ethereum keystore (Web3 Secret
//     Storage) standardizes on (geth "standard" = N=2^18).
//   - The GCM auth tag is APPENDED to the ciphertext (WebCrypto convention) so
//     the Node and WebCrypto implementations read a single `ct` field.
//   - `v` (version) + recorded `kdfParams` let us migrate primitives later
//     without bricking existing wallets. Legacy v0 (PBKDF2-100k, private-key
//     payload) is readable here so it can be transparently re-sealed to v1.
//
// This module never touches the network, the filesystem, or `electron` — its
// only impurity is randomness (salt/iv) and the default creation timestamp,
// both isolated in createVault and marked `// impure`.

const crypto = require('node:crypto');

const CURRENT_VERSION = 1;
const GCM_TAG_BYTES = 16;
const GCM_IV_BYTES = 12;
const KDF_SALT_BYTES = 16;
const PBKDF2_LEGACY_ITERS = 100_000; // v0 renderer format (PBKDF2-SHA256)

// scrypt params — geth "standard" security (N=2^18 ≈ 256 MiB, ~0.5s on
// desktop). Recorded per-vault in the envelope so they can evolve over time.
const SCRYPT_DEFAULTS = Object.freeze({ N: 262_144, r: 8, p: 1, dkLen: 32 });
const SCRYPT_MAXMEM = 600 * 1024 * 1024; // headroom over the 256 MiB working set

const SECRET_TYPES = Object.freeze(['mnemonic', 'privateKey']);

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (str) => Buffer.from(str, 'base64');

// pure — derive a key from password + salt via scrypt (deterministic, CPU-heavy)
const deriveKey = (password, salt, params = SCRYPT_DEFAULTS) => {
  const { N, r, p, dkLen } = params;
  return crypto.scryptSync(Buffer.from(password, 'utf8'), salt, dkLen, { N, r, p, maxmem: SCRYPT_MAXMEM });
};

// pure — AES-256-GCM seal; returns ciphertext WITH the 16-byte auth tag appended
const seal = (plaintext, key, iv) => {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  return Buffer.concat([body, cipher.getAuthTag()]);
};

// pure — AES-256-GCM open; expects ciphertext WITH the trailing auth tag.
// Throws on a wrong key or any tampering (GCM authentication failure).
const open = (ctWithTag, key, iv) => {
  if (ctWithTag.length < GCM_TAG_BYTES) throw new Error('vault: ciphertext too short');
  const tag = ctWithTag.subarray(ctWithTag.length - GCM_TAG_BYTES);
  const body = ctWithTag.subarray(0, ctWithTag.length - GCM_TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
};

const validatePayload = (payload) => {
  if (!payload || typeof payload !== 'object') throw new Error('vault: payload must be an object');
  if (!SECRET_TYPES.includes(payload.type)) throw new Error('vault: payload.type must be mnemonic|privateKey');
  if (typeof payload.secret !== 'string' || payload.secret.length === 0) {
    throw new Error('vault: payload.secret must be a non-empty string');
  }
};

// pure — assemble a v1 envelope from a derived key + salt + iv
const buildEnvelope = ({ payload, key, salt, iv, params, address, createdAt }) =>
  Object.freeze({
    v: CURRENT_VERSION,
    kdf: 'scrypt',
    kdfParams: Object.freeze({ N: params.N, r: params.r, p: params.p, dkLen: params.dkLen, salt: b64(salt) }),
    cipher: 'aes-256-gcm',
    iv: b64(iv),
    ct: b64(seal(JSON.stringify(payload), key, iv)),
    address: address || null,
    createdAt,
  });

/**
 * Seal a secret payload into a v1 vault envelope.
 * @param {{type: 'mnemonic'|'privateKey', secret: string}} payload - the secret to protect
 * @param {string} password - the witness password (strength is enforced by the caller, not here)
 * @param {{params?: object, salt?: Buffer, iv?: Buffer, address?: string, now?: string}} [opts]
 * @returns {object} a frozen, JSON-serializable v1 envelope (no key material)
 */
// impure — generates random salt/iv and a default creation timestamp
const createVault = (payload, password, opts = {}) => {
  validatePayload(payload);
  if (typeof password !== 'string' || password.length === 0) throw new Error('vault: password required');
  const params = { ...SCRYPT_DEFAULTS, ...(opts.params || {}) };
  const salt = opts.salt ? Buffer.from(opts.salt) : crypto.randomBytes(KDF_SALT_BYTES);
  const iv = opts.iv ? Buffer.from(opts.iv) : crypto.randomBytes(GCM_IV_BYTES);
  const key = deriveKey(password, salt, params);
  try {
    return buildEnvelope({
      payload, key, salt, iv, params,
      address: opts.address,
      createdAt: opts.now || new Date().toISOString(),
    });
  } finally {
    key.fill(0); // zeroize the derived key buffer once sealing is done
  }
};

const MAX_SCRYPT_N = 1 << 20; // 2^20 — upper bound on unlock cost

// pure — true iff n is a power of two ≥ 2
const isPow2 = (n) => Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;

// pure — reject KDF params outside sane bounds. kdfParams live OUTSIDE the GCM
// envelope, so a vault-file writer could otherwise set absurd costs (r/p) to
// exhaust memory/CPU on unlock. Confidentiality is unaffected (the AEAD binds
// the ciphertext to the original params) — this is DoS hardening.
const validateKdfParams = (kdf, p) => {
  if (kdf !== 'scrypt') throw new Error('vault: unsupported KDF');
  if (!p || typeof p !== 'object') throw new Error('vault: missing KDF params');
  if (p.dkLen !== 32) throw new Error('vault: invalid dkLen');
  if (!isPow2(p.N) || p.N > MAX_SCRYPT_N) throw new Error('vault: invalid scrypt N');
  if (!Number.isInteger(p.r) || p.r < 1 || p.r > 16) throw new Error('vault: invalid scrypt r');
  if (!Number.isInteger(p.p) || p.p < 1 || p.p > 4) throw new Error('vault: invalid scrypt p');
  if (typeof p.salt !== 'string' || unb64(p.salt).length !== KDF_SALT_BYTES) throw new Error('vault: invalid KDF salt');
};

// pure — open a v1 envelope, returning the decrypted payload object
const openV1 = (envelope, password) => {
  const { kdfParams } = envelope;
  validateKdfParams(envelope.kdf, kdfParams);
  const salt = unb64(kdfParams.salt);
  const params = { N: kdfParams.N, r: kdfParams.r, p: kdfParams.p, dkLen: kdfParams.dkLen };
  const key = deriveKey(password, salt, params);
  try {
    return JSON.parse(open(unb64(envelope.ct), key, unb64(envelope.iv)));
  } finally {
    key.fill(0);
  }
};

/**
 * Open a vault envelope and return its decrypted payload.
 * Throws on a wrong password or any tampering (GCM authentication failure).
 * @param {object} envelope - a v1 envelope produced by createVault
 * @param {string} password - the witness password
 * @returns {{type: 'mnemonic'|'privateKey', secret: string}} the decrypted payload
 */
const openVault = (envelope, password) => {
  if (!envelope || typeof envelope !== 'object') throw new Error('vault: envelope required');
  if (envelope.v === CURRENT_VERSION) return openV1(envelope, password);
  throw new Error(`vault: unsupported envelope version ${envelope.v}`);
};

/**
 * Detect the legacy v0 format written by the pre-versioning renderer:
 * `{ address, encryptedKey, salt, iv }` (PBKDF2-100k, private-key payload).
 * @param {object} stored - a candidate stored object
 * @returns {boolean} true if it is a legacy v0 vault
 */
const isLegacyVault = (stored) =>
  !!stored &&
  typeof stored === 'object' &&
  stored.v === undefined &&
  typeof stored.encryptedKey === 'string' &&
  stored.kdf === undefined &&
  stored.ct === undefined &&
  stored.cipher === undefined;

/**
 * Open a legacy v0 vault (PBKDF2-SHA256-100k + AES-256-GCM, private-key payload)
 * so it can be re-sealed to the current version.
 * @param {{encryptedKey: string, salt: string, iv: string}} stored - the v0 blob
 * @param {string} password - the password used when the v0 vault was created
 * @returns {{type: 'privateKey', secret: string}} the recovered private key
 */
const openLegacyVault = (stored, password) => {
  if (!isLegacyVault(stored)) throw new Error('vault: not a legacy v0 vault');
  const salt = unb64(stored.salt);
  const iv = unb64(stored.iv);
  const key = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, PBKDF2_LEGACY_ITERS, 32, 'sha256');
  try {
    return { type: 'privateKey', secret: open(unb64(stored.encryptedKey), key, iv) };
  } finally {
    key.fill(0);
  }
};

/**
 * Whether a stored vault should be re-sealed to the current version.
 * @param {object} stored - a legacy v0 blob or a versioned envelope
 * @returns {boolean} true if it is legacy or below the current version
 */
const needsUpgrade = (stored) =>
  isLegacyVault(stored) || (!!stored && typeof stored.v === 'number' && stored.v < CURRENT_VERSION);

module.exports = {
  CURRENT_VERSION,
  SCRYPT_DEFAULTS,
  deriveKey,
  createVault,
  openVault,
  isLegacyVault,
  openLegacyVault,
  needsUpgrade,
};
