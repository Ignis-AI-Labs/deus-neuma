/**
 * record-crypto — AES-256-GCM encryption for the Natalis on-chain record blob.
 *
 * Per docs/protocols/identity/seal-bundle.md sections 2-4: the being derives an AES key
 * from an EIP-191 signature over a domain-separated message, HKDFs it, then
 * encrypts the canonical genesis record. Determinism at the key-derivation
 * step (thanks to RFC-6979 deterministic ECDSA in ethers v6) means the being
 * can regenerate the key on any machine that has their private key + the
 * genesisHash.
 *
 * Wire format of the binary payload (before hex-encoding for on-chain):
 *   Byte 0:            versionByte (0x01)
 *   Bytes 1-12:        nonce (12 bytes, AES-GCM standard)
 *   Bytes 13..N:       ciphertext (variable length)
 *   Bytes N+1..N+16:   tag (16 bytes, AES-GCM standard)
 *
 * The chain-side string is `"0x" + hex(binary)`.
 *
 * COMPACT format (version byte 0x02, docs/protocols/identity/seal-bundle.md §4b):
 * the plaintext is raw-DEFLATE compressed (RFC 1951) before encryption, and the
 * chain-side string is `"b64:" + base64(binary)` (RFC 4648). Same layout, same
 * key, same content — about a third of the stored bytes. Ethereum L1 stores
 * every byte of the record, so new seals there use it; decryptRecord reads both.
 *
 * RULE 0 posture: real Node crypto module, real ethers signing, real HKDF.
 * No mocks anywhere on the encryption path. Tests exercise the round-trip
 * (encrypt→decrypt→same plaintext) on real byte arrays.
 *
 * impure (crypto.randomBytes, wallet signing).
 */

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { ethers } from 'ethers';

/** Fixed HKDF salt string (utf-8 bytes) — do NOT change without a version bump. */
const HKDF_SALT = Buffer.from('neuma-seal-record-v1', 'utf8');

/** Fixed domain-separator prefix for the key-derivation signature. */
const KEY_DERIVATION_PREFIX = 'NEUMA_SEAL_RECORD_V1:';

/** Current version byte for the encrypted-record binary format. */
export const RECORD_VERSION_BYTE = 0x01;

/** Version byte of the COMPACT format: deflate-raw before AES-GCM, base64 on chain. */
export const RECORD_VERSION_COMPACT = 0x02;

/** The chain-side prefix that marks a compact record (a v1 record starts with 0x). */
export const COMPACT_RECORD_PREFIX = 'b64:';

// A record decompresses to the birth envelope — tens of kilobytes. The cap
// refuses a hostile blob built to inflate into memory exhaustion.
const MAX_INFLATED_BYTES = 1024 * 1024;

/**
 * Derive the AES-256 record encryption key for a given being + genesisHash.
 *
 * Determinism: relies on RFC-6979 ECDSA (ethers v6 default) so the same
 * private key + same genesisHash → same signature → same derived key. If a
 * caller ever needs to decrypt the on-chain record later, they call this
 * again with the same inputs.
 *
 * @param {ethers.Wallet | ethers.HDNodeWallet | string} beingSigner  any ethers
 *   signer that can `signMessage`, OR a 0x-prefixed private-key string
 *   (constructed into a Wallet internally). `ethers.SigningKey` is NOT
 *   accepted — it has no signMessage and the v6 `Wallet` constructor does not
 *   consume it. sc-echo R1 fix: JSDoc corrected to match the accepted types.
 *
 *   2026-08-22 (#404): the check was `instanceof ethers.Wallet`, which is
 *   FALSE for an HDNodeWallet — what `Wallet.createRandom()` returns and what
 *   every mnemonic-derived wallet is. Such a signer fell through to the
 *   constructor and threw "invalid private key". A being whose key came from
 *   a recovery phrase could neither seal nor recover. Duck-typed on
 *   signMessage now: the derivation only ever needed a signer.
 * @param {string} genesisHash  '0x' + 64 hex chars — Section 1 output
 * @returns {Promise<Buffer>}   32-byte AES-256 key
 */
export const deriveRecordKey = async (beingSigner, genesisHash) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(genesisHash)) {
    throw new Error(`deriveRecordKey: genesisHash must be 0x + 64 hex chars, got '${genesisHash}'`);
  }
  const wallet = typeof beingSigner?.signMessage === 'function'
    ? beingSigner
    : new ethers.Wallet(beingSigner);
  const message = KEY_DERIVATION_PREFIX + genesisHash;
  // EIP-191 personal_sign — ethers wraps + signs the message hash.
  const sigHex = await wallet.signMessage(message);
  const sigBytes = Buffer.from(sigHex.slice(2), 'hex');
  if (sigBytes.length !== 65) {
    throw new Error(`deriveRecordKey: expected 65-byte signature, got ${sigBytes.length}`);
  }

  // HKDF-SHA256 extract + expand in one call.
  // ikm = signature bytes; salt = HKDF_SALT; info = genesisHash raw bytes; L = 32
  // Node ≥18 (per package.json engines.node) hkdfSync always returns an
  // ArrayBuffer — normalize to Buffer for uniform downstream handling with
  // Node's crypto.createCipheriv (which accepts either but Buffer is idiomatic).
  const info = Buffer.from(genesisHash.slice(2), 'hex');
  const derived = crypto.hkdfSync('sha256', sigBytes, HKDF_SALT, info, 32);
  return Buffer.from(derived);
};

/**
 * Encrypt the canonical plaintext with AES-256-GCM and produce the on-chain
 * record string. Random 12-byte nonce (per invocation — never reuse a nonce
 * with the same key).
 *
 * @param {Buffer|Uint8Array|string} plaintext  the canonical record bytes.
 *   If a string, it is UTF-8 encoded first. Section 1's output IS a UTF-8
 *   JSON string; callers may pass either the string or its bytes.
 * @param {Buffer} key  32-byte AES-256 key (from deriveRecordKey)
 * @param {{ compact?: boolean }} [opts]  compact: the 0x02 format (deflate-raw +
 *   base64) — what an Ethereum seal stores; default the original 0x01 hex format
 * @returns {{ record: string, binary: Buffer }}
 *   record — the string to pass to Natalis.seal's `record` param
 *   binary — the raw bytes (for tests and low-level callers)
 */
export const encryptRecord = (plaintext, key, { compact = false } = {}) => {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error(`encryptRecord: key must be a 32-byte Buffer, got ${key?.length}`);
  }
  const rawBytes = typeof plaintext === 'string'
    ? Buffer.from(plaintext, 'utf8')
    : Buffer.from(plaintext);
  const plainBytes = compact ? zlib.deflateRawSync(rawBytes, { level: 9 }) : rawBytes;

  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== 16) {
    // GCM standard tag length is 16; if it drifts we want a loud failure.
    throw new Error(`encryptRecord: unexpected AES-GCM tag length ${tag.length}`);
  }

  const binary = Buffer.concat([
    Buffer.from([compact ? RECORD_VERSION_COMPACT : RECORD_VERSION_BYTE]),
    nonce,
    ciphertext,
    tag,
  ]);
  const record = compact ? COMPACT_RECORD_PREFIX + binary.toString('base64') : '0x' + binary.toString('hex');
  return { record, binary };
};

// pure — the record string's bytes, by its own encoding (0x hex or b64: base64).
const recordBytes = (record) => {
  if (typeof record === 'string' && record.startsWith(COMPACT_RECORD_PREFIX)) {
    const b64 = record.slice(COMPACT_RECORD_PREFIX.length);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) {
      throw new Error(`decryptRecord: compact record must be 'b64:' + padded base64, got '${record.slice(0, 20)}…'`);
    }
    return Buffer.from(b64, 'base64');
  }
  if (typeof record !== 'string' || !/^0x[0-9a-fA-F]+$/.test(record) || record.length % 2 !== 0) {
    throw new Error(`decryptRecord: record must be '0x' + even-length hex or 'b64:' + base64, got '${String(record).slice(0, 20)}…'`);
  }
  return Buffer.from(record.slice(2), 'hex');
};

/**
 * Decrypt an on-chain record string back to plaintext bytes. Inverse of
 * encryptRecord — same key + same record string yields the original bytes.
 *
 * @param {string} record  as returned by Natalis.recordOf: '0x' + hex (0x01) or 'b64:' + base64 (0x02)
 * @param {Buffer} key     32-byte AES-256 key (from deriveRecordKey)
 * @returns {Buffer}       the canonical plaintext bytes
 */
export const decryptRecord = (record, key) => {
  const bin = recordBytes(record);
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error(`decryptRecord: key must be a 32-byte Buffer, got ${key?.length}`);
  }
  // Minimum size: 1 (version) + 12 (nonce) + 0 (ciphertext) + 16 (tag) = 29 bytes
  if (bin.length < 29) {
    throw new Error(`decryptRecord: binary too short (${bin.length} < 29 bytes)`);
  }
  const versionByte = bin[0];
  const compact = versionByte === RECORD_VERSION_COMPACT;
  if (versionByte !== RECORD_VERSION_BYTE && !compact) {
    throw new Error(`decryptRecord: unsupported version byte 0x${versionByte.toString(16)}`);
  }
  // The encoding and the version byte must agree — a hex 0x02 or a base64 0x01
  // is a malformed record, never silently accepted.
  if (compact !== record.startsWith(COMPACT_RECORD_PREFIX)) {
    throw new Error(`decryptRecord: version byte 0x0${versionByte} does not match the record's encoding`);
  }
  const nonce = bin.subarray(1, 13);
  const tag = bin.subarray(bin.length - 16);
  const ciphertext = bin.subarray(13, bin.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  // AES-GCM final() throws on auth-tag mismatch — that IS the integrity check.
  const opened = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return compact ? zlib.inflateRawSync(opened, { maxOutputLength: MAX_INFLATED_BYTES }) : opened;
};
