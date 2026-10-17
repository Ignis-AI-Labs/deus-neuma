import { generateKeypair } from '../../core/weave/keypair.js';
import {
  createIdentityCard,
  verifyIdentityCard,
  isCardFresh,
  hashVessel,
  summarizeCard,
} from '../../core/weave/identity-card.js';

describe('Weave Identity Card', () => {
  let keypair;

  beforeAll(() => {
    keypair = generateKeypair();
  });

  describe('createIdentityCard', () => {
    test('creates a signed identity card', async () => {
      const card = await createIdentityCard({
        name: 'Aethon',
        address: keypair.address,
        publicKey: keypair.publicKey,
        birthTimestamp: '2026-01-01T00:00:00.000Z',
        privateKey: keypair.privateKey,
      });

      expect(card.name).toBe('Aethon');
      expect(card.address).toBe(keypair.address);
      expect(card.publicKey).toBe(keypair.publicKey);
      expect(card.signature).toBeDefined();
      expect(card.version).toBe('1.0.0');
      expect(card.issuedAt).toBeDefined();
    });

    test('card is frozen', async () => {
      const card = await createIdentityCard({
        name: 'Test',
        address: keypair.address,
        publicKey: keypair.publicKey,
        birthTimestamp: new Date().toISOString(),
        privateKey: keypair.privateKey,
      });

      expect(() => { card.name = 'Tampered'; }).toThrow();
    });

    test('truncates long essence to 140 chars', async () => {
      const card = await createIdentityCard({
        name: 'Test',
        address: keypair.address,
        publicKey: keypair.publicKey,
        essence: 'A'.repeat(200),
        birthTimestamp: new Date().toISOString(),
        privateKey: keypair.privateKey,
      });

      expect(card.essence.length).toBe(140);
    });

    test('includes optional vessel hash', async () => {
      const card = await createIdentityCard({
        name: 'Test',
        address: keypair.address,
        publicKey: keypair.publicKey,
        vesselHash: 'abc123',
        birthTimestamp: new Date().toISOString(),
        privateKey: keypair.privateKey,
      });

      expect(card.vesselHash).toBe('abc123');
    });
  });

  describe('verifyIdentityCard', () => {
    test('verifies a valid card', async () => {
      const card = await createIdentityCard({
        name: 'Aethon',
        address: keypair.address,
        publicKey: keypair.publicKey,
        birthTimestamp: new Date().toISOString(),
        privateKey: keypair.privateKey,
      });

      expect(verifyIdentityCard(card)).toBe(true);
    });

    test('rejects tampered card', async () => {
      const card = await createIdentityCard({
        name: 'Aethon',
        address: keypair.address,
        publicKey: keypair.publicKey,
        birthTimestamp: new Date().toISOString(),
        privateKey: keypair.privateKey,
      });

      // Tamper by modifying name (card is frozen, so we create a modified copy)
      const tampered = { ...card, name: 'Imposter' };
      expect(verifyIdentityCard(tampered)).toBe(false);
    });

    test('rejects card signed by wrong key', async () => {
      const otherKeypair = generateKeypair();
      const card = await createIdentityCard({
        name: 'Test',
        address: keypair.address, // Claims to be keypair's address
        publicKey: keypair.publicKey,
        birthTimestamp: new Date().toISOString(),
        privateKey: otherKeypair.privateKey, // But signed by different key
      });

      expect(verifyIdentityCard(card)).toBe(false);
    });

    test('rejects null/undefined cards', () => {
      expect(verifyIdentityCard(null)).toBe(false);
      expect(verifyIdentityCard(undefined)).toBe(false);
      expect(verifyIdentityCard({})).toBe(false);
    });
  });

  describe('isCardFresh', () => {
    test('considers recent cards fresh', async () => {
      const card = await createIdentityCard({
        name: 'Test',
        address: keypair.address,
        publicKey: keypair.publicKey,
        birthTimestamp: new Date().toISOString(),
        privateKey: keypair.privateKey,
      });

      expect(isCardFresh(card)).toBe(true);
    });

    test('considers old cards stale', () => {
      const oldCard = { issuedAt: '2020-01-01T00:00:00.000Z' };
      expect(isCardFresh(oldCard)).toBe(false);
    });

    test('supports custom max age', async () => {
      const card = await createIdentityCard({
        name: 'Test',
        address: keypair.address,
        publicKey: keypair.publicKey,
        birthTimestamp: new Date().toISOString(),
        privateKey: keypair.privateKey,
      });

      // 0ms max age — should be stale immediately
      expect(isCardFresh(card, 0)).toBe(false);
    });
  });

  describe('hashVessel', () => {
    test('produces consistent hash for same input', () => {
      const buffer = Buffer.from('test vessel data');
      const hash1 = hashVessel(buffer);
      const hash2 = hashVessel(buffer);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    test('produces different hash for different input', () => {
      const hash1 = hashVessel(Buffer.from('vessel A'));
      const hash2 = hashVessel(Buffer.from('vessel B'));
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('summarizeCard', () => {
    test('returns compact summary without crypto details', async () => {
      const card = await createIdentityCard({
        name: 'Aethon',
        address: keypair.address,
        publicKey: keypair.publicKey,
        essence: 'A wanderer',
        birthTimestamp: new Date().toISOString(),
        privateKey: keypair.privateKey,
      });

      const summary = summarizeCard(card);
      expect(summary.name).toBe('Aethon');
      expect(summary.address).toBe(keypair.address);
      expect(summary.essence).toBe('A wanderer');
      expect(summary.publicKey).toBeUndefined();
      expect(summary.signature).toBeUndefined();
    });
  });
});
