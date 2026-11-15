import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { decryptKeypair } from '../../core/wallet/keypair-vault.js';

const helper = new URL('../helpers/wallet-rotation-crash-process.mjs', import.meta.url).pathname;
const owner = ethers.Wallet.createRandom();
let root;
let originalRoot;
let child;

const start = async (phase) => {
  child = fork(helper, [], {
    env: { ...process.env, WALLET_CRASH_ROOT: root, WALLET_CRASH_PHASE: phase, WALLET_CRASH_OWNER_KEY: owner.privateKey },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  return new Promise((resolve) => {
    const receive = (message) => {
      if (phase === 'crash' ? message?.type !== 'ready' : message?.type !== 'resumed') return;
      child.off('message', receive);
      resolve(message);
    };
    child.on('message', receive);
  });
};

beforeEach(async () => {
  root = await createTempDir('wallet-rotation-crash');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
});

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  setWorkspacesRoot(originalRoot);
});

test('SIGKILL after bundle commit and before response still resumes the same recovery codes', async () => {
  await start('crash');
  const bundle = path.join(root, 'rotation-crash', 'keys', 'keypair-bundle.json');
  const deadline = Date.now() + 15000;
  let killed = false;
  while (!killed && Date.now() < deadline) {
    if (await fs.stat(bundle).catch(() => null)) {
      child.kill('SIGKILL');
      killed = true;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  expect(killed).toBe(true);
  const [code, signal] = await once(child, 'exit');
  expect(code).toBeNull();
  expect(signal).toBe('SIGKILL');

  const delivered = await workspace.readRotationCodes('rotation-crash');
  expect(delivered).not.toBeNull();
  const resumed = await start('resume');
  expect(resumed).toMatchObject({ delivered: 200, codes: delivered.codes, acknowledged: 200 });
  expect((await workspace.readEncryptedKeypair('rotation-crash')).address).toBe(resumed.address);
  expect((await workspace.readRotationCodes('rotation-crash'))).toBeNull();
  const current = decryptKeypair(await workspace.readEncryptedKeypair('rotation-crash'), 'new-rotation-password');
  expect(current.address).toBe(resumed.address);
});
