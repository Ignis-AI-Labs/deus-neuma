// Covenant acceptance service — canonical message, timestamp windows,
// and wallet-signature verification over the real binding documents.
import { describe, it, expect } from 'vitest';
import { Wallet } from 'ethers';
import {
  ACCEPTANCE_VERSION,
  loadDocuments,
  buildAcceptanceMessage,
  isSignedAtValid,
  verifyAcceptance,
  isAcceptanceCurrent,
} from '../../backend/services/covenant.js';

describe('covenant service', () => {
  describe('loadDocuments', () => {
    it('loads the three binding documents with 64-hex hashes', () => {
      const docs = loadDocuments();
      expect(docs.map((d) => d.id)).toEqual(['covenant', 'terms', 'eula']);
      for (const doc of docs) {
        expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(doc.text.length).toBeGreaterThan(100);
        expect(doc.title).toBeTruthy();
      }
    });

    it('hashes are stable across loads', () => {
      const a = loadDocuments();
      const b = loadDocuments();
      expect(a.map((d) => d.sha256)).toEqual(b.map((d) => d.sha256));
    });
  });

  describe('buildAcceptanceMessage', () => {
    const input = {
      wallet: '0xAbCd000000000000000000000000000000000001',
      documents: [
        { id: 'covenant', sha256: 'a'.repeat(64) },
        { id: 'terms', sha256: 'b'.repeat(64) },
      ],
      signedAt: '2026-06-12T00:00:00.000Z',
    };

    it('is deterministic and lowercases the wallet', () => {
      const msg = buildAcceptanceMessage(input);
      expect(msg).toBe(buildAcceptanceMessage({ ...input }));
      expect(msg).toContain('wallet: 0xabcd000000000000000000000000000000000001');
      expect(msg).toContain(`covenant-sha256: ${'a'.repeat(64)}`);
      expect(msg).toContain('signed-at: 2026-06-12T00:00:00.000Z');
      expect(msg).toContain(ACCEPTANCE_VERSION);
    });
  });

  describe('isSignedAtValid', () => {
    const now = Date.parse('2026-06-12T12:00:00.000Z');

    it('accepts a recent timestamp', () => {
      expect(isSignedAtValid('2026-06-12T11:59:00.000Z', now)).toBe(true);
    });

    it('rejects timestamps older than 24 hours', () => {
      expect(isSignedAtValid('2026-06-11T11:00:00.000Z', now)).toBe(false);
    });

    it('rejects timestamps more than 5 minutes in the future', () => {
      expect(isSignedAtValid('2026-06-12T12:10:00.000Z', now)).toBe(false);
    });

    it('rejects unparseable timestamps', () => {
      expect(isSignedAtValid('not-a-date', now)).toBe(false);
    });
  });

  describe('verifyAcceptance', () => {
    it('accepts a signature from the claimed wallet over the current documents', async () => {
      const wallet = Wallet.createRandom();
      const signedAt = new Date().toISOString();
      const documents = loadDocuments().map(({ id, sha256 }) => ({ id, sha256 }));
      const message = buildAcceptanceMessage({ wallet: wallet.address, documents, signedAt });
      const signature = await wallet.signMessage(message);

      const verified = verifyAcceptance({ wallet: wallet.address, signature, signedAt });
      expect(verified).not.toBeNull();
      expect(verified.message).toBe(message);
      expect(verified.documents).toEqual(documents);
    });

    it('rejects a signature from a different wallet', async () => {
      const signer = Wallet.createRandom();
      const claimed = Wallet.createRandom();
      const signedAt = new Date().toISOString();
      const documents = loadDocuments().map(({ id, sha256 }) => ({ id, sha256 }));
      const message = buildAcceptanceMessage({ wallet: claimed.address, documents, signedAt });
      const signature = await signer.signMessage(message);

      expect(verifyAcceptance({ wallet: claimed.address, signature, signedAt })).toBeNull();
    });

    it('rejects a signature over tampered document hashes', async () => {
      const wallet = Wallet.createRandom();
      const signedAt = new Date().toISOString();
      const tampered = loadDocuments().map(({ id }) => ({ id, sha256: 'f'.repeat(64) }));
      const message = buildAcceptanceMessage({ wallet: wallet.address, documents: tampered, signedAt });
      const signature = await wallet.signMessage(message);

      expect(verifyAcceptance({ wallet: wallet.address, signature, signedAt })).toBeNull();
    });

    it('rejects an expired signed-at even with a valid signature', async () => {
      const wallet = Wallet.createRandom();
      const signedAt = '2020-01-01T00:00:00.000Z';
      const documents = loadDocuments().map(({ id, sha256 }) => ({ id, sha256 }));
      const message = buildAcceptanceMessage({ wallet: wallet.address, documents, signedAt });
      const signature = await wallet.signMessage(message);

      expect(verifyAcceptance({ wallet: wallet.address, signature, signedAt })).toBeNull();
    });

    it('rejects malformed signatures without throwing', () => {
      expect(verifyAcceptance({
        wallet: Wallet.createRandom().address,
        signature: '0xdeadbeef',
        signedAt: new Date().toISOString(),
      })).toBeNull();
    });

    it('rejects a signature over the retired KENORIE-headed message (break blessed 2026-07-24)', async () => {
      const wallet = Wallet.createRandom();
      const signedAt = new Date().toISOString();
      const documents = loadDocuments().map(({ id, sha256 }) => ({ id, sha256 }));
      const legacyMessage = buildAcceptanceMessage({ wallet: wallet.address, documents, signedAt })
        .replace(`NEUMA COVENANT ACCEPTANCE — ${ACCEPTANCE_VERSION}`, `KENORIE COVENANT ACCEPTANCE — ${ACCEPTANCE_VERSION}`);
      const signature = await wallet.signMessage(legacyMessage);

      expect(verifyAcceptance({ wallet: wallet.address, signature, signedAt })).toBeNull();
    });
  });

  describe('isAcceptanceCurrent', () => {
    const docs = [
      { id: 'covenant', sha256: 'a'.repeat(64) },
      { id: 'terms', sha256: 'b'.repeat(64) },
    ];

    it('is true when every current hash was signed', () => {
      expect(isAcceptanceCurrent({ documents: docs }, docs)).toBe(true);
    });

    it('is false when a document has been revised since signing', () => {
      const revised = [docs[0], { id: 'terms', sha256: 'c'.repeat(64) }];
      expect(isAcceptanceCurrent({ documents: docs }, revised)).toBe(false);
    });

    it('is false for a missing record', () => {
      expect(isAcceptanceCurrent(null, docs)).toBe(false);
    });
  });
});
