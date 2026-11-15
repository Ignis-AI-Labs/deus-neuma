import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ethers } from 'ethers';
import { startAnvil } from '../helpers/money-in-kit.js';

const helper = new URL('../helpers/wallet-approval-process.mjs', import.meta.url).pathname;
let anvil;
let provider;
let root;

const run = async (phase) => {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helper], {
      env: { ...process.env, WALLET_TEST_ROOT: root, WALLET_TEST_STATE: path.join(root, 'public-state.json'), WALLET_TEST_PHASE: phase, WALLET_TEST_ANVIL: anvil.url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(JSON.parse(stdout.trim().split('\n').at(-1))) : reject(new Error(`${phase}: ${stderr}`)));
  });
  return output;
};

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true });
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-approval-replay-'));
}, 30000);

afterAll(async () => {
  provider?.destroy();
  await anvil?.stop();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  const files = await fs.readdir(root);
  await Promise.all(files.map((file) => fs.rm(path.join(root, file), { recursive: true, force: true })));
  await run('setup');
});

test('a direct above-threshold approval stays consumed after the backend process exits', async () => {
  const first = await run('send');
  const replay = await run('send');
  expect(first.sent).toBe(true);
  expect(replay).toMatchObject({ sent: false, reason: 'Operator approval already used' });
  const state = JSON.parse(await fs.readFile(path.join(root, 'public-state.json'), 'utf8'));
  expect(await provider.getBalance(state.recipient)).toBe(ethers.parseEther('0.02'));
}, 30000);

test('two backend processes cannot consume the same approval concurrently', async () => {
  const results = await Promise.all([run('send'), run('send')]);
  expect(results.filter((result) => result.sent)).toHaveLength(1);
  expect(results.filter((result) => !result.sent)).toHaveLength(1);
  const state = JSON.parse(await fs.readFile(path.join(root, 'public-state.json'), 'utf8'));
  expect(await provider.getBalance(state.recipient)).toBe(ethers.parseEther('0.02'));
}, 30000);
