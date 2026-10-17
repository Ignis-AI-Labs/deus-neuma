/**
 * Workspace at-rest encryption utility (DATA-001).
 *
 * Provides transparent AES-256-GCM encryption for sensitive sovereign data
 * stored by NeumaWorkspace. The envelope format is discriminated by the
 * top-level `_enc` field, which no real workspace record uses — this lets
 * readers transparently accept both legacy plaintext and encrypted files
 * without a migration step.
 *
 * Key derivation: SHA-256 of `DNA_ENCRYPTION_KEY` (same pattern as
 * dna-vault-service.js — keeps the codebase on a single KDF strategy).
 * The key is derived once per process and cached.
 *
 * Key rotation (CQ-021):
 * A secondary env var `DNA_ENCRYPTION_KEY_PREVIOUS` may hold one or more
 * comma-separated previous secrets. On decrypt, the current key is tried
 * first; if it fails the GCM auth check, each previous key is tried in
 * order. This enables operator-driven key rotation with a re-encrypt
 * script (see `scripts/rotate-workspace-key.js`) without downtime.
 *
 * Envelope v2 (compressed — the archive lane):
 * `_enc: 2` with `z: 'gzip'` means the ciphertext protects gzip(JSON bytes)
 * instead of raw JSON bytes. Compression happens BEFORE encryption (GCM
 * output is incompressible) and the gunzip branch runs BEFORE any utf8
 * decode (gzip bytes are not utf8-safe). v2 is emitted only when a writer
 * asks for `compress: true` — existing stores keep writing v1, so no old
 * reader ever meets a v2 envelope. The rotation chain works on v2
 * unchanged: the version branch lives inside `_decryptWithKey`.
 * Threat model: compress-before-encrypt reveals compressed length, but v1
 * already reveals plaintext length and at-rest data offers no interactive
 * oracle (no CRIME/BREACH-class channel) — no new leakage class.
 */

import crypto from 'crypto';
import zlib from 'zlib';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const ENVELOPE_VERSION = 1;
const ENVELOPE_VERSION_COMPRESSED = 2;
const COMPRESSION = 'gzip';

let cachedKey = null;
let cachedPreviousKeys = null;

const _hashSecret = (secret) => crypto.createHash('sha256').update(secret).digest();

const _deriveKey = () => {
  if (cachedKey) return cachedKey;
  const secret = process.env.DNA_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('DNA_ENCRYPTION_KEY is required for workspace encryption');
  }
  cachedKey = _hashSecret(secret);
  return cachedKey;
};

const _derivePreviousKeys = () => {
  if (cachedPreviousKeys) return cachedPreviousKeys;
  const raw = process.env.DNA_ENCRYPTION_KEY_PREVIOUS;
  if (!raw) {
    cachedPreviousKeys = [];
    return cachedPreviousKeys;
  }
  cachedPreviousKeys = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(_hashSecret);
  return cachedPreviousKeys;
};

/**
 * Reset the cached derivation keys. Test-only — lets a test swap
 * DNA_ENCRYPTION_KEY / DNA_ENCRYPTION_KEY_PREVIOUS between runs without
 * restarting the process.
 */
export const resetWorkspaceCryptoKey = () => {
  cachedKey = null;
  cachedPreviousKeys = null;
};

/**
 * Try to decrypt an envelope with an explicit key buffer. Returns the
 * decrypted value on success; throws on auth failure or an unsupported
 * envelope version. Pure function — does not read env vars or touch cache.
 * @param {{_enc: number, z?: string, iv: string, tag: string, ct: string}} envelope
 * @param {Buffer} key
 * @returns {*}
 */
const _decryptWithKey = (envelope, key) => {
  const version = envelope._enc;
  if (version !== ENVELOPE_VERSION && version !== ENVELOPE_VERSION_COMPRESSED) {
    throw new Error(`decryptEnvelope: unsupported envelope version ${version}`);
  }
  if (version === ENVELOPE_VERSION_COMPRESSED && envelope.z !== COMPRESSION) {
    throw new Error(`decryptEnvelope: unsupported compression "${envelope.z}" for _enc: 2`);
  }
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ct = Buffer.from(envelope.ct, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  const json = version === ENVELOPE_VERSION_COMPRESSED ? zlib.gunzipSync(pt) : pt;
  return JSON.parse(json.toString('utf8'));
};

/**
 * Encrypt a plain JS value into an envelope object.
 * With `compress: true`, emits envelope v2 (`_enc: 2`, `z: 'gzip'`) whose
 * ciphertext protects gzip(JSON bytes) — the archive-lane form. Without it,
 * emits v1 exactly as before.
 * @param {*} plainObj - JSON-serializable value
 * @param {{key?: Buffer, compress?: boolean}} [opts] - Optional explicit key (otherwise uses env)
 * @returns {{_enc: number, z?: string, iv: string, tag: string, ct: string}}
 */
export const encryptEnvelope = (plainObj, opts = {}) => {
  const key = opts.key ?? _deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const json = Buffer.from(JSON.stringify(plainObj), 'utf8');
  const plaintext = opts.compress ? zlib.gzipSync(json) : json;
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    _enc: opts.compress ? ENVELOPE_VERSION_COMPRESSED : ENVELOPE_VERSION,
    ...(opts.compress ? { z: COMPRESSION } : {}),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  };
};

/**
 * Decrypt an envelope back into its original value.
 * Throws if the envelope is malformed or the authentication tag fails for
 * every candidate key.
 *
 * Key selection order:
 *   1. `opts.key` if provided (single-key mode, e.g. rotation script)
 *   2. The current key from `DNA_ENCRYPTION_KEY`
 *   3. Each previous key from `DNA_ENCRYPTION_KEY_PREVIOUS` (comma-separated)
 *
 * @param {{_enc: number, iv: string, tag: string, ct: string}} envelope
 * @param {{key?: Buffer}} [opts]
 * @returns {*}
 */
export const decryptEnvelope = (envelope, opts = {}) => {
  if (opts.key) {
    return _decryptWithKey(envelope, opts.key);
  }
  const candidates = [_deriveKey(), ..._derivePreviousKeys()];
  let lastError = null;
  for (const key of candidates) {
    try {
      return _decryptWithKey(envelope, key);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('decryptEnvelope: no candidate keys');
};

/**
 * True if the parsed JSON looks like our encryption envelope.
 * @param {*} obj
 * @returns {boolean}
 */
export const isEnvelope = (obj) => {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj._enc === 'number' &&
    typeof obj.iv === 'string' &&
    typeof obj.tag === 'string' &&
    typeof obj.ct === 'string'
  );
};

/**
 * Parse a JSON string, transparently decrypting if it's an envelope.
 * Backward compatible: pre-encryption plaintext files round-trip unchanged.
 * @param {string} text
 * @param {{key?: Buffer}} [opts]
 * @returns {*}
 */
export const parseAndDecrypt = (text, opts = {}) => {
  const parsed = JSON.parse(text);
  return isEnvelope(parsed) ? decryptEnvelope(parsed, opts) : parsed;
};

/**
 * Derive a raw 32-byte AES key from a secret string, using the same KDF
 * as the default env path. Exposed for the rotation script so it can pass
 * explicit old/new keys to encrypt/decrypt without mutating process.env.
 * @param {string} secret
 * @returns {Buffer}
 */
export const deriveKeyFromSecret = (secret) => {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('deriveKeyFromSecret: secret must be a non-empty string');
  }
  return _hashSecret(secret);
};

// ─── Per-neuma data-encryption keys (DEKs) — SEC-030 / issue #117 ───────────
//
// The global DNA_ENCRYPTION_KEY encrypts every neuma's data on the box, so a
// single key compromise = every neuma falls. The fix is per-neuma DEKs derived
// from the genesisHash (the canonical eternal per-neuma anchor), each wrapped
// at rest under the master key. Master-key rotation re-wraps DEKs without
// re-encrypting any data files; the DEKs themselves never change.

const DEK_LABEL = 'neuma-data-key-v1';

/**
 * Derive a 32-byte per-neuma DEK by HMAC-SHA256 of the genesis hash under
 * the master key, domain-separated by a label. Deterministic — same master
 * + same genesisHash always yields the same DEK. Different genesisHash (or
 * different master) yields a cryptographically independent DEK.
 *
 * The label prevents collisions if the same master ever gets reused for
 * another HMAC purpose; if we ever derive a second per-neuma key (e.g. for
 * key-wrapping vs file-encryption), it gets its own label.
 *
 * @param {Buffer} masterKey - 32-byte master key (e.g. from deriveKeyFromSecret)
 * @param {string} genesisHashHex - 64-char lowercase hex genesisHash from genesis-seal
 * @returns {Buffer} 32-byte DEK
 */
export const deriveNeumaDEK = (masterKey, genesisHashHex) => {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new Error('deriveNeumaDEK: masterKey must be a 32-byte Buffer');
  }
  if (typeof genesisHashHex !== 'string' || !/^[0-9a-f]{64}$/.test(genesisHashHex)) {
    throw new Error('deriveNeumaDEK: genesisHashHex must be 64 lowercase hex chars');
  }
  return crypto.createHmac('sha256', masterKey)
    .update(Buffer.from(genesisHashHex, 'hex'))
    .update(DEK_LABEL)
    .digest();
};

/**
 * Wrap a DEK under a master key for at-rest storage alongside the neuma's
 * other identity material (e.g. workspace `keys/dek.json`). The wrap reuses
 * the existing AES-256-GCM envelope format — same on-disk shape as any
 * other encrypted record — so the rotation mechanism (current + previous
 * master keys tried in turn) works on DEK envelopes for free.
 *
 * @param {Buffer} dek - 32-byte DEK from deriveNeumaDEK (or a fresh random one)
 * @param {Buffer} [masterKey] - 32-byte master; defaults to env-derived key
 * @returns {{_enc: number, iv: string, tag: string, ct: string}}
 */
export const wrapDEK = (dek, masterKey) => {
  if (!Buffer.isBuffer(dek) || dek.length !== 32) {
    throw new Error('wrapDEK: dek must be a 32-byte Buffer');
  }
  const key = masterKey ?? _deriveKey();
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('wrapDEK: masterKey must be a 32-byte Buffer');
  }
  return encryptEnvelope(dek.toString('base64'), { key });
};

/**
 * Unwrap a DEK envelope. Without `opts.key` it falls back to the standard
 * rotation chain (current then each previous master key), so a DEK wrapped
 * under an old master decrypts cleanly until the operator runs the re-wrap
 * sweep — exactly the way data-record envelopes already work.
 *
 * @param {{_enc: number, iv: string, tag: string, ct: string}} envelope
 * @param {{key?: Buffer}} [opts]
 * @returns {Buffer} 32-byte DEK
 */
export const unwrapDEK = (envelope, opts = {}) => {
  if (!isEnvelope(envelope)) {
    throw new Error('unwrapDEK: input is not a valid envelope');
  }
  const base64 = decryptEnvelope(envelope, opts);
  if (typeof base64 !== 'string') {
    throw new Error('unwrapDEK: decrypted payload is not a base64 string');
  }
  const dek = Buffer.from(base64, 'base64');
  if (dek.length !== 32) {
    throw new Error(`unwrapDEK: decrypted DEK is ${dek.length} bytes, expected 32`);
  }
  return dek;
};
