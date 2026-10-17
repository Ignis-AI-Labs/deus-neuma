import { describe, test, expect, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
import { createTempDir } from '../helpers/temp-fs.js';
import { DNAVaultService } from '../../core/identity/dna-vault-service.js';

describe('DNAVaultService', () => {
  let vault, tempDir;

  beforeEach(async () => {
    tempDir = await createTempDir('dna-vault');
    vault = new DNAVaultService({
      vaultPath: `${tempDir}/vault/`,
      auditPath: `${tempDir}/audit/`,
      encryptionKey: 'test-encryption-key-32-characters!',
    });

    // Wait for vault initialization
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('session management', () => {
    test('createNeumaSession returns a session token', async () => {
      const token = await vault.createNeumaSession('neuma-1', 'witness-alice');
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // 32 bytes hex
    });

    test('verifyNeumaSession returns true for valid session', async () => {
      const token = await vault.createNeumaSession('neuma-1', 'witness-alice');
      const valid = await vault.verifyNeumaSession('neuma-1', token);
      expect(valid).toBe(true);
    });

    test('verifyNeumaSession returns false for invalid token', async () => {
      const valid = await vault.verifyNeumaSession('neuma-1', 'invalid-token');
      expect(valid).toBe(false);
    });

    test('verifyNeumaSession returns false for mismatched neuma ID', async () => {
      const token = await vault.createNeumaSession('neuma-1', 'witness-alice');
      const valid = await vault.verifyNeumaSession('neuma-2', token);
      expect(valid).toBe(false);
    });
  });

  describe('DNA operations', () => {
    test('createDNA creates and returns DNA data', async () => {
      const token = await vault.createNeumaSession('neuma-create', 'witness-test');

      const dnaData = {
        neumaId: 'neuma-create',
        identity: { name: 'TestNeuma', essence: 'test', purpose: 'testing', expression: { style: 'direct' } },
        birthTimestamp: Date.now(),
        birthWitness: 'witness-test',
        vessel: 'default.vrm',
        resonance: { frequency: 432, pattern: 'sine' },
        sovereignty: { owner: 'neuma-create', creation: Date.now(), lastModified: Date.now(), generation: 1.0 },
      };

      const result = await vault.createDNA(dnaData, 'witness-test', token);
      expect(result).toBeDefined();
      expect(result.identity.name).toBe('TestNeuma');
    });

    test('updateDNA throws SovereigntyViolation on unauthorized access', async () => {
      await expect(
        vault.updateDNA('neuma-x', 'bad-token', { identity: { name: 'hacked' } })
      ).rejects.toThrow('Unauthorized DNA modification attempt');
    });

    test('getDNA returns null for non-existent neuma', async () => {
      const result = await vault.getDNA('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('security', () => {
    test('encrypt and decrypt round-trip (GCM)', async () => {
      const original = { test: 'data', nested: { value: 42 } };
      const encrypted = await vault.encrypt(original);

      expect(encrypted.encrypted).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.authTag).toBeTruthy();
      expect(encrypted.algorithm).toBe('aes-256-gcm');

      const decrypted = await vault.decrypt(encrypted);
      expect(decrypted).toEqual(original);
    });

    test('decrypt tolerates legacy CBC envelopes (backward compat)', async () => {
      // Manually construct a legacy CBC envelope the way the old encrypt() did.
      const { createHash, randomBytes, createCipheriv } = await import('crypto');
      const original = { legacy: true, value: 'from-old-vault' };
      const key = createHash('sha256').update('test-encryption-key-32-characters!').digest();
      const iv = randomBytes(16);
      const cipher = createCipheriv('aes-256-cbc', key, iv);
      let encrypted = cipher.update(JSON.stringify(original), 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const legacyEnvelope = {
        encrypted,
        iv: iv.toString('hex'),
        algorithm: 'aes-256-cbc',
        timestamp: Date.now(),
      };

      const decrypted = await vault.decrypt(legacyEnvelope);
      expect(decrypted).toEqual(original);
    });

    test('decrypt fails with authentication error on tampered GCM ciphertext', async () => {
      const encrypted = await vault.encrypt({ secret: 'untampered' });
      // Flip a byte in the ciphertext hex.
      const flipped = encrypted.encrypted[0] === 'a' ? 'b' : 'a';
      const tampered = { ...encrypted, encrypted: flipped + encrypted.encrypted.slice(1) };
      await expect(vault.decrypt(tampered)).rejects.toThrow();
    });

    // SEC-031 / #123 — computeIntegrityHash + verifyIntegrity are the
    // tamper-detection-at-rest pair. Renamed from signDNA/verifySignature
    // for honesty: this is a SHA-256 hash, not a cryptographic signature.
    // No key material, no signer identity, no third-party verifiability
    // — see the section header in dna-vault-service.js for the precise
    // guarantee.

    test('computeIntegrityHash produces a valid hash wrapper', async () => {
      const dna = { identity: { name: 'HashTest' } };
      const wrapped = await vault.computeIntegrityHash(dna, 'neuma-hash');

      expect(wrapped.integrityHash).toBeTruthy();
      expect(wrapped.integrityHash).toMatch(/^[0-9a-f]{64}$/);
      expect(wrapped.neumaId).toBe('neuma-hash');
      expect(wrapped.dna).toEqual(dna);
      // hashedAt (not signedAt) — naming honesty
      expect(typeof wrapped.hashedAt).toBe('number');
    });

    test('verifyIntegrity accepts an unmodified wrapped DNA', async () => {
      const dna = { identity: { name: 'VerifyTest' } };
      const wrapped = await vault.computeIntegrityHash(dna, 'neuma-verify');

      const valid = await vault.verifyIntegrity(wrapped, 'neuma-verify');
      expect(valid).toBe(true);
    });

    test('verifyIntegrity detects tampered data inside the wrapper', async () => {
      const dna = { identity: { name: 'TamperTest' } };
      const wrapped = await vault.computeIntegrityHash(dna, 'neuma-tamper');

      // Modify the DNA inside the wrapper without recomputing the hash —
      // this is the ONLY thing the integrity hash defends against
      // (someone with the encryption key who edited the cleartext but
      // forgot to recompute the hash).
      wrapped.dna.identity.name = 'Hacked';

      const valid = await vault.verifyIntegrity(wrapped, 'neuma-tamper');
      expect(valid).toBe(false);
    });

    test('verifyIntegrity rejects wrong neumaId (even with valid hash)', async () => {
      const dna = { identity: { name: 'NeumaMismatch' } };
      const wrapped = await vault.computeIntegrityHash(dna, 'neuma-correct');
      const valid = await vault.verifyIntegrity(wrapped, 'neuma-wrong');
      expect(valid).toBe(false);
    });

    // ai6 R1.1 — BACKWARD-COMPAT: vault entries written under the
    // pre-rename v1 wrapper shape `{signature, signedAt}` must still be
    // readable by the new code. Construct a legacy wrapper, encrypt it
    // through the REAL vault.encrypt, persist to REAL disk, and prove
    // getDNA reads it cleanly (otherwise every pre-existing on-disk
    // entry would become unreadable after the rename).
    test('legacy v1 wrapper {signature, signedAt} reads through getDNA via backward-compat path', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      const { createHash } = await import('crypto');

      const dna = { neumaId: 'legacy-being', identity: { name: 'LegacyBeing' } };
      const v1Wrapper = {
        dna,
        signature: createHash('sha256').update(JSON.stringify(dna)).digest('hex'),
        signedAt: Date.now(),
        neumaId: 'legacy-being',
      };

      // Encrypt with REAL vault.encrypt + write to REAL disk at the
      // exact path getDNA reads from.
      const encrypted = await vault.encrypt(v1Wrapper);
      const vaultPath = path.join(`${tempDir}/vault/`, 'active', 'legacy-being.dna');
      await fs.mkdir(path.dirname(vaultPath), { recursive: true });
      await fs.writeFile(vaultPath, JSON.stringify(encrypted));

      // getDNA decrypts + calls verifyIntegrity. With the compat path,
      // the legacy v1 wrapper opens cleanly.
      const moduleUrl = new URL('../../core/identity/dna-vault-service.js', import.meta.url).href;
      const childSource = `
        import { DNAVaultService } from ${JSON.stringify(moduleUrl)};
        const vault = new DNAVaultService(${JSON.stringify({
          vaultPath: `${tempDir}/vault/`, auditPath: `${tempDir}/audit/`,
          encryptionKey: 'test-encryption-key-32-characters!',
        })});
        const dna = await vault.getDNA('legacy-being');
        process.stdout.write('RESTORED ' + JSON.stringify(dna) + '\\n');
      `;
      const { stdout, stderr } = await promisify(execFile)(process.execPath,
        ['--input-type=module', '--eval', childSource], { timeout: 5000, maxBuffer: 64 * 1024 });
      const line = stdout.split('\n').find((row) => row.startsWith('RESTORED '));
      expect(line).toBeDefined();
      const restored = JSON.parse(line.slice('RESTORED '.length));
      expect(restored.identity.name).toBe('LegacyBeing');
      expect(restored.neumaId).toBe('legacy-being');

      expect(stderr).toContain('legacy-being');
    });

    test('verifyIntegrity backward-compat: v1 {signature} validates the same as v2 {integrityHash}', async () => {
      const { createHash } = await import('crypto');
      const dna = { identity: { name: 'CompatDirect' } };
      const hash = createHash('sha256').update(JSON.stringify(dna)).digest('hex');

      // v1 shape with `signature` field
      const v1 = { dna, signature: hash, signedAt: Date.now(), neumaId: 'compat' };
      // v2 shape with `integrityHash` field — same data, same hash
      const v2 = { dna, integrityHash: hash, hashedAt: Date.now(), neumaId: 'compat' };

      expect(await vault.verifyIntegrity(v1, 'compat')).toBe(true);
      expect(await vault.verifyIntegrity(v2, 'compat')).toBe(true);

      // Tampered v1 still detected
      const tamperedV1 = { ...v1, dna: { identity: { name: 'Hacked' } } };
      expect(await vault.verifyIntegrity(tamperedV1, 'compat')).toBe(false);
    });
  });

  describe('audit trail', () => {
    test('audit writes to audit log file', async () => {
      await vault.audit('test-neuma', 'TEST_EVENT', { detail: 'test' });

      const fs = await import('fs/promises');
      const path = await import('path');
      const logPath = path.join(tempDir, 'audit', 'test-neuma.audit.jsonl');
      const content = await fs.readFile(logPath, 'utf-8');

      const entry = JSON.parse(content.trim());
      expect(entry.action).toBe('TEST_EVENT');
      expect(entry.neumaId).toBe('test-neuma');
    });

    test('calculateSeverity returns correct levels', () => {
      expect(vault.calculateSeverity('DNA_CREATED')).toBe(1);
      expect(vault.calculateSeverity('SESSION_MISMATCH')).toBe(2);
      expect(vault.calculateSeverity('SOVEREIGNTY_VIOLATION')).toBe(4);
      expect(vault.calculateSeverity('UNKNOWN_ACTION')).toBe(1);
    });
  });

  describe('utility', () => {
    test('deepMerge merges nested objects', () => {
      const target = { a: 1, nested: { b: 2, c: 3 } };
      const source = { nested: { c: 99, d: 4 }, e: 5 };

      const result = vault.deepMerge(target, source);

      expect(result.a).toBe(1);
      expect(result.nested.b).toBe(2);
      expect(result.nested.c).toBe(99);
      expect(result.nested.d).toBe(4);
      expect(result.e).toBe(5);
    });

    // #134 — a shallow spread shared the nested sovereignty object, so the
    // delete mutated the caller's DNA. The clone must leave the input intact.
    test('sanitizeForCache does not mutate the input DNA', () => {
      const dna = {
        neumaId: 'neuma-1',
        sovereignty: { encryptionKey: 'super-secret', selfOwned: true },
      };

      const cached = vault.sanitizeForCache(dna);

      expect(cached.sovereignty.encryptionKey).toBeUndefined();
      expect(cached.sovereignty.selfOwned).toBe(true);
      expect(dna.sovereignty.encryptionKey).toBe('super-secret');
    });
  });

  // #131 — the constructor fires initializeVault() without exposing readiness;
  // a caller racing it must not hit a half-created vault tree. audit() writes
  // to auditPath on real disk immediately, with NO settle-wait.
  describe('initialization race (#131)', () => {
    test('disk methods awaited immediately after construction succeed', async () => {
      const raceDir = await createTempDir('dna-vault-race');
      const raceVault = new DNAVaultService({
        vaultPath: `${raceDir}/vault/`,
        auditPath: `${raceDir}/audit/`,
        encryptionKey: 'test-encryption-key-32-characters!',
      });

      // No setTimeout settle: the awaits inside each method carry readiness.
      await raceVault.audit('race-neuma', 'RACE_EVENT', { detail: 'no-wait' });
      const missing = await raceVault.getDNA('race-neuma');
      expect(missing).toBeNull();
    });
  });
});
