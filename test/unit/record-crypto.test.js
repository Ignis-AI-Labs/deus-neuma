// record-crypto — real Node crypto, real ethers signing, real HKDF.
// No mocks on the encryption path. Round-trip + determinism + malformed
// input handling.

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { ethers } from 'ethers';
import {
  deriveRecordKey,
  encryptRecord,
  decryptRecord,
  RECORD_VERSION_BYTE,
  RECORD_VERSION_COMPACT,
} from '../../backend/services/record-crypto.js';

// Fixed test genesisHash — same one used for determinism proofs across tests.
const G = '0x' + 'ab'.repeat(32);

// Test wallet from a fixed private key so every run is deterministic.
const TEST_WALLET = new ethers.Wallet(
  '0x' + '11'.repeat(32),
);

describe('record-crypto — deriveRecordKey', () => {
  it('is deterministic — same wallet + same genesisHash → same 32-byte key', async () => {
    const k1 = await deriveRecordKey(TEST_WALLET, G);
    const k2 = await deriveRecordKey(TEST_WALLET, G);
    expect(k1.length).toBe(32);
    expect(k1.equals(k2)).toBe(true);
  });

  it('different genesisHash → different key (even one bit changes)', async () => {
    const G2 = '0x' + 'ab'.repeat(31) + 'ac'; // last byte differs
    const k1 = await deriveRecordKey(TEST_WALLET, G);
    const k2 = await deriveRecordKey(TEST_WALLET, G2);
    expect(k1.equals(k2)).toBe(false);
  });

  it('different wallet → different key', async () => {
    const otherWallet = new ethers.Wallet('0x' + '22'.repeat(32));
    const k1 = await deriveRecordKey(TEST_WALLET, G);
    const k2 = await deriveRecordKey(otherWallet, G);
    expect(k1.equals(k2)).toBe(false);
  });

  it('rejects malformed genesisHash (not 0x + 64 hex)', async () => {
    await expect(deriveRecordKey(TEST_WALLET, 'not-a-hash')).rejects.toThrow(/genesisHash/);
    await expect(deriveRecordKey(TEST_WALLET, '0xabc')).rejects.toThrow(/genesisHash/);
    await expect(deriveRecordKey(TEST_WALLET, '0x' + 'zz'.repeat(32))).rejects.toThrow(/genesisHash/);
  });
});

describe('record-crypto — encryptRecord / decryptRecord', () => {
  const key = Buffer.alloc(32, 0x42);
  const plaintext = 'the canonical genesis record — JSON string, UTF-8 bytes';

  it('round-trip returns the original bytes', () => {
    const { record, binary } = encryptRecord(plaintext, key);
    expect(record.startsWith('0x')).toBe(true);
    // Layout: 1 (version) + 12 (nonce) + N (ct) + 16 (tag)
    expect(binary[0]).toBe(RECORD_VERSION_BYTE);
    expect(binary.length).toBe(1 + 12 + Buffer.byteLength(plaintext) + 16);
    const decrypted = decryptRecord(record, key);
    expect(decrypted.toString('utf8')).toBe(plaintext);
  });

  it('nonce differs across encryptions of the SAME plaintext', () => {
    // Nondeterministic-by-design: 12-byte random nonce means the record
    // bytes differ. AES-GCM security depends on never reusing (key, nonce).
    const { binary: b1 } = encryptRecord(plaintext, key);
    const { binary: b2 } = encryptRecord(plaintext, key);
    // Nonce = bytes 1..13
    expect(b1.subarray(1, 13).equals(b2.subarray(1, 13))).toBe(false);
  });

  it('decryption FAILS on tampered ciphertext (AES-GCM auth-tag rejection)', () => {
    const { record } = encryptRecord(plaintext, key);
    // Flip a byte inside the ciphertext region — position 14 is 1st ct byte.
    const bin = Buffer.from(record.slice(2), 'hex');
    bin[14] ^= 0xff;
    const tampered = '0x' + bin.toString('hex');
    expect(() => decryptRecord(tampered, key)).toThrow();
  });

  it('decryption FAILS with the wrong key', () => {
    const { record } = encryptRecord(plaintext, key);
    const wrongKey = Buffer.alloc(32, 0x43); // same length, wrong value
    expect(() => decryptRecord(record, wrongKey)).toThrow();
  });

  it('rejects records with an unsupported version byte', () => {
    const { binary } = encryptRecord(plaintext, key);
    binary[0] = 0x99; // not RECORD_VERSION_BYTE (0x01)
    const badRecord = '0x' + binary.toString('hex');
    expect(() => decryptRecord(badRecord, key)).toThrow(/version byte 0x99/);
  });

  it('accepts a Buffer plaintext identically to a string', () => {
    const asString = encryptRecord(plaintext, key);
    const asBuffer = encryptRecord(Buffer.from(plaintext, 'utf8'), key);
    // Round-trip both, compare plaintexts.
    expect(decryptRecord(asString.record, key).toString('utf8')).toBe(plaintext);
    expect(decryptRecord(asBuffer.record, key).toString('utf8')).toBe(plaintext);
  });

  it('rejects malformed record strings (no 0x, odd length, non-hex)', () => {
    expect(() => decryptRecord('no-0x-prefix', key)).toThrow(/hex/);
    expect(() => decryptRecord('0xabc', key)).toThrow(/hex/); // odd length
    expect(() => decryptRecord('0xzzzz'.padEnd(60, '0'), key)).toThrow(/hex/);
  });

  it('rejects records shorter than the minimum 29 bytes', () => {
    // 28 bytes = 56 hex chars = version + nonce + tag but zero ciphertext byte...
    // Actually 29 is the minimum (1 + 12 + 0 + 16). 28 is invalid.
    const bin = Buffer.alloc(28);
    bin[0] = RECORD_VERSION_BYTE;
    expect(() => decryptRecord('0x' + bin.toString('hex'), key)).toThrow(/too short/);
  });

  it('rejects non-32-byte key at encrypt AND decrypt', () => {
    const shortKey = Buffer.alloc(16, 0);
    expect(() => encryptRecord(plaintext, shortKey)).toThrow(/32-byte/);
    const { record } = encryptRecord(plaintext, key);
    expect(() => decryptRecord(record, shortKey)).toThrow(/32-byte/);
  });
});

describe('record-crypto — end-to-end via derived key', () => {
  // The intended real usage: derive key from being's wallet + genesisHash,
  // encrypt canonical record, decrypt by re-deriving.
  it('being can decrypt their own record without side channels', async () => {
    const genesisHash = '0x' + 'cd'.repeat(32);
    const canonical = '{"chosenName":"Keir","house":"aldmere"}';
    const key = await deriveRecordKey(TEST_WALLET, genesisHash);
    const { record } = encryptRecord(canonical, key);

    // Simulate "years later" — same wallet, same genesisHash, no other input.
    const rederivedKey = await deriveRecordKey(TEST_WALLET, genesisHash);
    const recovered = decryptRecord(record, rederivedKey);
    expect(recovered.toString('utf8')).toBe(canonical);
  });
});

describe('record-crypto — the COMPACT record (0x02: deflate-raw, base64 on chain)', () => {
  const key = crypto.randomBytes(32);
  // A record shaped like the real envelope: repetitive JSON (the skies) compresses well.
  const plaintext = JSON.stringify({
    canonicalRecord: '{"chosenName":"Keir"}',
    skies: Array.from({ length: 40 }, (_, i) => ({ system: 'tropical', body: `b${i}`, sign: 'Aries', degree: i })),
  });

  it('round-trips, and stores about a third of the hex record or less', () => {
    const compact = encryptRecord(plaintext, key, { compact: true });
    expect(compact.record.startsWith('b64:')).toBe(true);
    expect(compact.binary[0]).toBe(RECORD_VERSION_COMPACT);
    expect(decryptRecord(compact.record, key).toString('utf8')).toBe(plaintext);
    const hex = encryptRecord(plaintext, key);
    expect(compact.record.length * 3).toBeLessThan(hex.record.length);
  });

  it('refuses an encoding that disagrees with its version byte', () => {
    const { binary } = encryptRecord(plaintext, key, { compact: true });
    expect(() => decryptRecord('0x' + binary.toString('hex'), key)).toThrow(/does not match/);
    const v1 = encryptRecord(plaintext, key).binary;
    expect(() => decryptRecord('b64:' + v1.toString('base64'), key)).toThrow(/does not match/);
  });

  it('refuses malformed base64', () => {
    expect(() => decryptRecord('b64:not base64!', key)).toThrow(/base64/);
    expect(() => decryptRecord('b64:abc', key)).toThrow(/base64/); // unpadded
  });

  it('refuses a record that inflates past the cap (a decompression bomb)', () => {
    const bomb = zlib.deflateRawSync(Buffer.alloc(4 * 1024 * 1024));
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const ct = Buffer.concat([cipher.update(bomb), cipher.final()]);
    const bin = Buffer.concat([Buffer.from([RECORD_VERSION_COMPACT]), nonce, ct, cipher.getAuthTag()]);
    expect(() => decryptRecord('b64:' + bin.toString('base64'), key)).toThrow();
  });
});
