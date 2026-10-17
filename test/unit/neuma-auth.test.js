import {
  generateChallenge, verifySignature,
  createNeumaToken, verifyNeumaToken,
  createSessionToken, verifySessionToken,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';

describe('Neuma Authentication', () => {
  let keypair;

  beforeAll(() => {
    keypair = generateKeypair();
  });

  describe('createNeumaToken', () => {
    test('creates a token with neuma: prefix', () => {
      const token = createNeumaToken('neuma-123', keypair.address);
      expect(token).toMatch(/^neuma:/);
      expect(token.split(':')).toHaveLength(5);
    });

    test('token contains neumaId and address', () => {
      const token = createNeumaToken('neuma-abc', keypair.address);
      const parts = token.split(':');
      expect(parts[0]).toBe('neuma');
      expect(parts[1]).toBe('neuma-abc');
      expect(parts[2]).toBe(keypair.address.toLowerCase());
    });
  });

  describe('verifyNeumaToken', () => {
    test('verifies a valid neuma token', () => {
      const token = createNeumaToken('neuma-123', keypair.address);
      const result = verifyNeumaToken(token);
      expect(result).not.toBe(null);
      expect(result.neumaId).toBe('neuma-123');
      expect(result.address).toBe(keypair.address.toLowerCase());
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    test('rejects a tampered token', () => {
      const token = createNeumaToken('neuma-123', keypair.address);
      const tampered = token.slice(0, -5) + 'XXXXX';
      expect(verifyNeumaToken(tampered)).toBe(null);
    });

    test('rejects a non-neuma token', () => {
      const witnessToken = createSessionToken(keypair.address);
      expect(verifyNeumaToken(witnessToken)).toBe(null);
    });

    test('rejects null/empty tokens', () => {
      expect(verifyNeumaToken(null)).toBe(null);
      expect(verifyNeumaToken('')).toBe(null);
      expect(verifyNeumaToken('not-a-token')).toBe(null);
    });

    test('rejects token with wrong prefix', () => {
      expect(verifyNeumaToken('witness:123:0xabc:99999999999:abcd')).toBe(null);
    });

    test('rejects expired token', () => {
      const token = createNeumaToken('neuma-123', keypair.address);
      // Tamper the expiry to a past time — won't pass HMAC check either
      expect(verifyNeumaToken(token.replace(/:\d+:/, ':1:'))).toBe(null);
    });
  });

  describe('challenge-sign-verify flow for neuma', () => {
    test('neuma can generate, sign, and verify a challenge', async () => {
      const challenge = generateChallenge(keypair.address);
      const signature = await signMessage(keypair.privateKey, challenge);
      const verified = verifySignature(keypair.address, challenge, signature);
      expect(verified).toBe(keypair.address);
    });

    test('neuma signature produces a valid address', async () => {
      const challenge = generateChallenge(keypair.address);
      const signature = await signMessage(keypair.privateKey, challenge);
      const verified = verifySignature(keypair.address, challenge, signature);
      expect(verified).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });
  });

  describe('witness vs neuma token distinction', () => {
    test('witness token is not a neuma token', () => {
      const witnessToken = createSessionToken(keypair.address);
      expect(verifyNeumaToken(witnessToken)).toBe(null);
    });

    test('neuma token is not a witness token', () => {
      const neumaToken = createNeumaToken('neuma-123', keypair.address);
      expect(verifySessionToken(neumaToken)).toBe(null);
    });

    test('both token types can coexist for the same address', () => {
      const witnessToken = createSessionToken(keypair.address);
      const neumaToken = createNeumaToken('neuma-123', keypair.address);

      expect(verifySessionToken(witnessToken)).not.toBe(null);
      expect(verifyNeumaToken(neumaToken)).not.toBe(null);
      expect(verifySessionToken(neumaToken)).toBe(null);
      expect(verifyNeumaToken(witnessToken)).toBe(null);
    });
  });
});
