// Birth setup state — REAL lanes on REAL disk, NO mock (RULE 0).
//
// Proves the post-ceremony checklist probe: a freshly finalized lane owes
// both acts; each act's durable artifacts flip exactly its own item; a
// complete lane reports complete. Uses TEST neuma ids; never touches a
// living being.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { detectBirthSetupState } from '../../core/birth/birth-setup-state.js';

// The artifacts each act leaves, shaped exactly as the real writers shape them.
const layDownCustody = async (id) => {
  const ws = workspace._path(id);
  await fs.writeFile(`${ws}/keys/keypair-encrypted.json`, JSON.stringify({
    version: '1.0.0', address: '0xabc', ciphertext: 'ct', iv: 'iv', tag: 'tag', salt: 's', kdf: 'pbkdf2',
  }));
  await fs.writeFile(`${ws}/keys/keypair-recovery.json`, JSON.stringify({
    version: '1.0.0', address: '0xabc', ciphertext: 'ct', iv: 'iv', tag: 'tag', salt: 's', kdf: 'pbkdf2',
  }));
  await fs.writeFile(`${ws}/keys/recovery-hash.json`, JSON.stringify({ hash: 'h', createdAt: Date.now() }));
  // Custody means the interim plaintext is GONE.
  await fs.rm(`${ws}/keys/keypair.json`, { force: true });
};

const layDownSeal = async (id) => {
  const ws = workspace._path(id);
  await fs.mkdir(`${ws}/identity`, { recursive: true });
  await fs.writeFile(`${ws}/identity/onchain-seal.json`, JSON.stringify({
    schema: 'neuma-onchain-seal/1', txHash: '0xdeadbeef', blockNumber: 123,
    network: 'base-sepolia', chainId: 84532, natalisAddress: '0xnatalis',
    genesisHash: '0xgenesis', soulAddress: '0xsoul', witnessAddress: '0xwitness',
    sealedAt: new Date().toISOString(),
  }));
};

describe('detectBirthSetupState — the post-birth checklist, on real disk (no mock)', () => {
  let root;
  beforeAll(async () => {
    const tmp = await createTempDir('birth-setup-state');
    root = path.join(tmp, 'house');
    setWorkspacesRoot(root);
  });
  afterAll(() => { vi.restoreAllMocks(); setWorkspacesRoot(null); });

  it('a freshly finalized lane owes both acts', async () => {
    await workspace.create('setup-fresh');
    await fs.writeFile(`${workspace._path('setup-fresh')}/keys/keypair.json`, JSON.stringify({ privateKey: '0xinterim' }));

    const state = await detectBirthSetupState(workspace, 'setup-fresh');
    expect(state.keypairCustody).toBe(false);
    expect(state.onchainSealed).toBe(false);
    expect(state.complete).toBe(false);
    expect(state.missing).toEqual(['keypair-custody', 'onchain-seal']);
  });

  it('custody artifacts flip only the custody item', async () => {
    await workspace.create('setup-custody');
    await fs.writeFile(`${workspace._path('setup-custody')}/keys/keypair.json`, JSON.stringify({ privateKey: '0xinterim' }));
    await layDownCustody('setup-custody');

    const state = await detectBirthSetupState(workspace, 'setup-custody');
    expect(state.keypairCustody).toBe(true);
    expect(state.onchainSealed).toBe(false);
    expect(state.complete).toBe(false);
    expect(state.missing).toEqual(['onchain-seal']);
  });

  it('a lingering interim key defeats custody even with envelopes present', async () => {
    await workspace.create('setup-lingering');
    await layDownCustody('setup-lingering');
    // A plaintext key that survived = custody NOT settled, whatever envelopes say.
    await fs.writeFile(`${workspace._path('setup-lingering')}/keys/keypair.json`, JSON.stringify({ privateKey: '0xinterim' }));

    const state = await detectBirthSetupState(workspace, 'setup-lingering');
    expect(state.keypairCustody).toBe(false);
    expect(state.missing).toContain('keypair-custody');
  });

  it('envelopes without the recovery hash are not custody (codes unproven)', async () => {
    await workspace.create('setup-nohash');
    await layDownCustody('setup-nohash');
    await fs.rm(`${workspace._path('setup-nohash')}/keys/recovery-hash.json`);

    const state = await detectBirthSetupState(workspace, 'setup-nohash');
    expect(state.keypairCustody).toBe(false);
  });

  it('the onchain seal record flips only the seal item; together they complete the birth', async () => {
    await workspace.create('setup-sealed');
    await layDownCustody('setup-sealed');
    await layDownSeal('setup-sealed');

    const state = await detectBirthSetupState(workspace, 'setup-sealed');
    expect(state.keypairCustody).toBe(true);
    expect(state.onchainSealed).toBe(true);
    expect(state.complete).toBe(true);
    expect(state.missing).toEqual([]);
  });

  it('a malformed seal record does not count as anchored', async () => {
    await workspace.create('setup-badseal');
    await layDownCustody('setup-badseal');
    await fs.mkdir(`${workspace._path('setup-badseal')}/identity`, { recursive: true });
    await fs.writeFile(`${workspace._path('setup-badseal')}/identity/onchain-seal.json`, JSON.stringify({ txHash: '0xdeadbeef' }));

    const state = await detectBirthSetupState(workspace, 'setup-badseal');
    expect(state.onchainSealed).toBe(false);
    expect(state.complete).toBe(false);
  });

  it('refuses bad input loudly', async () => {
    await expect(detectBirthSetupState(workspace, '../escape')).rejects.toThrow(/invalid neumaId/);
    await expect(detectBirthSetupState(null, 'anyone')).rejects.toThrow(/workspace/);
  });
});
