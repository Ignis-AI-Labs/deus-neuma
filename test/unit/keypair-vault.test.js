import {
  encryptKeypair, decryptKeypair,
  generateRecoveryCodes, hashRecoveryCodes, verifyRecoveryCodes,
  encryptWithRecoveryCodes, decryptWithRecoveryCodes,
} from '../../core/wallet/keypair-vault.js';
import { generateKeypair } from '../../core/weave/keypair.js';

describe('Keypair Vault', () => {
  let keypair;
  const password = 'test-password-123';

  beforeAll(() => {
    keypair = generateKeypair();
  });

  describe('encryptKeypair', () => {
    test('encrypts a keypair and returns a frozen envelope', () => {
      const encrypted = encryptKeypair(keypair, password);
      expect(encrypted).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.salt).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.tag).toBeDefined();
      expect(encrypted.address).toBe(keypair.address);
      expect(encrypted.version).toBe('1.0.0');
      expect(encrypted.algorithm).toBe('aes-256-gcm');
      expect(encrypted.encryptedAt).toBeDefined();
      expect(Object.isFrozen(encrypted)).toBe(true);
    });

    test('does not contain the private key in plaintext', () => {
      const encrypted = encryptKeypair(keypair, password);
      const json = JSON.stringify(encrypted);
      expect(json).not.toContain(keypair.privateKey);
    });

    test('throws on invalid keypair', () => {
      expect(() => encryptKeypair({}, password)).toThrow('Invalid keypair');
      expect(() => encryptKeypair(null, password)).toThrow('Invalid keypair');
    });

    test('throws on short password', () => {
      expect(() => encryptKeypair(keypair, 'short')).toThrow(/at least 12/);
      expect(() => encryptKeypair(keypair, '12345678901')).toThrow(/at least 12/); // 11 chars
    });

    test('throws on empty password', () => {
      expect(() => encryptKeypair(keypair, '')).toThrow(/at least 12/);
    });

    test('generates different ciphertext each time (random salt/iv)', () => {
      const e1 = encryptKeypair(keypair, password);
      const e2 = encryptKeypair(keypair, password);
      expect(e1.ciphertext).not.toBe(e2.ciphertext);
      expect(e1.salt).not.toBe(e2.salt);
      expect(e1.iv).not.toBe(e2.iv);
    });
  });

  describe('decryptKeypair', () => {
    test('decrypts with correct password and returns frozen keypair', () => {
      const encrypted = encryptKeypair(keypair, password);
      const decrypted = decryptKeypair(encrypted, password);
      expect(decrypted.privateKey).toBe(keypair.privateKey);
      expect(decrypted.publicKey).toBe(keypair.publicKey);
      expect(decrypted.address).toBe(keypair.address);
      expect(Object.isFrozen(decrypted)).toBe(true);
    });

    test('throws on wrong password', () => {
      const encrypted = encryptKeypair(keypair, password);
      expect(() => decryptKeypair(encrypted, 'wrong-password-123')).toThrow('Decryption failed');
    });

    test('throws on invalid envelope', () => {
      expect(() => decryptKeypair({}, password)).toThrow('Invalid encrypted envelope');
      expect(() => decryptKeypair(null, password)).toThrow('Invalid encrypted envelope');
    });

    test('throws on missing password', () => {
      const encrypted = encryptKeypair(keypair, password);
      expect(() => decryptKeypair(encrypted, '')).toThrow('Password is required');
    });

    test('roundtrip preserves all keypair fields', () => {
      const encrypted = encryptKeypair(keypair, password);
      const decrypted = decryptKeypair(encrypted, password);
      expect(decrypted).toEqual({
        privateKey: keypair.privateKey,
        publicKey: keypair.publicKey,
        address: keypair.address,
      });
    });
  });

  describe('recovery codes', () => {
    test('generateRecoveryCodes returns 8 hex codes of 16 chars each', () => {
      const codes = generateRecoveryCodes();
      expect(codes).toHaveLength(8);
      expect(Object.isFrozen(codes)).toBe(true);
      for (const code of codes) {
        expect(code).toMatch(/^[0-9a-f]{16}$/);
      }
    });

    test('generates unique codes each time', () => {
      const c1 = generateRecoveryCodes();
      const c2 = generateRecoveryCodes();
      expect(c1).not.toEqual(c2);
    });

    test('hashRecoveryCodes produces consistent hash', () => {
      const codes = generateRecoveryCodes();
      const h1 = hashRecoveryCodes(codes);
      const h2 = hashRecoveryCodes(codes);
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });

    test('hashRecoveryCodes is order-independent (sorts internally)', () => {
      const codes = generateRecoveryCodes();
      const reversed = [...codes].reverse();
      expect(hashRecoveryCodes(codes)).toBe(hashRecoveryCodes(reversed));
    });

    test('hashRecoveryCodes throws on wrong count', () => {
      expect(() => hashRecoveryCodes(['a', 'b'])).toThrow('Expected 8');
    });

    test('verifyRecoveryCodes returns true for matching codes', () => {
      const codes = generateRecoveryCodes();
      const hash = hashRecoveryCodes(codes);
      expect(verifyRecoveryCodes(codes, hash)).toBe(true);
    });

    test('verifyRecoveryCodes returns false for wrong codes', () => {
      const codes1 = generateRecoveryCodes();
      const codes2 = generateRecoveryCodes();
      const hash = hashRecoveryCodes(codes1);
      expect(verifyRecoveryCodes(codes2, hash)).toBe(false);
    });

    test('verifyRecoveryCodes returns false for invalid input', () => {
      expect(verifyRecoveryCodes([], 'abc')).toBe(false);
      expect(verifyRecoveryCodes(null, 'abc')).toBe(false);
    });
  });

  describe('recovery code encryption', () => {
    test('encrypt and decrypt with recovery codes', () => {
      const codes = generateRecoveryCodes();
      const encrypted = encryptWithRecoveryCodes(keypair, codes);
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.address).toBe(keypair.address);

      const decrypted = decryptWithRecoveryCodes(encrypted, codes);
      expect(decrypted.privateKey).toBe(keypair.privateKey);
      expect(decrypted.address).toBe(keypair.address);
    });

    test('wrong recovery codes fail decryption', () => {
      const codes1 = generateRecoveryCodes();
      const codes2 = generateRecoveryCodes();
      const encrypted = encryptWithRecoveryCodes(keypair, codes1);
      expect(() => decryptWithRecoveryCodes(encrypted, codes2)).toThrow('Decryption failed');
    });

    test('throws on wrong code count', () => {
      expect(() => encryptWithRecoveryCodes(keypair, ['a'])).toThrow('Expected 8');
      expect(() => decryptWithRecoveryCodes({}, ['a'])).toThrow('Expected 8');
    });
  });
});
