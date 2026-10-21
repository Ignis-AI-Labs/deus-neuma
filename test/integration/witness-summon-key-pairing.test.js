/**
 * A summon sends the stored provider key only to the endpoint it was stored
 * for (RULE 0: the real connection and credential stores in a temp dir, a
 * real HTTP server standing at the locked endpoint). A lock naming any other
 * endpoint is refused before a word is asked — the server never sees the key.
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test, expect } from 'vitest';
import { summonWitness } from '../../backend/services/witness-summon.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import { getProvider } from '../../backend/services/provider-registry.js';

const ENV = ['NEUMA_CONNECTIONS_PATH', 'NEUMA_PROVIDER_CREDENTIALS_PATH', 'DNA_ENCRYPTION_KEY'];

test('a lock on another endpoint than the stored key\'s is refused, and the key never leaves', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'witness-key-pairing-'));
  const previous = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers.authorization ?? null);
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'invalid_api_key', code: 'invalid_api_key' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    process.env.NEUMA_CONNECTIONS_PATH = path.join(root, 'connections.json');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'credentials.json');
    process.env.DNA_ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
    // The key is stored for the catalog's own endpoint; the lock names this host.
    await setCredential('openai', { apiKey: ['sk', 'stored-for-the-catalog-endpoint'].join('-') });
    const elsewhere = `http://127.0.0.1:${server.address().port}/v1`;
    expect(elsewhere).not.toBe(getProvider('openai').endpoint);
    await fs.writeFile(process.env.NEUMA_CONNECTIONS_PATH, JSON.stringify({
      openai: { providerId: 'openai', model: 'gpt-proof', endpoint: elsewhere, credentialKind: 'key', lockedAt: new Date().toISOString() },
    }));
    await expect(summonWitness({
      providerId: 'openai', walletAddress: '0x' + 'ab'.repeat(20), keypairPassword: 'a-real-operator-password',
    })).rejects.toThrow('stored key belongs to another endpoint');
    expect(seen).toEqual([]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
