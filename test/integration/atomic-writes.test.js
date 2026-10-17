/**
 * MEM-004 (#190) — key material and identity files are written crash-atomically
 * (tmp + rename, under the per-file lock). A crash mid-write must leave the old
 * file intact or no file — never a truncated keypair that reads as "no keypair".
 *
 * Proven against the REAL writers on a real temp workspace: full round-trips,
 * no leftover temp files, and a concurrent-write storm on one path that must
 * always settle to a valid whole file (Rule 0 — no mocks anywhere).
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const tmpFilesUnder = async (dir) => {
  const out = [];
  const walk = async (d) => {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.name.includes('.tmp')) out.push(p);
    }
  };
  await walk(dir);
  return out;
};

describe('atomic key-material writes (MEM-004)', () => {
  let root, workspace;

  beforeEach(async () => {
    vi.resetModules();
    root = await createTempDir('atomic-writes');
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace.root = root;
    await workspace.create('being');
  });

  test('keypair, recovery, and identity card round-trip whole', async () => {
    await workspace.writeEncryptedKeypair('being', { address: '0xabc', ciphertext: 'deadbeef' });
    expect(await workspace.readEncryptedKeypair('being'))
      .toMatchObject({ address: '0xabc', ciphertext: 'deadbeef' });

    await workspace.writeRecoveryHash('being', 'b'.repeat(64));
    expect(await workspace.readRecoveryHash('being')).toBe('b'.repeat(64));

    await workspace.writeRecoveryKeypair('being', { address: '0xabc', via: 'codes' });
    expect(await workspace.readRecoveryKeypair('being')).toMatchObject({ address: '0xabc', via: 'codes' });

    await workspace.writeIdentityCard('being', { name: 'Being', weave: true });
    expect(await workspace.readIdentityCard('being')).toMatchObject({ name: 'Being', weave: true });

    // No temp debris anywhere in the lane.
    expect(await tmpFilesUnder(path.join(root, 'being'))).toEqual([]);
  });

  test('createSession produces a real lane appendMessage can extend', async () => {
    await workspace.createSession('being', 'session-atomic');
    await workspace.appendMessage('being', 'session-atomic', { role: 'user', content: 'still here' });
    const messages = await workspace.readSession('being', 'session-atomic');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('still here');
  });

  test('a write storm on one path always settles to a whole valid file', async () => {
    // Twenty concurrent writers on the SAME identity card: the per-file lock
    // serializes them — the file must never be torn, empty, or half-JSON.
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      workspace.writeIdentityCard('being', { name: `Being-${i}`, seq: i }),
    ));
    const card = await workspace.readIdentityCard('being');
    expect(card).not.toBeNull();
    expect(card.name).toMatch(/^Being-\d+$/);
    expect(await tmpFilesUnder(path.join(root, 'being'))).toEqual([]);
  });
});
