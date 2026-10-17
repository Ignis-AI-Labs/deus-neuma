/**
 * Seal loaders vs mixed envelope generations — REAL crypto on REAL disk
 * (RULE 0). A workspace is not uniformly wrapped: finalize-birth writes
 * keypair.json under the global chain BEFORE the per-neuma DEK is minted,
 * so a DEK-bearing workspace holds both generations. Witnessed at Tenekom's
 * seal (2026-07-19): […] at
 * PREPARING THE SEAL. The loaders must read both, and still fail honestly
 * on a genuinely foreign key.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
import { randomBytes } from 'crypto';
import path from 'path';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  encryptEnvelope, wrapDEK, deriveNeumaDEK, deriveKeyFromSecret, resetWorkspaceCryptoKey,
} from '../../core/workspace/workspace-crypto.js';
import { loadNeumaDEK, loadBeingWallet, loadBirthGenesis } from '../../backend/services/natalis-seal.js';

const BEING = new ethers.Wallet('0x' + '33'.repeat(32));
const GENESIS = 'ab'.repeat(32);

describe('seal loaders read both envelope generations', () => {
  let ws, dek, savedKey;

  beforeEach(async () => {
    savedKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    resetWorkspaceCryptoKey();
    ws = await createTempDir('seal-envelopes');
    await mkdir(path.join(ws, 'keys'), { recursive: true });
    await mkdir(path.join(ws, 'identity'), { recursive: true });

    const masterKey = deriveKeyFromSecret(process.env.DNA_ENCRYPTION_KEY);
    dek = deriveNeumaDEK(masterKey, GENESIS);
    await writeFile(path.join(ws, 'keys', 'dek.json'), JSON.stringify(wrapDEK(dek, masterKey)));

    // The birth-order truth: keypair.json wrapped under the GLOBAL chain
    // (written before the DEK existed) …
    await writeFile(
      path.join(ws, 'keys', 'keypair.json'),
      JSON.stringify(encryptEnvelope({ privateKey: BEING.privateKey, address: BEING.address })),
    );
    // … while identity/genesis-seal.json carries the per-neuma DEK.
    await writeFile(
      path.join(ws, 'identity', 'genesis-seal.json'),
      JSON.stringify(encryptEnvelope({ genesisHash: GENESIS, record: { chosenName: 'Testa' } }, { key: dek })),
    );
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = savedKey;
    resetWorkspaceCryptoKey();
  });

  test('the DEK unwraps, and BOTH generations decrypt through the loaders', () => {
    const loaded = loadNeumaDEK(ws);
    expect(loaded.equals(dek)).toBe(true);

    // The Tenekom failure: this call died on the global-wrapped keypair.
    const wallet = loadBeingWallet(ws, loaded);
    expect(wallet.address).toBe(BEING.address);

    // DEK-wrapped files keep working through the same tolerant path.
    const gs = loadBirthGenesis(ws, loaded);
    expect(gs.genesisHash).toBe(GENESIS);
  });

  test('a genuinely foreign key still fails honestly — tolerance is not fail-open', async () => {
    const foreign = randomBytes(32);
    await writeFile(
      path.join(ws, 'keys', 'keypair.json'),
      JSON.stringify(encryptEnvelope({ privateKey: BEING.privateKey }, { key: foreign })),
    );
    expect(() => loadBeingWallet(ws, loadNeumaDEK(ws))).toThrow();
  });
});
