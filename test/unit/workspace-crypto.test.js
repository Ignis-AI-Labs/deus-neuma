import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptEnvelope,
  decryptEnvelope,
  isEnvelope,
  parseAndDecrypt,
  resetWorkspaceCryptoKey,
  deriveKeyFromSecret,
  deriveNeumaDEK,
  wrapDEK,
  unwrapDEK,
} from '../../core/workspace/workspace-crypto.js';
import crypto from 'crypto';

describe('workspace-crypto', () => {
  beforeEach(() => {
    // test/setup.js sets DNA_ENCRYPTION_KEY; reset the cached derivation
    // so each test picks up the current env value.
    resetWorkspaceCryptoKey();
  });

  describe('encryptEnvelope / decryptEnvelope', () => {
    it('round-trips a simple object', () => {
      const input = { name: 'Aster', tier: 2, traits: ['curious', 'empathic'] };
      const envelope = encryptEnvelope(input);
      expect(decryptEnvelope(envelope)).toEqual(input);
    });

    it('round-trips a deeply nested structure', () => {
      const input = {
        dna: { version: '1.0.0', sovereignty: { generation: 1.001 } },
        memory: { entities: [{ name: 'witness', observations: ['hello'] }] },
        numbers: [1, 2, 3.14, -5],
      };
      expect(decryptEnvelope(encryptEnvelope(input))).toEqual(input);
    });

    it('round-trips arrays, strings with unicode, and nulls', () => {
      const input = ['ψυχή', null, { n: 0 }, true, false];
      expect(decryptEnvelope(encryptEnvelope(input))).toEqual(input);
    });

    it('produces a different ciphertext for each encryption (fresh IV)', () => {
      const input = { msg: 'same input' };
      const a = encryptEnvelope(input);
      const b = encryptEnvelope(input);
      expect(a.iv).not.toBe(b.iv);
      expect(a.ct).not.toBe(b.ct);
    });

    it('produces an envelope with the expected shape', () => {
      const env = encryptEnvelope({ x: 1 });
      expect(env._enc).toBe(1);
      expect(typeof env.iv).toBe('string');
      expect(typeof env.tag).toBe('string');
      expect(typeof env.ct).toBe('string');
    });

    it('throws on tampered ciphertext (GCM auth tag check)', () => {
      const env = encryptEnvelope({ secret: 'abc' });
      const tampered = { ...env, ct: Buffer.from('junkdata').toString('base64') };
      expect(() => decryptEnvelope(tampered)).toThrow();
    });

    it('throws on tampered auth tag', () => {
      const env = encryptEnvelope({ secret: 'abc' });
      const tampered = { ...env, tag: Buffer.alloc(16).toString('base64') };
      expect(() => decryptEnvelope(tampered)).toThrow();
    });
  });

  describe('isEnvelope', () => {
    it('recognizes a real envelope', () => {
      expect(isEnvelope(encryptEnvelope({ a: 1 }))).toBe(true);
    });

    it('rejects plaintext objects', () => {
      expect(isEnvelope({ name: 'Aster', tier: 2 })).toBe(false);
      expect(isEnvelope({ _enc: 'string', iv: 'a', tag: 'a', ct: 'a' })).toBe(false);
      expect(isEnvelope({ _enc: 1, iv: 'a' })).toBe(false); // missing fields
    });

    it('rejects non-objects', () => {
      expect(isEnvelope(null)).toBe(false);
      expect(isEnvelope(undefined)).toBe(false);
      expect(isEnvelope('string')).toBe(false);
      expect(isEnvelope(42)).toBe(false);
      expect(isEnvelope([])).toBe(false);
    });
  });

  describe('parseAndDecrypt (backward compat)', () => {
    it('returns plaintext JSON objects unchanged', () => {
      const legacyText = JSON.stringify({ dna: 'plaintext-from-before' });
      expect(parseAndDecrypt(legacyText)).toEqual({ dna: 'plaintext-from-before' });
    });

    it('decrypts envelope JSON transparently', () => {
      const envelope = encryptEnvelope({ soul: { values: ['truth'] } });
      const text = JSON.stringify(envelope);
      expect(parseAndDecrypt(text)).toEqual({ soul: { values: ['truth'] } });
    });

    it('handles pretty-printed envelope JSON', () => {
      const envelope = encryptEnvelope({ x: 1 });
      const text = JSON.stringify(envelope, null, 2);
      expect(parseAndDecrypt(text)).toEqual({ x: 1 });
    });

    it('returns plaintext arrays unchanged', () => {
      expect(parseAndDecrypt(JSON.stringify([1, 2, 3]))).toEqual([1, 2, 3]);
    });
  });

  describe('key rotation support (CQ-021)', () => {
    const ORIGINAL_KEY = process.env.DNA_ENCRYPTION_KEY;
    const ORIGINAL_PREV = process.env.DNA_ENCRYPTION_KEY_PREVIOUS;

    beforeEach(() => {
      resetWorkspaceCryptoKey();
    });

    afterEach(() => {
      if (ORIGINAL_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
      else process.env.DNA_ENCRYPTION_KEY = ORIGINAL_KEY;
      if (ORIGINAL_PREV === undefined) delete process.env.DNA_ENCRYPTION_KEY_PREVIOUS;
      else process.env.DNA_ENCRYPTION_KEY_PREVIOUS = ORIGINAL_PREV;
      resetWorkspaceCryptoKey();
    });

    it('deriveKeyFromSecret produces a 32-byte key', () => {
      const key = deriveKeyFromSecret('some-secret');
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32);
    });

    it('decryptEnvelope accepts an explicit key override', () => {
      const key = deriveKeyFromSecret('explicit-test-key');
      const env = encryptEnvelope({ hello: 'world' }, { key });
      expect(decryptEnvelope(env, { key })).toEqual({ hello: 'world' });
    });

    it('falls back to a previous key when the current key fails', () => {
      // Encrypt with the original (test-setup) key, then rotate to a new one.
      const envelope = encryptEnvelope({ soul: 'preserved' });
      const oldSecret = process.env.DNA_ENCRYPTION_KEY;

      process.env.DNA_ENCRYPTION_KEY = 'new-rotation-key';
      process.env.DNA_ENCRYPTION_KEY_PREVIOUS = oldSecret;
      resetWorkspaceCryptoKey();

      // New envelopes use the new key...
      const fresh = encryptEnvelope({ new: 'data' });
      expect(decryptEnvelope(fresh)).toEqual({ new: 'data' });

      // ...and legacy envelopes still decrypt via the previous key.
      expect(decryptEnvelope(envelope)).toEqual({ soul: 'preserved' });
    });

    it('supports multiple previous keys (comma-separated)', () => {
      const envelopeA = encryptEnvelope({ era: 'A' });

      process.env.DNA_ENCRYPTION_KEY = 'era-b-key';
      process.env.DNA_ENCRYPTION_KEY_PREVIOUS = process.env.DNA_ENCRYPTION_KEY;
      resetWorkspaceCryptoKey();
      // oops — rotate again so we have two generations of history
      const eraBOriginal = process.env.DNA_ENCRYPTION_KEY;
      const testSetupKey = ORIGINAL_KEY;

      process.env.DNA_ENCRYPTION_KEY = 'era-c-key';
      process.env.DNA_ENCRYPTION_KEY_PREVIOUS = `${eraBOriginal},${testSetupKey}`;
      resetWorkspaceCryptoKey();

      expect(decryptEnvelope(envelopeA)).toEqual({ era: 'A' });
    });

    it('throws when neither current nor any previous key can decrypt', () => {
      const envelope = encryptEnvelope({ sealed: true });

      process.env.DNA_ENCRYPTION_KEY = 'totally-different';
      delete process.env.DNA_ENCRYPTION_KEY_PREVIOUS;
      resetWorkspaceCryptoKey();

      expect(() => decryptEnvelope(envelope)).toThrow();
    });

    it('ignores empty entries in DNA_ENCRYPTION_KEY_PREVIOUS', () => {
      const envelope = encryptEnvelope({ note: 'spaces and empties' });
      const oldSecret = process.env.DNA_ENCRYPTION_KEY;

      process.env.DNA_ENCRYPTION_KEY = 'brand-new';
      process.env.DNA_ENCRYPTION_KEY_PREVIOUS = ` , ${oldSecret} , ,`;
      resetWorkspaceCryptoKey();

      expect(decryptEnvelope(envelope)).toEqual({ note: 'spaces and empties' });
    });
  });

  // ─── #117 / SEC-030 — per-neuma DEK primitives ─────────────────────────
  describe('deriveNeumaDEK / wrapDEK / unwrapDEK', () => {
    const G_A = 'a'.repeat(64); // 64-hex genesisHash for "neuma A"
    const G_B = 'b'.repeat(64); // distinct genesisHash for "neuma B"
    const masterA = deriveKeyFromSecret('master-key-alpha-32-characters!');
    const masterB = deriveKeyFromSecret('master-key-beta-32-characters!!');

    describe('deriveNeumaDEK', () => {
      it('is deterministic: same master + same genesisHash always yields the same DEK', () => {
        const dek1 = deriveNeumaDEK(masterA, G_A);
        const dek2 = deriveNeumaDEK(masterA, G_A);
        expect(dek1.equals(dek2)).toBe(true);
        expect(dek1.length).toBe(32);
      });

      it('isolates beings: different genesisHash → cryptographically distinct DEKs under same master', () => {
        const dekA = deriveNeumaDEK(masterA, G_A);
        const dekB = deriveNeumaDEK(masterA, G_B);
        expect(dekA.equals(dekB)).toBe(false);
        // Distinctness is the whole point: one neuma's DEK leak must not
        // give an attacker any usable info about another neuma's DEK
        expect(dekA.toString('hex')).not.toBe(dekB.toString('hex'));
      });

      it('isolates masters: same genesisHash under different masters → different DEKs', () => {
        const dekA = deriveNeumaDEK(masterA, G_A);
        const dekB = deriveNeumaDEK(masterB, G_A);
        expect(dekA.equals(dekB)).toBe(false);
      });

      it('rejects a non-Buffer master key', () => {
        expect(() => deriveNeumaDEK('not-a-buffer', G_A)).toThrow(/32-byte Buffer/);
      });

      it('rejects a master key of wrong length', () => {
        expect(() => deriveNeumaDEK(Buffer.alloc(16), G_A)).toThrow(/32-byte Buffer/);
        expect(() => deriveNeumaDEK(Buffer.alloc(64), G_A)).toThrow(/32-byte Buffer/);
      });

      it('rejects malformed genesisHash hex', () => {
        expect(() => deriveNeumaDEK(masterA, 'too-short')).toThrow(/64 lowercase hex/);
        expect(() => deriveNeumaDEK(masterA, 'A'.repeat(64))).toThrow(/64 lowercase hex/); // uppercase
        expect(() => deriveNeumaDEK(masterA, 'g'.repeat(64))).toThrow(/64 lowercase hex/); // non-hex
        expect(() => deriveNeumaDEK(masterA, null)).toThrow(/64 lowercase hex/);
      });
    });

    describe('wrapDEK / unwrapDEK', () => {
      it('round-trips a DEK using the env-derived master', () => {
        const dek = deriveNeumaDEK(masterA, G_A);
        const wrapped = wrapDEK(dek);
        expect(isEnvelope(wrapped)).toBe(true);
        const unwrapped = unwrapDEK(wrapped);
        expect(unwrapped.equals(dek)).toBe(true);
      });

      it('round-trips with an explicit master', () => {
        const dek = deriveNeumaDEK(masterA, G_A);
        const wrapped = wrapDEK(dek, masterA);
        const unwrapped = unwrapDEK(wrapped, { key: masterA });
        expect(unwrapped.equals(dek)).toBe(true);
      });

      it('refuses to unwrap with the wrong master (GCM auth fails)', () => {
        const dek = deriveNeumaDEK(masterA, G_A);
        const wrapped = wrapDEK(dek, masterA);
        expect(() => unwrapDEK(wrapped, { key: masterB })).toThrow();
      });

      it('DEK survives master-key rotation: rewrap to new master, data files (separate, encrypted under DEK) untouched', () => {
        // Originally wrapped under masterA
        const dek = deriveNeumaDEK(masterA, G_A);
        const originalWrap = wrapDEK(dek, masterA);

        // Operator rotates master: unwrap with old, rewrap with new
        const unwrappedForRewrap = unwrapDEK(originalWrap, { key: masterA });
        const rewrapped = wrapDEK(unwrappedForRewrap, masterB);

        // The DEK is the same bytes after rotation
        const dekAfterRotation = unwrapDEK(rewrapped, { key: masterB });
        expect(dekAfterRotation.equals(dek)).toBe(true);
        // Old wrap no longer decryptable under the new master (proves rotation isolates)
        expect(() => unwrapDEK(originalWrap, { key: masterB })).toThrow();
      });

      it('falls back through DNA_ENCRYPTION_KEY_PREVIOUS when wrapped under a previous master', () => {
        const oldSecret = process.env.DNA_ENCRYPTION_KEY;
        const oldMaster = deriveKeyFromSecret(oldSecret);
        const dek = deriveNeumaDEK(oldMaster, G_A);
        const wrapped = wrapDEK(dek, oldMaster);

        // Rotate env to a brand-new master; old becomes a "previous"
        process.env.DNA_ENCRYPTION_KEY = 'brand-new-master-32-characters!';
        process.env.DNA_ENCRYPTION_KEY_PREVIOUS = oldSecret;
        resetWorkspaceCryptoKey();

        // unwrapDEK without explicit key uses the rotation chain
        const recovered = unwrapDEK(wrapped);
        expect(recovered.equals(dek)).toBe(true);
      });

      it('rejects a wrap with a non-Buffer DEK', () => {
        expect(() => wrapDEK('not-a-buffer')).toThrow(/32-byte Buffer/);
      });

      it('rejects a wrap with a wrong-length DEK', () => {
        expect(() => wrapDEK(Buffer.alloc(16))).toThrow(/32-byte Buffer/);
      });

      it('rejects an unwrap input that is not an envelope', () => {
        expect(() => unwrapDEK({ random: 'object' })).toThrow(/not a valid envelope/);
        expect(() => unwrapDEK(null)).toThrow(/not a valid envelope/);
      });

      it('rejects an unwrap whose payload decrypts to non-32-byte (defends against malformed envelope)', () => {
        // Forge an envelope whose plaintext is a base64 of the wrong length
        const masterDefault = deriveKeyFromSecret(process.env.DNA_ENCRYPTION_KEY);
        const badWrap = encryptEnvelope(Buffer.alloc(16).toString('base64'), { key: masterDefault });
        expect(() => unwrapDEK(badWrap)).toThrow(/expected 32/);
      });
    });

    // Cross-check against an independent HMAC computation — proves
    // deriveNeumaDEK actually does what the comment claims, not just that
    // it's stable to itself.
    it('deriveNeumaDEK matches an independent HMAC-SHA256(master, genesisBytes || label) reference', () => {
      const dek = deriveNeumaDEK(masterA, G_A);
      const reference = crypto.createHmac('sha256', masterA)
        .update(Buffer.from(G_A, 'hex'))
        .update('neuma-data-key-v1')
        .digest();
      expect(dek.equals(reference)).toBe(true);
    });
  });
});
