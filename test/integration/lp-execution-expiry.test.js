import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ethers } from 'ethers';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { actionHash, guardLpExecution, recordLpBroadcast, settleLpExecution, UNKNOWN_DROPPED_AFTER_MS } from '../../backend/services/umbrae-lp/lp-executions.js';
import { lpSigner, openLpWallet } from '../../backend/services/umbrae-lp/lp-wallet.js';

let anvil;
let provider;
let root;
let originalRoot;
let signer;
let tx;
let asked;
let hash;
let signed;

const recordFile = () => path.join(workspace._path('executor'), 'config', 'lp-executions', `${hash}.json`);
const ageRecord = async () => {
  const file = recordFile();
  const record = await workspace._readTrustedJSON(file);
  const old = new Date(Date.now() - UNKNOWN_DROPPED_AFTER_MS - 1000).toISOString();
  const legacy = { ...record };
  delete legacy.from;
  await workspace._writeJSON(file, { ...legacy, signedAt: old, updatedAt: old });
};

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 });
  root = await createTempDir('lp-execution-expiry');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  await workspace.create('executor');
  await openLpWallet('executor');
  signer = (await lpSigner('executor')).connect(provider);
  await provider.send('anvil_setBalance', [signer.address, ethers.toQuantity(ethers.parseEther('1'))]);
  tx = { to: '0x3333333333333333333333333333333333333333', data: '0x', value: '1', chainId: 8453 };
  asked = { kind: 'transfer', to: tx.to, token: null, amount: '1' };
  hash = actionHash(tx, asked);
  const signedTransaction = await signer.signTransaction({ ...tx, nonce: 0, gasLimit: 21000, maxFeePerGas: ethers.parseUnits('1', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei') });
  signed = { signedTransaction, hash: ethers.keccak256(signedTransaction) };
});

afterAll(async () => {
  provider?.destroy();
  await anvil?.stop();
  setWorkspacesRoot(originalRoot);
  await fs.rm(root, { recursive: true, force: true });
});

describe('P6-136 unknown execution retirement', () => {
  test('young and old-but-still-pending records refuse; an old passed nonce drops and permits retry', async () => {
    expect(await recordLpBroadcast({ neumaId: 'executor', actionHash: hash, signed })).toEqual({ ok: true });
    await settleLpExecution({ neumaId: 'executor', actionHash: hash, state: 'unknown' });
    const guard = () => guardLpExecution({ neumaId: 'executor', tx, asked, provider, secondary: provider, minConfirmations: 1 });
    expect(await guard()).toMatchObject({ ok: false, uncertain: true, txHash: signed.hash });

    await ageRecord();
    expect(Number(await provider.getTransactionCount(signer.address, 'latest'))).toBe(0);
    expect(await guard()).toMatchObject({ ok: false, uncertain: true });

    const moved = await signer.sendTransaction({ to: tx.to, value: 1n });
    await moved.wait();
    expect(Number(BigInt(await provider.send('eth_getTransactionCount', [signer.address, 'latest'])))).toBe(1);
    expect(await provider.getTransactionReceipt(signed.hash)).toBeNull();
    expect(await guard()).toEqual({ ok: true, actionHash: hash });
    expect(await workspace._readTrustedJSON(recordFile())).toMatchObject({ state: 'dropped', from: signer.address, nonce: 0 });

    expect(await recordLpBroadcast({ neumaId: 'executor', actionHash: hash, signed })).toEqual({ ok: true });
    await settleLpExecution({ neumaId: 'executor', actionHash: hash, state: 'unknown' });
    expect(await guard()).toMatchObject({ ok: false, uncertain: true });
  }, 30000);
});
