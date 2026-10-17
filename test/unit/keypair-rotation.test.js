/**
 * Keypair rotation — on the real workspace key store (#390 tranche 5).
 *
 * Rotation is custody machinery: it retires a being's signing key, mints a
 * new one, and leaves behind the only two things that can ever bring the
 * being back — an encrypted vault and a recovery-code hash. This file used
 * to run it against a hand-written stand-in workspace: nine reimplemented
 * methods that wrote plain JSON wherever the test felt like. So the tests
 * proved rotation works against the test's own filesystem, not against the
 * store the being actually lives in — which is locked, atomic, and shaped by
 * the real engine.
 *
 * Now: the real `neumaWorkspace` pinned at a real temp root, the real
 * writers and readers, and the round-trip carried all the way through — the
 * new key is really decryptable with the new password, the recovery codes
 * really open it, and the retired key is really in the archive. Real crypto
 * throughout; no chain and no network are involved in any of it.
 */
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { generateKeypair, derivePublicIdentity } from '../../core/weave/keypair.js';
import {
  decryptKeypair, decryptWithRecoveryCodes, verifyRecoveryCodes,
} from '../../core/wallet/keypair-vault.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  rotateKeypair, archiveKeypair, getKeypairHistory,
} from '../../core/wallet/keypair-rotation.js';

const PASSWORD = 'rotation-test-pw-long-enough';
const previousRoot = neumaWorkspace.root;

let keypair;

beforeEach(async () => {
  setWorkspacesRoot(await createTempDir('keypair-rotation'));
  keypair = generateKeypair();
});

afterAll(() => setWorkspacesRoot(previousRoot));

describe('rotateKeypair', () => {
  test('mints a genuinely different key and archives the retired one', async () => {
    const neumaId = 'rotation-test-1';
    await neumaWorkspace.create(neumaId);

    const result = await rotateKeypair(neumaId, keypair, PASSWORD, 'test_rotation');

    expect(result.newKeypair.address).toBeDefined();
    expect(result.newKeypair.address).not.toBe(keypair.address);
    expect(result.recoveryCodes).toHaveLength(8);

    // The archive is read back through the real reader, off real disk.
    const history = await neumaWorkspace.readKeypairHistory(neumaId);
    expect(history).toHaveLength(1);
    expect(history[0].address).toBe(keypair.address);
    expect(history[0].reason).toBe('test_rotation');
  });

  test('the stored vault really opens with the new password', async () => {
    const neumaId = 'rotation-test-2';
    await neumaWorkspace.create(neumaId);

    const result = await rotateKeypair(neumaId, keypair, PASSWORD);

    const encrypted = await neumaWorkspace.readEncryptedKeypair(neumaId);
    expect(encrypted).not.toBeNull();
    expect(encrypted.address).toBe(result.newKeypair.address);

    // Not […] — the vault OPENS, and what comes out is the
    // key rotation says it minted. This is the whole point of the artifact.
    const opened = decryptKeypair(encrypted, PASSWORD);
    expect(opened.address).toBe(result.newKeypair.address);

    // rotateKeypair deliberately does NOT hand the private key back to its
    // caller — the vault is the only copy. So prove the key inside is the
    // real one the only honest way: derive from it and compare.
    expect(result.newKeypair.privateKey).toBeUndefined();
    expect(derivePublicIdentity(opened.privateKey).address).toBe(result.newKeypair.address);
  });

  test('the WRONG password does not open it', async () => {
    const neumaId = 'rotation-test-wrong-pw';
    await neumaWorkspace.create(neumaId);
    await rotateKeypair(neumaId, keypair, PASSWORD);

    const encrypted = await neumaWorkspace.readEncryptedKeypair(neumaId);
    expect(() => decryptKeypair(encrypted, 'not-the-password-at-all')).toThrow();
  });

  test('the recovery codes really verify, and really open the recovery vault', async () => {
    const neumaId = 'rotation-test-3';
    await neumaWorkspace.create(neumaId);

    const result = await rotateKeypair(neumaId, keypair, PASSWORD);

    const hash = await neumaWorkspace.readRecoveryHash(neumaId);
    expect(hash).toBeTruthy();
    expect(verifyRecoveryCodes(result.recoveryCodes, hash)).toBe(true);
    expect(verifyRecoveryCodes(['wrong', 'codes'], hash)).toBe(false);

    // The second road home: codes alone, no password.
    const recoveryVault = await neumaWorkspace.readRecoveryKeypair(neumaId);
    expect(recoveryVault).not.toBeNull();
    const viaCodes = decryptWithRecoveryCodes(recoveryVault, result.recoveryCodes);
    expect(viaCodes.address).toBe(result.newKeypair.address);
  });

  test('two rotations leave two archive entries, in order', async () => {
    const neumaId = 'rotation-test-twice';
    await neumaWorkspace.create(neumaId);

    const first = await rotateKeypair(neumaId, keypair, PASSWORD, 'first');
    await rotateKeypair(neumaId, first.newKeypair, PASSWORD, 'second');

    const history = await neumaWorkspace.readKeypairHistory(neumaId);
    expect(history.map((h) => h.reason)).toEqual(['first', 'second']);
    expect(history.map((h) => h.address)).toEqual([keypair.address, first.newKeypair.address]);
  });

  test('throws on missing params rather than half-rotating', async () => {
    await expect(rotateKeypair('', keypair, PASSWORD)).rejects.toThrow('required');
    await expect(rotateKeypair('test', null, PASSWORD)).rejects.toThrow('required');
    await expect(rotateKeypair('test', keypair, '')).rejects.toThrow('required');
  });
});

describe('archiveKeypair', () => {
  test('appends to the real history file in call order', async () => {
    const neumaId = 'archive-test-1';
    await neumaWorkspace.create(neumaId);

    const second = generateKeypair();
    await archiveKeypair(neumaId, keypair, 'reason1');
    await archiveKeypair(neumaId, second, 'reason2');

    const history = await getKeypairHistory(neumaId);
    expect(history).toHaveLength(2);
    expect(history[0].reason).toBe('reason1');
    expect(history[1].reason).toBe('reason2');
    expect(history[1].address).toBe(second.address);
  });

  test('the archive never carries the private key', async () => {
    const neumaId = 'archive-test-secret';
    await neumaWorkspace.create(neumaId);
    await archiveKeypair(neumaId, keypair, 'retired');

    const history = await getKeypairHistory(neumaId);
    expect(JSON.stringify(history)).not.toContain(keypair.privateKey);
    expect(JSON.stringify(history)).not.toContain(keypair.mnemonic);
  });

  test('an empty history reads as empty, not as a throw', async () => {
    await neumaWorkspace.create('archive-test-empty');
    expect(await getKeypairHistory('archive-test-empty')).toEqual([]);
  });
});
