import {
  generateKeypair,
  derivePublicIdentity,
  signMessage,
  verifySignature,
  verifySignedBy,
  deriveSharedSecret,
  encrypt,
  decrypt,
  serializeForStorage,
  restoreFromStorage,
} from '../../core/weave/keypair.js';

describe('Weave Keypair', () => {
  let keypair;

  beforeAll(() => {
    keypair = generateKeypair();
  });

  describe('generateKeypair', () => {
    test('generates a valid keypair', () => {
      expect(keypair.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
      expect(keypair.publicKey).toMatch(/^0x04[0-9a-f]+$/);
      expect(keypair.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    test('returns frozen object', () => {
      expect(() => { keypair.privateKey = 'modified'; }).toThrow();
    });

    test('generates unique keypairs', () => {
      const another = generateKeypair();
      expect(another.address).not.toBe(keypair.address);
      expect(another.privateKey).not.toBe(keypair.privateKey);
    });
  });

  describe('derivePublicIdentity', () => {
    test('derives matching public key and address from private key', () => {
      const derived = derivePublicIdentity(keypair.privateKey);
      expect(derived.publicKey).toBe(keypair.publicKey);
      expect(derived.address).toBe(keypair.address);
    });
  });

  describe('signing and verification', () => {
    test('signs and verifies a message', async () => {
      const signature = await signMessage(keypair.privateKey, 'hello weave');
      const recoveredAddress = verifySignature('hello weave', signature);
      expect(recoveredAddress).toBe(keypair.address);
    });

    test('verifies signed by specific address', async () => {
      const signature = await signMessage(keypair.privateKey, 'test message');
      expect(verifySignedBy('test message', signature, keypair.address)).toBe(true);
    });

    test('rejects tampered message', async () => {
      const signature = await signMessage(keypair.privateKey, 'original');
      expect(verifySignedBy('tampered', signature, keypair.address)).toBe(false);
    });

    test('rejects wrong address', async () => {
      const other = generateKeypair();
      const signature = await signMessage(keypair.privateKey, 'test');
      expect(verifySignedBy('test', signature, other.address)).toBe(false);
    });

    test('handles invalid signature gracefully', () => {
      expect(verifySignature('test', 'invalid-signature')).toBe(null);
    });

    test('signs JSON objects', async () => {
      const obj = { name: 'Aethon', type: 'neuma' };
      const signature = await signMessage(keypair.privateKey, obj);
      const recovered = verifySignature(obj, signature);
      expect(recovered).toBe(keypair.address);
    });
  });

  describe('ECDH shared secret', () => {
    test('derives same shared secret from both sides', () => {
      const alice = generateKeypair();
      const bob = generateKeypair();

      const secretAlice = deriveSharedSecret(alice.privateKey, bob.publicKey);
      const secretBob = deriveSharedSecret(bob.privateKey, alice.publicKey);

      expect(secretAlice).toBe(secretBob);
      expect(secretAlice).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('encrypt / decrypt', () => {
    test('encrypts and decrypts a message', () => {
      const alice = generateKeypair();
      const bob = generateKeypair();
      const secret = deriveSharedSecret(alice.privateKey, bob.publicKey);

      const encrypted = encrypt('Hello from Alice', secret);
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.tag).toBeDefined();

      const decrypted = decrypt(encrypted, secret);
      expect(decrypted).toBe('Hello from Alice');
    });

    test('fails with wrong key', () => {
      const alice = generateKeypair();
      const bob = generateKeypair();
      const eve = generateKeypair();

      const secret = deriveSharedSecret(alice.privateKey, bob.publicKey);
      const wrongSecret = deriveSharedSecret(eve.privateKey, bob.publicKey);

      const encrypted = encrypt('Secret message', secret);
      const decrypted = decrypt(encrypted, wrongSecret);
      expect(decrypted).toBe(null);
    });

    test('returns frozen encrypted object', () => {
      const secret = deriveSharedSecret(generateKeypair().privateKey, generateKeypair().publicKey);
      const encrypted = encrypt('test', secret);
      expect(() => { encrypted.ciphertext = 'tampered'; }).toThrow();
    });
  });

  describe('storage serialization', () => {
    test('serializes and restores a keypair', () => {
      const stored = serializeForStorage(keypair);
      expect(stored.createdAt).toBeDefined();
      expect(stored.privateKey).toBe(keypair.privateKey);

      const restored = restoreFromStorage(stored);
      expect(restored.address).toBe(keypair.address);
      expect(restored.publicKey).toBe(keypair.publicKey);
    });

    test('detects corrupted storage', () => {
      const stored = serializeForStorage(keypair);
      stored.address = '0x0000000000000000000000000000000000000000';

      expect(() => restoreFromStorage(stored)).toThrow('address mismatch');
    });
  });
});
