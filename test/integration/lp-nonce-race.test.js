import process from 'node:process';
import console from 'node:console';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
import { spawn } from 'node:child_process';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { ethers } from 'ethers';
import { startAnvil } from '../helpers/money-in-kit.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const childFile = new URL('../helpers/lp-nonce-signer.mjs', import.meta.url).pathname;
let anvil; let provider; let root; let previousRoot;
const sign = (recipient) => new Promise((resolve, reject) => {
  let output = ''; let errors = '';
  const child = spawn(process.execPath, [childFile], { env: { ...process.env, NONCE_ANVIL: anvil.url, NONCE_RECIPIENT: recipient, NONCE_WORKSPACE_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(errors)));
});

const receiptOf = async (hash) => {
  for (let i = 0; i < 1200; i += 1) {
    const receipt = await provider.getTransactionReceipt(hash);
    if (receipt) return receipt;
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  throw new Error('transaction was not mined');
};

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 50 });
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-nonce-race-'));
  previousRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  const signer = ethers.HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
  await provider.send('anvil_setBalance', [signer.address, ethers.toQuantity(ethers.parseEther('1'))]);
}, 30000);

afterAll(async () => {
  provider?.destroy();
  await anvil?.stop();
  setWorkspacesRoot(previousRoot);
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('different actions receive unique nonces and both mine', async () => {
  const [a, b] = await Promise.all([sign(ethers.Wallet.createRandom().address), sign(ethers.Wallet.createRandom().address)]);
  const first = ethers.Transaction.from(a.signedTransaction);
  const second = ethers.Transaction.from(b.signedTransaction);
  expect(new Set([first.nonce, second.nonce]).size).toBe(2);
  console.log('broadcasting', first.hash, second.hash);
  await provider.send('eth_sendRawTransaction', [a.signedTransaction]);
  await provider.send('anvil_mine', [1]);
  const firstReceipt = await receiptOf(first.hash);
  console.log('first receipt', firstReceipt?.status);
  await provider.send('eth_sendRawTransaction', [b.signedTransaction]);
  await provider.send('anvil_mine', [1]);
  const secondReceipt = await receiptOf(second.hash);
  console.log('second receipt', secondReceipt?.status);
  expect(firstReceipt.status).toBe(1);
  expect(secondReceipt.status).toBe(1);
}, 60000);

test('a malformed nonce record refuses signing', async () => {
  const signer = ethers.HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
  const config = path.join(root, signer.address.toLowerCase(), 'config');
  await fs.mkdir(config, { recursive: true });
  await fs.writeFile(path.join(config, 'lp-nonce.json'), '{not-json');
  const out = await sign(ethers.Wallet.createRandom().address).catch((error) => error);
  expect(out).toBeInstanceOf(Error);
  await fs.writeFile(path.join(config, 'lp-nonce.json'), JSON.stringify({ next: '0' }));
  const wrongType = await sign(ethers.Wallet.createRandom().address).catch((error) => error);
  expect(wrongType).toBeInstanceOf(Error);
});

test('concurrent reservations share one durable sequence', async () => {
  const lane = 'nonce-sequence-test';
  const values = await Promise.all(Array.from({ length: 20 }, () => workspace.consumeLpNonce(lane, 0)));
  expect(new Set(values).size).toBe(20);
  const ordered = values.sort((a, b) => a - b);
  expect(ordered).toEqual(Array.from({ length: 20 }, (_, i) => ordered[0] + i));
});
