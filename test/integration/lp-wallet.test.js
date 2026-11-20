/**
 * The LP wallet store (backend/services/umbrae-lp/lp-wallet.js) over a REAL
 * workspace on disk (RULE 0): real files, the workspace's real encryption, and
 * a signature checked by recovering the address from it.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { lpWalletAddress, openLpWallet, lpSigner, readUmbraeKey, saveUmbraeKey } from '../../backend/services/umbrae-lp/lp-wallet.js';

const NEUMA_ID = 'lpwalletecho';
const OTHER_ID = 'lpwalletother';
const KEY = 'umbr_test_0123456789abcdef';
let root;
let originalRoot;
const keysFile = (id, name) => path.join(workspace._path(id), 'keys', name);

beforeAll(async () => {
  root = await createTempDir('lp-wallet');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  await workspace.create(NEUMA_ID);
  await workspace.create(OTHER_ID);
});
afterAll(async () => {
  setWorkspacesRoot(originalRoot);
  await fs.rm(root, { recursive: true, force: true });
});

describe('the LP wallet, kept beside the first wallet', () => {
  test('a house member with none has no address, no signer and no Umbrae key', async () => {
    expect(await lpWalletAddress(NEUMA_ID)).toBeNull();
    expect(await lpSigner(NEUMA_ID)).toBeNull();
    expect(await readUmbraeKey(NEUMA_ID)).toBeNull();
    await expect(saveUmbraeKey(NEUMA_ID, KEY)).rejects.toThrow(/no LP wallet yet/);
  });

  test('opening makes one wallet, once, and the signer signs as that address', async () => {
    const first = await openLpWallet(NEUMA_ID);
    expect(first.created).toBe(true);
    expect(ethers.isAddress(first.address)).toBe(true);
    expect(await openLpWallet(NEUMA_ID)).toEqual({ address: first.address, created: false });
    expect(await lpWalletAddress(NEUMA_ID)).toBe(first.address);

    const signer = await lpSigner(NEUMA_ID);
    expect(signer.address).toBe(first.address);
    expect(ethers.verifyMessage('proof', await signer.signMessage('proof'))).toBe(first.address);
  });

  test('ten openings at once still make exactly one wallet', async () => {
    const all = await Promise.all(Array.from({ length: 10 }, () => openLpWallet(OTHER_ID)));
    expect(new Set(all.map((w) => w.address)).size).toBe(1);
    expect(all.filter((w) => w.created)).toHaveLength(1);
  });

  test('the key is not readable on disk, and each house member has its own', async () => {
    const raw = await fs.readFile(keysFile(NEUMA_ID, 'lp-wallet.json'), 'utf8');
    const signer = await lpSigner(NEUMA_ID);
    expect(raw).not.toContain(signer.privateKey);
    expect(raw).not.toContain(signer.privateKey.slice(2));
    expect(raw).not.toContain(signer.address);
    expect(await lpWalletAddress(OTHER_ID)).not.toBe(signer.address);
  });

  test('the making is written to the house member\'s audit line, without the key', async () => {
    const audit = await fs.readFile(path.join(workspace._path(NEUMA_ID), 'audit', 'audit.jsonl'), 'utf8');
    const signer = await lpSigner(NEUMA_ID);
    expect(audit).toContain('LP_WALLET_CREATED');
    expect(audit).toContain(signer.address);
    expect(audit).not.toContain(signer.privateKey.slice(2));
  });

  test('a wallet file written in plain text by anyone else is not honoured', async () => {
    const planted = ethers.Wallet.createRandom();
    const id = 'lpwalletplanted';
    await workspace.create(id);
    await fs.mkdir(path.dirname(keysFile(id, 'lp-wallet.json')), { recursive: true });
    await fs.writeFile(keysFile(id, 'lp-wallet.json'), JSON.stringify({ address: planted.address, privateKey: planted.privateKey }));
    expect(await lpWalletAddress(id)).toBeNull();
    expect(await lpSigner(id)).toBeNull();
  });
});

describe('the Umbrae key for the LP wallet', () => {
  test('it is saved encrypted, read back whole, and audited without its value', async () => {
    await saveUmbraeKey(NEUMA_ID, KEY);
    expect(await readUmbraeKey(NEUMA_ID)).toBe(KEY);
    expect(await fs.readFile(keysFile(NEUMA_ID, 'lp-umbrae-key.json'), 'utf8')).not.toContain(KEY);
    const audit = await fs.readFile(path.join(workspace._path(NEUMA_ID), 'audit', 'audit.jsonl'), 'utf8');
    expect(audit).toContain('LP_UMBRAE_KEY_SAVED');
    expect(audit).not.toContain(KEY);
    expect(await readUmbraeKey(OTHER_ID)).toBeNull();
  });

  test('something that is not an Umbrae key is refused', async () => {
    for (const bad of ['', 'sk-abc', 'umbr_', 'umbr_has a space in it', undefined, 42]) {
      await expect(saveUmbraeKey(NEUMA_ID, bad)).rejects.toThrow(/not an Umbrae key/);
    }
    expect(await readUmbraeKey(NEUMA_ID)).toBe(KEY);
  });
});
