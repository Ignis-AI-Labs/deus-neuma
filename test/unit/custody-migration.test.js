import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import { rmSync } from 'fs';
import { createTempDir } from '../helpers/temp-fs.js';

const PASS = 'correct horse battery staple';

// Real workspace at a temp root — no mocks. Proves the sealed artifacts land in the
// exact files the recovery/auth/rotation routes already read, so a migrated neuma is
// fully compatible with the live custody infrastructure.
describe('sealExistingNeuma — retroactive sovereign custody (real workspace)', () => {
  let workspace, sealExistingNeuma, tmpRoot, neumaId, kp;

  beforeEach(async () => {
    tmpRoot = await createTempDir('custody-migration');
    process.env.WORKSPACES_ROOT = tmpRoot;
    process.env.DNA_ENCRYPTION_KEY = 'test-dna-key-for-custody-migration-spec';
    vi.resetModules();
    ({ default: workspace } = await import('../../core/workspace/neuma-workspace.js'));
    const { resetWorkspaceCryptoKey } = await import('../../core/workspace/workspace-crypto.js');
    resetWorkspaceCryptoKey(); // bind at-rest encryption to our test DNA_ENCRYPTION_KEY
    ({ sealExistingNeuma } = await import('../../core/wallet/custody-migration.js'));

    neumaId = 'custody-test-neuma';
    await workspace.create(neumaId);
    const w = ethers.Wallet.createRandom();
    kp = { privateKey: w.privateKey, publicKey: w.publicKey, address: w.address };
    // The interim state every portal-born neuma starts in: at-rest (platform-key)
    // encrypted, NOT sovereign.
    await workspace.writeKeypair(neumaId, kp);
  });

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
    delete process.env.WORKSPACES_ROOT;
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('seals the interim keypair: both envelopes written, plaintext removed, isSealed true', async () => {
    expect((await workspace.readKeypair(neumaId)).privateKey).toBe(kp.privateKey);

    const result = await sealExistingNeuma({
      workspace, neumaId, passphrase: PASS, now: () => '2026-06-22T00:00:00.000Z',
    });

    expect(result.status).toBe('sealed');
    expect(result.address).toBe(kp.address);
    expect(result.sealedAt).toBe('2026-06-22T00:00:00.000Z');
    expect(result.recoveryCodes).toHaveLength(8);

    expect(await workspace.readKeypair(neumaId)).toBeNull(); // interim key gone
    expect(await workspace.readEncryptedKeypair(neumaId)).toBeTruthy();
    expect(await workspace.readRecoveryKeypair(neumaId)).toBeTruthy();
    expect(await workspace.readRecoveryHash(neumaId)).toBeTruthy();

    const { isSealed } = await import('../../core/wallet/keypair-custody.js');
    expect(isSealed(
      await workspace.readKeypair(neumaId),
      await workspace.readEncryptedKeypair(neumaId),
      await workspace.readRecoveryKeypair(neumaId),
    )).toBe(true);
  });

  it('the sealed envelopes decrypt with passphrase AND recovery codes via the vault primitives', async () => {
    const { recoveryCodes } = await sealExistingNeuma({ workspace, neumaId, passphrase: PASS });
    const { decryptKeypair, decryptWithRecoveryCodes, verifyRecoveryCodes } =
      await import('../../core/wallet/keypair-vault.js');

    // exactly how recovery-routes / neuma-auth read it
    const enc = await workspace.readEncryptedKeypair(neumaId);
    expect(decryptKeypair(enc, PASS).privateKey).toBe(kp.privateKey);

    const rec = await workspace.readRecoveryKeypair(neumaId);
    expect(decryptWithRecoveryCodes(rec, recoveryCodes).privateKey).toBe(kp.privateKey);

    const hash = await workspace.readRecoveryHash(neumaId);
    expect(verifyRecoveryCodes(recoveryCodes, hash)).toBe(true);
  });

  it('records a high-significance CUSTODY_SEALED journal entry (attribution)', async () => {
    await sealExistingNeuma({
      workspace, neumaId, passphrase: PASS, now: () => '2026-06-22T00:00:00.000Z',
    });
    const sealed = (await workspace.readJournal(neumaId)).find((e) => e.type === 'CUSTODY_SEALED');
    expect(sealed).toBeTruthy();
    expect(sealed.significance).toBe('high');
    expect(sealed.timestamp).toBe('2026-06-22T00:00:00.000Z');
  });

  it('is idempotent — re-running on a sealed neuma is a no-op (no fresh codes)', async () => {
    await sealExistingNeuma({ workspace, neumaId, passphrase: PASS });
    const second = await sealExistingNeuma({ workspace, neumaId, passphrase: PASS });
    expect(second.status).toBe('already-sealed');
    expect(second.address).toBe(kp.address);
    expect(second.recoveryCodes).toBeUndefined();
  });

  it('rejects a too-short passphrase before writing anything (interim key intact)', async () => {
    await expect(sealExistingNeuma({ workspace, neumaId, passphrase: 'short' }))
      .rejects.toThrow(/at least/);
    expect((await workspace.readKeypair(neumaId)).privateKey).toBe(kp.privateKey);
    expect(await workspace.readEncryptedKeypair(neumaId)).toBeNull();
  });

  it('throws when there is no keypair to seal', async () => {
    await expect(sealExistingNeuma({ workspace, neumaId: 'no-such-neuma', passphrase: PASS }))
      .rejects.toThrow(/No keypair to seal/);
  });

  it('--force re-seals an already-sovereign neuma: same key, fresh codes, old codes invalidated', async () => {
    const first = await sealExistingNeuma({ workspace, neumaId, passphrase: PASS });
    expect(await workspace.readKeypair(neumaId)).toBeNull(); // fully sealed — no interim key

    const second = await sealExistingNeuma({ workspace, neumaId, passphrase: PASS, force: true });
    expect(second.status).toBe('sealed');
    expect(second.address).toBe(kp.address); // same underlying key
    expect(second.recoveryCodes).toHaveLength(8);
    expect(second.recoveryCodes).not.toEqual(first.recoveryCodes); // fresh codes

    const { decryptKeypair, verifyRecoveryCodes } = await import('../../core/wallet/keypair-vault.js');
    const newHash = await workspace.readRecoveryHash(neumaId);
    expect(verifyRecoveryCodes(second.recoveryCodes, newHash)).toBe(true);  // new codes work
    expect(verifyRecoveryCodes(first.recoveryCodes, newHash)).toBe(false);  // old codes invalidated
    // still wakes with the same passphrase to the same key
    expect(decryptKeypair(await workspace.readEncryptedKeypair(neumaId), PASS).privateKey).toBe(kp.privateKey);
  });

  it('--force cannot re-seal a sovereign neuma without the current passphrase', async () => {
    await sealExistingNeuma({ workspace, neumaId, passphrase: PASS });
    await expect(sealExistingNeuma({ workspace, neumaId, passphrase: 'the wrong passphrase entirely', force: true }))
      .rejects.toThrow(/decryption failed|wrong password/i); // wakeWithPassphrase rejects → cannot rotate codes
  });
});
