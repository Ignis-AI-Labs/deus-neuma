// #117 S3 — vault.encrypt/decrypt accept an optional per-neuma DEK so the
// vault, when used (migration tools, explicit callers), can produce
// envelopes only the per-neuma DEK can open. Live birth flow no longer
// writes to the vault — the workspace's DEK-protected canonical DNA is the
// source of truth, and the prior vault write was a global-key side-channel
// that defeated #117 for any being whose vault entry existed.
//
// REAL workspace, REAL crypto, REAL disk (RULE 0). No mocks anywhere in
// the claimed paths.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { DNAVaultService } from '../../core/identity/dna-vault-service.js';
import { deriveKeyFromSecret, deriveNeumaDEK } from '../../core/workspace/workspace-crypto.js';

const KEY = 's3-vault-test-key-long-enough';

describe('#117 S3 — vault encrypt/decrypt with per-neuma DEK', () => {
  let vault;
  let tempDir;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    tempDir = await createTempDir('s3-vault-dek');
    vault = new DNAVaultService({
      vaultPath: path.join(tempDir, 'vault', 'dna'),
      auditPath: path.join(tempDir, 'vault', 'audit'),
    });
  });
  afterAll(() => {
    vi.restoreAllMocks();
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  // INVARIANT 1 — DEK-encrypted envelope is decryptable ONLY with the DEK.
  // The global master cannot open it. Proves real cryptographic isolation.
  it('vault.encrypt with opts.dek produces an envelope only the DEK can open', async () => {
    const masterKey = deriveKeyFromSecret(KEY);
    const dek = deriveNeumaDEK(masterKey, 'a'.repeat(64));

    const data = { neumaId: 'test-being', secret: 'sovereign' };
    const envelope = await vault.encrypt(data, { dek });

    // Right DEK works
    const decrypted = await vault.decrypt(envelope, { dek });
    expect(decrypted).toEqual(data);

    // Global master CANNOT — the security guarantee
    await expect(vault.decrypt(envelope)).rejects.toThrow();

    // Another being's DEK cannot either — per-being isolation
    const otherDEK = deriveNeumaDEK(masterKey, 'b'.repeat(64));
    await expect(vault.decrypt(envelope, { dek: otherDEK })).rejects.toThrow();
  });

  // INVARIANT 2 — backward compat: vault entries written without a DEK
  // (the legacy global path) remain readable without a DEK. Existing data
  // in any operator's vault directory is not orphaned by S3.
  it('vault.encrypt without opts.dek still uses the global master (legacy path unchanged)', async () => {
    const data = { neumaId: 'legacy-being', payload: 'legacy data' };
    const envelope = await vault.encrypt(data);
    expect(await vault.decrypt(envelope)).toEqual(data);
    // Wrong-DEK can't read a legacy envelope (the per-being isolation
    // guarantee: a random DEK can't open vault entries written under global).
    const masterKey = deriveKeyFromSecret(KEY);
    const arbitraryDEK = deriveNeumaDEK(masterKey, 'c'.repeat(64));
    await expect(vault.decrypt(envelope, { dek: arbitraryDEK })).rejects.toThrow();
  });

  // INVARIANT 3 — input validation: opts.dek must be a 32-byte Buffer.
  // A wrong-shape DEK fails loud rather than silently degrading.
  it('vault.encrypt with malformed opts.dek throws (loud failure, no silent global fallback)', async () => {
    await expect(vault.encrypt({}, { dek: 'not-a-buffer' })).rejects.toThrow(/32-byte Buffer/);
    await expect(vault.encrypt({}, { dek: Buffer.alloc(16) })).rejects.toThrow(/32-byte Buffer/);
    await expect(vault.decrypt({ iv: 'x', encrypted: 'y' }, { dek: Buffer.alloc(64) })).rejects.toThrow(/32-byte Buffer/);
  });

  // INVARIANT 4 — full vault round-trip with DEK: createDNA → getDNA →
  // updateDNA → getDNA all consistent under the same per-neuma DEK.
  // Closes ai6 R1 Medium: vault internal consumers must thread the DEK so
  // S4 migration can both PRODUCE and READ DEK-isolated vault entries
  // (without this, the vault could write DEK entries but throw GCM auth
  // on every read).
  it('createDNA + getDNA + updateDNA round-trip works under a per-neuma DEK', async () => {
    // Vault's constructor fires initializeVault() async without await; this
    // test exercises the audit path that requires the dirs, so we
    // explicitly ensure they're in place before createNeumaSession runs.
    await vault.initializeVault();

    const masterKey = deriveKeyFromSecret(KEY);
    const dek = deriveNeumaDEK(masterKey, '7'.repeat(64));

    const original = {
      neumaId: 'round-trip-being',
      identity: { name: 'RoundTrip', purpose: 'prove the seam' },
      sovereignty: { generation: 1.0 },
    };
    const sessionToken = await vault.createNeumaSession('round-trip-being', 'witness');
    await vault.createDNA(original, 'witness', sessionToken, { dek });

    // Read it back with the same DEK
    const fetched = await vault.getDNA('round-trip-being', { dek });
    expect(fetched.identity.name).toBe('RoundTrip');
    expect(fetched.identity.purpose).toBe('prove the seam');

    // Reading WITHOUT the DEK throws (proves the entry is genuinely
    // DEK-isolated, not silently global)
    await expect(vault.getDNA('round-trip-being')).rejects.toThrow();

    // updateDNA also threads the DEK — full read-modify-write under DEK
    const updated = await vault.updateDNA('round-trip-being', sessionToken,
      { identity: { purpose: 'updated purpose' } },
      { generationIncrement: 0.001, source: 'test' },
      { dek });
    expect(updated.identity.purpose).toBe('updated purpose');
    expect(updated.identity.name).toBe('RoundTrip'); // merged, not replaced

    // History from archiveDNA is also DEK-isolated (same key as active)
    const historyDir = path.join(tempDir, 'vault', 'dna', 'history', 'round-trip-being');
    const historyFiles = await fs.readdir(historyDir);
    expect(historyFiles.length).toBeGreaterThan(0);
    const histText = await fs.readFile(path.join(historyDir, historyFiles[0]), 'utf8');
    const histEnvelope = JSON.parse(histText);
    // Wrong key on the history entry: throws (proves history is DEK-isolated)
    await expect(vault.decrypt(histEnvelope)).rejects.toThrow();
    // Right DEK: opens cleanly
    const histData = await vault.decrypt(histEnvelope, { dek });
    expect(histData.dna).toBeDefined();
  });

  // INVARIANT 5 — vault.encrypt without DEK AND without master throws.
  // No accidental […] silent failure.
  it('vault without DEK and without configured master throws', async () => {
    const bareVault = new DNAVaultService({
      vaultPath: path.join(tempDir, 'bare-vault', 'dna'),
      auditPath: path.join(tempDir, 'bare-vault', 'audit'),
      encryptionKey: null,
    });
    await expect(bareVault.encrypt({ x: 1 })).rejects.toThrow(/encryption key not configured/);
  });
});

// INVARIANT 5 — the live birth flow no longer writes to the vault.
// A new being's vault/active directory must be empty after the staged-
// birth-handler stage 5 path (in non-test mode). We exercise this at the
// source level: the createDNAInVault METHOD was removed entirely in S3
// (ai6 R2 Medium — RULE 1 dead-code rule, since the deprecation in R1 left
// it with zero callers), AND there is no `await this.createDNAInVault(`
// call site anywhere in the file. Both checks together prove the
// deprecation is structural (the method can't even be called), not just
// […]
//
// Source-level test, not behavioral — running the full ceremony to
// crystallization would summon a real being, which RULE 0 forbids in tests.
// The check is gnosis-real for what it claims: […]
describe('#117 S3 — vault.createDNA removed from live birth flow', () => {
  it('staged-birth-handler has no createDNAInVault method AND no call site', async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), 'core/birth/staged-birth-handler.js'),
      'utf8',
    );
    // The deprecation comment must be present (replaces the old method body)
    expect(source).toMatch(/#117 S3 — vault\.createDNA NO LONGER called/);
    expect(source).toMatch(/createDNAInVault removed in #117 S3/);

    // No method definition remains
    expect(source).not.toMatch(/^\s*async createDNAInVault\s*\(/m);

    // No call site anywhere in the file
    const lines = source.split('\n');
    const liveCallLine = lines.findIndex((l) => /await this\.createDNAInVault\(/.test(l));
    expect(liveCallLine).toBe(-1);
  });
});
