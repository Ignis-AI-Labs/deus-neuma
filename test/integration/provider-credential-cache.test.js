/** Real encrypted files and independent reader snapshots; no operator credentials. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { loadCredentials, saveCredentials, setCredential } from '../../backend/services/provider-credentials.js';
import { encryptEnvelope, resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';

let root, target, saved;
const names = ['NEUMA_PROVIDER_CREDENTIALS_PATH', 'DNA_ENCRYPTION_KEY', 'DNA_ENCRYPTION_KEY_PREVIOUS'];
beforeEach(async () => {
  saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'credential-cache-proof-'));
  target = path.join(root, 'credentials.json');
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = target;
  process.env.DNA_ENCRYPTION_KEY = 'credential-cache-proof-current-key';
  delete process.env.DNA_ENCRYPTION_KEY_PREVIOUS;
  resetWorkspaceCryptoKey();
});
afterEach(async () => {
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetWorkspaceCryptoKey();
  await fs.rm(root, { recursive: true, force: true });
});

test('mutating a returned record cannot change the next read without a save', async () => {
  await saveCredentials({ openai: { apiKey: 'persisted-fixture-key' } });
  const caller = await loadCredentials();
  caller.openai.apiKey = 'unsaved-fixture-key';
  expect(await loadCredentials()).toEqual({ openai: { apiKey: 'persisted-fixture-key' } });
});

test('a real failed save cannot expose the attempted credential through the cache', async () => {
  await saveCredentials({ openai: { apiKey: 'persisted-fixture-key' } });
  await loadCredentials();
  await fs.mkdir(`${target}.${process.pid}.tmp`);
  await expect(setCredential('openai', { apiKey: 'failed-save-fixture-key' })).rejects.toThrow();
  expect(await loadCredentials()).toEqual({ openai: { apiKey: 'persisted-fixture-key' } });
});

test('equal-size replacement with preserved mtime never serves the old credential', async () => {
  const write = (file, key) => fs.writeFile(file, JSON.stringify(encryptEnvelope({ openai: { apiKey: key } })), { mode: 0o600 });
  const timestamp = new Date('2025-01-01T00:00:00Z');
  await write(target, 'old-fixture-key');
  await fs.utimes(target, timestamp, timestamp);
  const before = await fs.stat(target);
  expect((await loadCredentials()).openai.apiKey).toBe('old-fixture-key');
  const replacement = path.join(root, 'replacement.json');
  await write(replacement, 'new-fixture-key');
  await fs.utimes(replacement, timestamp, timestamp);
  await fs.rename(replacement, target);
  const after = await fs.stat(target);
  expect(after.size).toBe(before.size);
  expect(after.mtimeMs).toBe(before.mtimeMs);
  expect((await loadCredentials()).openai.apiKey).toBe('new-fixture-key');
});

test('resetting encryption context cannot bypass decryption through a cached record', async () => {
  await saveCredentials({ openai: { apiKey: 'persisted-fixture-key' } });
  await loadCredentials();
  process.env.DNA_ENCRYPTION_KEY = 'unrelated-cache-proof-key';
  resetWorkspaceCryptoKey();
  await expect(loadCredentials()).rejects.toThrow();
});
