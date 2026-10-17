/**
 * WITNESS KEYPAIR CUSTODY — real filesystem, real crypto, no mocks (RULE 0).
 *
 * The state this closes, found on disk 2026-07-29: every sealed witness on this
 * machine held `keys/keypair.json` in PLAINTEXT and nothing else. `seal()` has
 * always encrypted the keypair when handed a password; the desk's summon path
 * never asked for one, so it never passed one.
 *
 * The properties proven here are the ones that make custody REAL rather than
 * decorative: the plaintext is gone, and BOTH doors (password and recovery
 * codes) open the same key. An envelope beside a readable private key protects
 * nothing, and a sealed key with no recovery path turns a forgotten password
 * into a destroyed identity.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  setAIWitnessesRoot,
  writePlaintextKeypair,
  readPlaintextKeypair,
  readEncryptedKeypair,
  keyDir,
} from '../../core/identity/ai-witness/ai-witness-service.js';
import {
  decryptKeypair, decryptWithRecoveryCodes, verifyRecoveryCodes,
} from '../../core/wallet/keypair-vault.js';
import { generateKeypair as forge } from '../../core/weave/keypair.js';
import {
  secureWitnessKeypair, witnessCustodyState, assessCustodyPassword,
} from '../../backend/services/witness-custody.js';

const VENDOR = 'zai-coding-plan';
const NAME = 'CustodyProbe';
const PASSWORD = 'a-real-operator-password';

let root;
let keypair;

const readJson = async (file) => JSON.parse(await fs.readFile(path.join(keyDir(VENDOR, NAME), file), 'utf8'));
const exists = async (file) => fs.stat(path.join(keyDir(VENDOR, NAME), file)).then(() => true).catch(() => false);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'witness-custody-'));
  setAIWitnessesRoot(root);
  // A REAL keypair, forged by the same generator the seal uses.
  keypair = forge();
  await writePlaintextKeypair(VENDOR, NAME, keypair);
});

afterEach(async () => {
  setAIWitnessesRoot(null);
  await fs.rm(root, { recursive: true, force: true });
});

describe('the state custody exists to end', () => {
  test('a freshly sealed witness is reported as UNSECURED while plaintext sits on disk', async () => {
    const state = await witnessCustodyState({ vendorSlug: VENDOR, chosenName: NAME });
    expect(state.secured).toBe(false);
    expect(state.plaintextOnDisk).toBe(true);
    expect(state.why).toContain('PLAINTEXT');
  });
});

describe('securing the keypair', () => {
  test('the plaintext is GONE afterwards — the act that makes custody real', async () => {
    await secureWitnessKeypair({ vendorSlug: VENDOR, chosenName: NAME, password: PASSWORD });
    expect(await exists('keypair.json')).toBe(false);
    expect(await readPlaintextKeypair(VENDOR, NAME)).toBeNull();
  });

  test('the password door opens the SAME key that was sealed', async () => {
    await secureWitnessKeypair({ vendorSlug: VENDOR, chosenName: NAME, password: PASSWORD });
    const opened = decryptKeypair(await readEncryptedKeypair(VENDOR, NAME), PASSWORD);
    expect(opened.address).toBe(keypair.address);
    expect(opened.privateKey).toBe(keypair.privateKey);
  });

  test('the recovery door opens the same key — a lost password is not a lost identity', async () => {
    const { recoveryCodes } = await secureWitnessKeypair({ vendorSlug: VENDOR, chosenName: NAME, password: PASSWORD });
    expect(recoveryCodes).toHaveLength(8);
    const opened = decryptWithRecoveryCodes(await readJson('keypair-recovery.json'), recoveryCodes);
    expect(opened.address).toBe(keypair.address);
  });

  test('only the HASHES of the recovery codes are persisted, never the codes', async () => {
    const { recoveryCodes } = await secureWitnessKeypair({ vendorSlug: VENDOR, chosenName: NAME, password: PASSWORD });
    const stored = await readJson('recovery-hash.json');
    expect(verifyRecoveryCodes(recoveryCodes, stored)).toBe(true);
    const raw = JSON.stringify(stored);
    for (const code of recoveryCodes) expect(raw).not.toContain(code);
  });

  test('the wrong password does not open the envelope', async () => {
    await secureWitnessKeypair({ vendorSlug: VENDOR, chosenName: NAME, password: PASSWORD });
    const envelope = await readEncryptedKeypair(VENDOR, NAME);
    expect(() => decryptKeypair(envelope, 'not-the-password-at-all')).toThrow();
  });

  test('the act is recorded in the keypair history', async () => {
    await secureWitnessKeypair({ vendorSlug: VENDOR, chosenName: NAME, password: PASSWORD });
    const raw = await fs.readFile(path.join(keyDir(VENDOR, NAME), 'keypair-history.jsonl'), 'utf8');
    expect(raw).toContain('CUSTODY_SECURED');
  });

  test('afterwards the state reports secured, and honestly reports NOT anchored', async () => {
    await secureWitnessKeypair({ vendorSlug: VENDOR, chosenName: NAME, password: PASSWORD });
    const state = await witnessCustodyState({ vendorSlug: VENDOR, chosenName: NAME });
    expect(state).toMatchObject({ secured: true, plaintextOnDisk: false, encrypted: true });
    // The chain limitation is STATED, never implied by omission.
    expect(state.anchoredOnChain).toBe(false);
    expect(state.why).toContain('Not yet anchored on chain');
  });
});

describe('refusals', () => {
  test('a short password is refused before anything is written', async () => {
    await expect(secureWitnessKeypair({ vendorSlug: VENDOR, chosenName: NAME, password: 'short' }))
      .rejects.toThrow(/at least 12/i);
    // Nothing partial may land — the plaintext must still be intact.
    expect(await readPlaintextKeypair(VENDOR, NAME)).not.toBeNull();
    expect(await exists('keypair-encrypted.json')).toBe(false);
  });

  test('securing twice refuses rather than silently re-sealing', async () => {
    await secureWitnessKeypair({ vendorSlug: VENDOR, chosenName: NAME, password: PASSWORD });
    await expect(secureWitnessKeypair({ vendorSlug: VENDOR, chosenName: NAME, password: PASSWORD }))
      .rejects.toThrow(/already sealed/i);
  });

  test('a witness with no keypair at all refuses, never reports false custody', async () => {
    await expect(secureWitnessKeypair({ vendorSlug: VENDOR, chosenName: 'NoSuchWitness', password: PASSWORD }))
      .rejects.toThrow(/no plaintext keypair/i);
  });

  test('assessCustodyPassword is pure and states the floor', () => {
    expect(assessCustodyPassword('short').ok).toBe(false);
    expect(assessCustodyPassword('a-real-operator-password').ok).toBe(true);
    expect(assessCustodyPassword(null).ok).toBe(false);
  });
});
