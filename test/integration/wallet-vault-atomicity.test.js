import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const vaultCrypto = require('../../electron/wallet/vault-crypto.cjs');
const vaultStore = require('../../electron/wallet/vault-store.cjs');
const writer = new URL('../helpers/wallet-vault-writer.mjs', import.meta.url).pathname;
const password = 'atomic-vault-test-password';
const params = { N: 1024, r: 8, p: 1, dkLen: 32 };

test('process death during repeated vault replacement always leaves a complete readable vault', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-vault-atomicity-'));
  const file = path.join(dir, 'wallet.dat');
  const initial = vaultCrypto.createVault({ type: 'mnemonic', secret: require('ethers').Mnemonic.fromEntropy(require('ethers').randomBytes(32)).phrase }, password, { params });
  vaultStore.writeVault(file, initial, { available: false });
  try {
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const child = spawn(process.execPath, [writer], {
        env: { ...process.env, WALLET_VAULT_FILE: file, WALLET_VAULT_PASSWORD: password },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('writer did not start')), 10000);
        child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
        child.once('error', reject);
      });
      await new Promise((resolve) => setTimeout(resolve, 2 + iteration));
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
      const stored = vaultStore.readVault(file, { available: false });
      expect(stored).toBeTruthy();
      expect(() => vaultCrypto.openVault(stored, password)).not.toThrow();
      expect(output).toContain('"ready":true');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
