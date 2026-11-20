/* global setTimeout */
import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { aesSeal } from '../helpers/electron-seal.js';

const require = createRequire(import.meta.url);
const { createWalletService } = require('../../electron/wallet/wallet-service.cjs');

const CHEAP = { N: 1024, r: 8, p: 1, dkLen: 32 };
const PW = 'a-remembered-wallet-password';
const SEAL = aesSeal();

const waitForLock = async (service) => {
  const deadline = Date.now() + 2000;
  while (service.isUnlocked() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(service.isUnlocked()).toBe(false);
};

test('remembered activation works once at launch and never cancels an idle or explicit lock', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr600-idle-'));
  const makeService = () => createWalletService({ walletDir: dir, outerSeal: SEAL, scryptParams: CHEAP, idleMs: 20 });
  try {
    const initial = makeService();
    const { id } = initial.create(PW);
    initial.unlock(id, PW, true);

    const launch = makeService();
    expect(launch.tryRememberedUnlock()).toMatchObject({ unlocked: true, activeId: id });
    await waitForLock(launch);
    expect(launch.tryRememberedUnlock()).toBeNull();
    await expect(launch.signMessage('must-not-sign')).rejects.toThrow(/locked/);

    expect(launch.unlock(id, PW)).toMatchObject({ unlocked: true });
    launch.lock();
    expect(launch.tryRememberedUnlock()).toBeNull();

    const nextLaunch = makeService();
    expect(nextLaunch.tryRememberedUnlock()).toMatchObject({ unlocked: true, activeId: id });
    nextLaunch.lock();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
