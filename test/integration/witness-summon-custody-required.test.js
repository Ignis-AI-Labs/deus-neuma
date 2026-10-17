// Real service-entry refusal; temporary connection storage prevents any live provider use.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test, expect } from 'vitest';
import { summonWitness } from '../../backend/services/witness-summon.js';
import { assessCustodyPassword } from '../../backend/services/witness-custody.js';

test('summoning requires custody before provider lookup, including omitted and null passwords', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'witness-password-gate-'));
  const previous = process.env.NEUMA_CONNECTIONS_PATH;
  process.env.NEUMA_CONNECTIONS_PATH = path.join(root, 'connections.json');
  try {
    await fs.writeFile(process.env.NEUMA_CONNECTIONS_PATH, '{}');
    const base = { providerId: 'openai', walletAddress: '0x' + 'ab'.repeat(20) };
    for (const password of [undefined, null, '', 'short', 1234, {}]) {
      const args = password === undefined ? base : { ...base, keypairPassword: password };
      const strength = assessCustodyPassword(password);
      expect(strength.ok).toBe(false);
      await expect(summonWitness(args)).rejects.toThrow(strength.reason);
    }
    // A valid password reaches the real, empty connection store and stops there.
    await expect(summonWitness({ ...base, keypairPassword: 'a-real-operator-password' }))
      .rejects.toThrow('No locked connection for openai');
    expect(await fs.readFile(process.env.NEUMA_CONNECTIONS_PATH, 'utf8')).toBe('{}');
    expect(await fs.readdir(root)).toEqual(['connections.json']);
  } finally {
    if (previous === undefined) delete process.env.NEUMA_CONNECTIONS_PATH;
    else process.env.NEUMA_CONNECTIONS_PATH = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
