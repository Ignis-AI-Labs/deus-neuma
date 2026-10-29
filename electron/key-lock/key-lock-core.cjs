// The at-rest key lock — the record shape and the Recovery Kit seal.
//
// Neuma's master key (DNA_ENCRYPTION_KEY) and session secret (AUTH_SECRET) used
// to sit in ~/.neuma/secrets.json in plain text, beside the data they open. A
// locked record (v2) holds them only as independent wraps of the same keys:
//   device    — sealed by the OS keychain (Electron safeStorage), so the file
//               alone opens nothing off this login;
//   recovery  — sealed under the Recovery Kit code (scrypt + AES-256-GCM), the
//               way back when the keychain is reset, changed or on a new computer.
// Adding or removing a way in rewraps the keys; no data file is touched.
//
// Pure apart from randomness and the CPU-heavy KDF; Electron-free so it can be
// proven under plain Node.

const crypto = require('node:crypto');
const { SCRYPT_DEFAULTS, deriveKey } = require('../wallet/vault-crypto.cjs');

const RECORD_VERSION = 2;
const KEY_FIELDS = Object.freeze(['dnaEncryptionKey', 'authSecret']);
const HEX64 = /^[0-9a-f]{64}$/;
// RFC 4648 base32: no 0/1/8/9, so a printed code reads back without O/0, I/1, B/8 doubt.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MISREAD = Object.freeze({ 0: 'O', 1: 'I', 8: 'B' });
const CODE_BYTES = 20; // 160 bits → 32 characters

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => Buffer.from(String(s), 'base64');

// pure — the two keys a record carries, refused unless both are 64 hex chars
const validKeys = (keys) => {
  if (!keys || !KEY_FIELDS.every((f) => typeof keys[f] === 'string' && HEX64.test(keys[f]))) {
    throw new Error('key-lock: the record does not hold two 256-bit keys');
  }
  return Object.freeze({ dnaEncryptionKey: keys.dnaEncryptionKey, authSecret: keys.authSecret });
};

/** impure (randomness) — two fresh 256-bit keys, the shape ensureSecrets always wrote. */
const freshKeys = () => validKeys({
  dnaEncryptionKey: crypto.randomBytes(32).toString('hex'),
  authSecret: crypto.randomBytes(32).toString('hex'),
});

/** impure (randomness) — a Recovery Kit code: 160 bits, base32, groups of four. */
const newRecoveryCode = () => {
  const bytes = crypto.randomBytes(CODE_BYTES);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  const chars = bits.match(/.{5}/g).map((five) => ALPHABET[parseInt(five, 2)]).join('');
  return chars.match(/.{4}/g).join('-');
};

/** Pure — a typed code back to its canonical form: case, spaces, dashes and the misreadable digits forgiven. */
const normalizeCode = (typed) => String(typed || '').toUpperCase()
  .replace(/[018]/g, (d) => MISREAD[d]).replace(/[^A-Z2-7]/g, '')
  .replace(/(.{4})(?=.)/g, '$1-');

// pure — GCM seal / open of a UTF-8 string under a 32-byte key
const gcmSeal = (plain, key) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv: b64(iv), tag: b64(cipher.getAuthTag()), ct: b64(ct) };
};
const gcmOpen = (box, key) => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, unb64(box.iv));
  decipher.setAuthTag(unb64(box.tag));
  return Buffer.concat([decipher.update(unb64(box.ct)), decipher.final()]).toString('utf8');
};

/** impure (randomness, scrypt) — the keys sealed under a Recovery Kit code. */
const sealWithCode = (keys, code) => {
  const salt = crypto.randomBytes(16);
  const params = { ...SCRYPT_DEFAULTS };
  const key = deriveKey(normalizeCode(code), salt, params);
  try {
    return { kdf: 'scrypt', N: params.N, r: params.r, p: params.p, salt: b64(salt), ...gcmSeal(JSON.stringify(validKeys(keys)), key) };
  } finally {
    key.fill(0);
  }
};

/** Pure (scrypt) — the keys back from a recovery wrap; throws on a wrong code or a tampered wrap. */
const openWithCode = (wrap, code) => {
  if (!wrap || wrap.kdf !== 'scrypt' || wrap.N !== SCRYPT_DEFAULTS.N || wrap.r !== SCRYPT_DEFAULTS.r || wrap.p !== SCRYPT_DEFAULTS.p) {
    throw new Error('key-lock: unrecognised recovery wrap');
  }
  const key = deriveKey(normalizeCode(code), unb64(wrap.salt), { ...SCRYPT_DEFAULTS });
  try {
    return validKeys(JSON.parse(gcmOpen(wrap, key)));
  } catch {
    throw new Error('key-lock: that Recovery Kit code does not open this key');
  } finally {
    key.fill(0);
  }
};

/**
 * Pure — what a secrets file holds.
 * @param {?object} stored - parsed JSON, or null when there is no file
 * @returns {'missing'|'plain'|'locked'|'unknown'}
 */
const classify = (stored) => {
  if (stored == null) return 'missing';
  if (stored.v === RECORD_VERSION && stored.device && stored.recovery) return 'locked';
  if (KEY_FIELDS.some((f) => typeof stored[f] === 'string')) return 'plain';
  return 'unknown';
};

/**
 * Pure — a locked record. `kit` is the code itself sealed by the device until
 * the person says it is saved (shown again on request, never in the clear).
 * @param {{device: {backend: string, blob: string}, recovery: object, kit: ?string, createdAt: string}} parts
 */
const lockedRecord = ({ device, recovery, kit, createdAt }) => Object.freeze({
  v: RECORD_VERSION, device, recovery, kit: kit || null, createdAt,
});

module.exports = {
  RECORD_VERSION, classify, freshKeys, lockedRecord, newRecoveryCode, normalizeCode,
  openWithCode, sealWithCode, validKeys,
};
