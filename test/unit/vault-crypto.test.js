// Unit tests for the witness wallet's vault-crypto core.
// No mocks — exercises the real scrypt KDF and AES-256-GCM cipher. Round-trip
// tests use a small scrypt N for speed; KDF correctness is proven separately by
// the RFC 7914 known-answer vector.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const vault = require('../../electron/wallet/vault-crypto.cjs');

const FAST = { N: 1024, r: 8, p: 1, dkLen: 32 }; // cheap params for round-trip tests

describe('vault-crypto: scrypt KDF', () => {
  it('matches the RFC 7914 first known-answer vector', () => {
    // scrypt(P="", S="", N=16, r=1, p=1, dkLen=64)
    const out = vault.deriveKey('', Buffer.alloc(0), { N: 16, r: 1, p: 1, dkLen: 64 });
    expect(out.toString('hex')).toBe(
      '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442' +
        'fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906'
    );
  });

  it('is deterministic for the same password + salt', () => {
    const salt = crypto.randomBytes(16);
    const a = vault.deriveKey('passphrase', salt, FAST);
    const b = vault.deriveKey('passphrase', salt, FAST);
    expect(a.toString('hex')).toBe(b.toString('hex'));
  });
});

describe('vault-crypto: v1 seal / open round-trip', () => {
  const password = 'a-strong-witness-passphrase-42';
  const payload = {
    type: 'mnemonic',
    secret: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
  };

  it('seals then opens to exactly the same payload', () => {
    const env = vault.createVault(payload, password, { address: '0xAbC', params: FAST });
    expect(env.v).toBe(1);
    expect(env.kdf).toBe('scrypt');
    expect(env.cipher).toBe('aes-256-gcm');
    expect(env.address).toBe('0xAbC');
    expect(vault.openVault(env, password)).toEqual(payload);
  });

  it('rejects a wrong password via GCM authentication', () => {
    const env = vault.createVault(payload, password, { params: FAST });
    expect(() => vault.openVault(env, 'wrong-password')).toThrow();
  });

  it('detects ciphertext tampering', () => {
    const env = vault.createVault(payload, password, { params: FAST });
    const ct = Buffer.from(env.ct, 'base64');
    ct[0] ^= 0xff;
    expect(() => vault.openVault({ ...env, ct: ct.toString('base64') }, password)).toThrow();
  });

  it('detects iv tampering', () => {
    const env = vault.createVault(payload, password, { params: FAST });
    const iv = Buffer.from(env.iv, 'base64');
    iv[0] ^= 0xff;
    expect(() => vault.openVault({ ...env, iv: iv.toString('base64') }, password)).toThrow();
  });

  it('never writes the secret in cleartext anywhere in the envelope', () => {
    const env = vault.createVault(payload, password, { params: FAST });
    expect(JSON.stringify(env)).not.toContain(payload.secret);
    expect(JSON.stringify(env)).not.toContain('sausage');
  });

  it('produces a unique ciphertext per seal (fresh salt + iv)', () => {
    const a = vault.createVault(payload, password, { params: FAST });
    const b = vault.createVault(payload, password, { params: FAST });
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
    expect(a.kdfParams.salt).not.toBe(b.kdfParams.salt);
  });

  it('round-trips an imported private-key payload', () => {
    const pk = { type: 'privateKey', secret: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' };
    const env = vault.createVault(pk, password, { params: FAST });
    expect(vault.openVault(env, password)).toEqual(pk);
  });
});

describe('vault-crypto: input validation', () => {
  it('rejects an empty password', () => {
    expect(() => vault.createVault({ type: 'mnemonic', secret: 'x' }, '', { params: FAST })).toThrow(/password/);
  });

  it('rejects an unknown payload type', () => {
    expect(() => vault.createVault({ type: 'wat', secret: 'x' }, 'pw', { params: FAST })).toThrow(/type/);
  });

  it('rejects an empty secret', () => {
    expect(() => vault.createVault({ type: 'mnemonic', secret: '' }, 'pw', { params: FAST })).toThrow(/secret/);
  });

  it('rejects an unsupported envelope version on open', () => {
    expect(() => vault.openVault({ v: 99 }, 'pw')).toThrow(/version/);
  });
});

describe('vault-crypto: legacy v0 migration', () => {
  // Reconstruct exactly what the pre-versioning renderer wrote: PBKDF2-SHA256
  // (100k) → AES-256-GCM with the tag appended, payload = the raw private key.
  const buildLegacy = (password, privateKey) => {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(Buffer.from(password), salt, 100_000, 32, 'sha256');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(Buffer.from(privateKey)), cipher.final(), cipher.getAuthTag()]);
    return { address: '0xOld', encryptedKey: ct.toString('base64'), salt: salt.toString('base64'), iv: iv.toString('base64') };
  };

  it('reads a legacy PBKDF2-100k vault and recovers the private key', () => {
    const password = 'old-witness-password';
    const privateKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
    const stored = buildLegacy(password, privateKey);
    expect(vault.isLegacyVault(stored)).toBe(true);
    expect(vault.needsUpgrade(stored)).toBe(true);
    expect(vault.openLegacyVault(stored, password)).toEqual({ type: 'privateKey', secret: privateKey });
  });

  it('does not flag a v1 envelope as legacy or needing upgrade', () => {
    const env = vault.createVault({ type: 'mnemonic', secret: 'x y z' }, 'pw', { params: FAST });
    expect(vault.isLegacyVault(env)).toBe(false);
    expect(vault.needsUpgrade(env)).toBe(false);
  });

  it('rejects opening a non-legacy blob as legacy', () => {
    expect(() => vault.openLegacyVault({ v: 1 }, 'pw')).toThrow(/legacy/);
  });
});

describe('vault-crypto: rejects tampered KDF params (DoS hardening)', () => {
  const PW = 'a-strong-witness-passphrase';
  const make = () => vault.createVault({ type: 'mnemonic', secret: 'x y z' }, PW, { params: FAST });

  it('rejects an oversized scrypt r (memory-exhaustion vector)', () => {
    const e = make();
    expect(() => vault.openVault({ ...e, kdfParams: { ...e.kdfParams, r: 64 } }, PW)).toThrow(/scrypt r/);
  });

  it('rejects an oversized scrypt p (cpu-exhaustion vector)', () => {
    const e = make();
    expect(() => vault.openVault({ ...e, kdfParams: { ...e.kdfParams, p: 64 } }, PW)).toThrow(/scrypt p/);
  });

  it('rejects a non-power-of-two N', () => {
    const e = make();
    expect(() => vault.openVault({ ...e, kdfParams: { ...e.kdfParams, N: 1000 } }, PW)).toThrow(/scrypt N/);
  });

  it('rejects a wrong dkLen', () => {
    const e = make();
    expect(() => vault.openVault({ ...e, kdfParams: { ...e.kdfParams, dkLen: 16 } }, PW)).toThrow(/dkLen/);
  });
});
