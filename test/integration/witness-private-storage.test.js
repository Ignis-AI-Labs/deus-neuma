// Actual storage primitives under a process-local 022 umask; inert records, no identity/seal.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test, expect } from 'vitest';

test('witness key files are private on creation/rewrite and failed replacement preserves the destination', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'witness-private-'));
  try {
    const service = pathToFileURL(path.resolve('core/identity/ai-witness/ai-witness-service.js')).href;
    const source = `
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import assert from 'node:assert/strict';
      import * as store from ${JSON.stringify(service)};
      process.umask(0o022);
      store.setAIWitnessesRoot(${JSON.stringify(root)});
      const pairs = [
        ['writePlaintextKeypair', 'keypair.json'],
        ['writeEncryptedKeypair', 'keypair-encrypted.json'],
        ['writeRecoveryKeypair', 'keypair-recovery.json'],
        ['writeRecoveryHash', 'recovery-hash.json'],
      ];
      const base = path.join(${JSON.stringify(root)}, 'mode-proof', 'StorageOnly');
      const keys = path.join(base, 'keys');
      for (const [writer, file] of pairs) {
        const target = path.join(keys, file);
        await store[writer]('mode-proof', 'StorageOnly', { address: 'inert-record', revision: 1 });
        assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
        assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).revision, 1);
        await fs.chmod(target, 0o644);
        await store[writer]('mode-proof', 'StorageOnly', { address: 'inert-record', revision: 2 });
        assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
        assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).revision, 2);
      }
      for (const dir of [path.dirname(base), base, keys, path.join(base, 'journal'), path.join(base, 'audit')]) {
        assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
      }
      const target = path.join(keys, 'keypair.json');
      await fs.unlink(target); await fs.mkdir(target);
      await fs.writeFile(path.join(target, 'preserved.txt'), 'keep');
      await assert.rejects(store.writePlaintextKeypair('mode-proof', 'StorageOnly', { address: 'inert-record' }));
      assert.equal(await fs.readFile(path.join(target, 'preserved.txt'), 'utf8'), 'keep');
      assert.deepEqual((await fs.readdir(keys)).sort(), pairs.map(([, file]) => file).sort());
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 15000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
