import process from 'node:process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';
import { beforeAll, afterAll, beforeEach, test, expect } from 'vitest';
import { ethers } from 'ethers';
import { startAnvil } from '../helpers/money-in-kit.js';
import { claimOwner } from '../helpers/claim-owner.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const helper = new URL('../helpers/rate-limit-process.mjs', import.meta.url).pathname;
const neuma = ethers.HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
let anvil; let provider; let root; let previousRoot; let recipient;

const run = async (attempts = 11) => {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helper], {
      env: { ...process.env, RATE_LIMIT_ROOT: root, RATE_LIMIT_ANVIL: anvil.url, RATE_LIMIT_RECIPIENT: recipient, RATE_LIMIT_ATTEMPTS: String(attempts) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(JSON.parse(stdout.trim().split('\n').at(-1))) : reject(new Error(stderr)));
  });
  return output;
};

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 50 });
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-rate-limit-regression-'));
  previousRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
}, 30000);

afterAll(async () => {
  provider?.destroy();
  await anvil?.stop();
  setWorkspacesRoot(previousRoot);
  if (root) await fs.rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const file of await fs.readdir(root)) await fs.rm(path.join(root, file), { recursive: true, force: true });
  await workspace.create('rate-limit-proof');
  await claimOwner(root, 'rate-limit-proof', ethers.Wallet.createRandom().address);
  recipient = ethers.Wallet.createRandom().address;
  await workspace.writeSpendAllowlist('rate-limit-proof', { version: 1, entries: [{ address: recipient, label: 'test', addedAt: new Date().toISOString() }] });
  await workspace.writeSpendThreshold('rate-limit-proof', { thresholdEth: 1 });
  await provider.send('anvil_setBalance', [neuma.address, ethers.toQuantity(ethers.parseEther('1'))]);
});

test('restart inherits the exhausted hourly allowance', async () => {
  const first = await run();
  const restarted = await run();
  expect(first.sent).toBe(10);
  expect(restarted.sent).toBe(0);
  expect(await provider.getBalance(recipient)).toBe(ethers.parseEther('0.000010'));
}, 30000);

test('an unreadable rate record refuses rather than resetting the allowance', async () => {
  const config = path.join(root, 'rate-limit-proof', 'config');
  await fs.mkdir(config, { recursive: true });
  await fs.writeFile(path.join(config, 'spend-rate.json'), '{not-json');
  const out = await run(1);
  expect(out.sent).toBe(0);
  expect(out.refusal).toBeTruthy();
  expect(await provider.getBalance(recipient)).toBe(0n);
});

test('concurrent callers share the same final rate slot on disk', async () => {
  const attempts = await Promise.all(Array.from({ length: 20 }, () => workspace.consumeSpendRateSlot('rate-limit-proof', { limit: 10, windowMs: 3_600_000 })));
  expect(attempts.filter(Boolean)).toHaveLength(10);
  expect(attempts.filter((accepted) => !accepted)).toHaveLength(10);
});
