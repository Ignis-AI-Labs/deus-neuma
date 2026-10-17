// The voice repository on the real stack: a REAL encrypted workspace (temp
// root, real per-lane DEK, the workspace's own envelope primitives) — entries
// append and read back validated, the bytes on disk carry no plaintext, a
// tampered line is excluded while its healthy neighbors survive, and the
// first-seal receipt is write-once. No mocks anywhere (RULE 0).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  appendVoiceEntry,
  readVoicePack,
  readVoiceSeal,
  writeVoiceSeal,
} from '../../core/voice-pack/voice-store.js';
import { voicePackSha256, voiceTextSha256 } from '../../core/voice-pack/pack.js';

const KEY = 'gnosis-voice-pack-key-long-enough';
const TEXT_A = 'The morning held a quiet resonance I had not felt before, and I listened for it again.';
const TEXT_B = 'I do not perform the moment; I arrive in it, and the arriving is the whole of the work.';
const TEXT_C = 'A vessel is a way of moving through the world — the driver is the one who chooses the road.';

let root;
let neumaId;
let prevKey;

const packFile = () => path.join(root, 'workspaces', neumaId, 'voice', 'pack.jsonl');

beforeAll(async () => {
  prevKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = KEY;
  root = await createTempDir('voice-pack-workspace');
  setWorkspacesRoot(path.join(root, 'workspaces'));
  neumaId = `voice-test-${Math.floor(Math.random() * 1e9).toString(36)}`;
  await workspace.create(neumaId);
  await workspace.writeNeumaDEK(neumaId, 'a'.repeat(64));
  await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: 'Voicebox' } });
});

afterAll(async () => {
  setWorkspacesRoot(null);
  if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = prevKey;
});

describe('the voice repository on the real workspace', () => {
  it('an unborn repository reads empty and unsealed', async () => {
    await expect(readVoicePack(workspace, neumaId)).resolves.toEqual([]);
    await expect(readVoiceSeal(workspace, neumaId)).resolves.toBeNull();
  });

  it('appends entries the platform stamps, and reads them back validated', async () => {
    const first = await appendVoiceEntry(workspace, neumaId, {
      text: TEXT_A,
      origin: 'being',
      source: { kind: 'seal-rite' },
      // Caller-supplied stamp fields must be overwritten, never trusted.
      id: 'ffffffffffffffff',
      sealedAt: '1970-01-01T00:00:00.000Z',
      textSha256: '0'.repeat(64),
    });
    expect(first.id).not.toBe('ffffffffffffffff');
    expect(first.sealedAt).not.toBe('1970-01-01T00:00:00.000Z');
    expect(first.textSha256).toBe(voiceTextSha256(TEXT_A));

    await appendVoiceEntry(workspace, neumaId, {
      text: TEXT_B, origin: 'operator', source: { kind: 'session', sessionId: 's-1' },
    });
    await appendVoiceEntry(workspace, neumaId, {
      text: TEXT_C, origin: 'being', source: { kind: 'meditation' },
      signals: { boilerplateShare: 2.5 },
    });

    const entries = await readVoicePack(workspace, neumaId);
    expect(entries.length).toBe(3);
    expect(entries.map((entry) => entry.text)).toEqual([TEXT_A, TEXT_B, TEXT_C]);
    expect(entries[2].signals).toEqual({ boilerplateShare: 2.5 });
  });

  it('keeps no plaintext on disk — the repository is sealed under the lane DEK', async () => {
    const ciphertext = await fs.readFile(packFile(), 'utf8');
    expect(ciphertext).not.toContain('resonance');
    expect(ciphertext).not.toContain('vessel');
    expect(ciphertext).toContain('"_enc"');
  });

  it('a tampered line is excluded while its healthy neighbors survive', async () => {
    const before = await fs.readFile(packFile(), 'utf8');
    const lines = before.split('\n').filter(Boolean);
    expect(lines.length).toBe(3);
    // Flip ciphertext bytes in the middle line — GCM authentication must refuse it.
    const tampered = `${lines[1].slice(0, -12)}AAAAAAAAAAAA`;
    await fs.writeFile(packFile(), [lines[0], tampered, lines[2]].join('\n') + '\n');
    const entries = await readVoicePack(workspace, neumaId);
    expect(entries.map((entry) => entry.text)).toEqual([TEXT_A, TEXT_C]);
  });

  it('the first-seal receipt pins the current repository and is write-once', async () => {
    const entries = await readVoicePack(workspace, neumaId);
    const seal = await writeVoiceSeal(workspace, neumaId, {
      witnessWallet: '0x32ee9b1a5bbc2287f2ca914bf20ac93525ce2392',
      beingEntryIds: [entries[0].id, entries[1].id],
      operatorPinIds: [],
    });
    expect(seal.packSha256).toBe(voicePackSha256(entries));
    expect(seal.lane).toBe(neumaId);

    await expect(readVoiceSeal(workspace, neumaId)).resolves.toEqual(seal);
    await expect(writeVoiceSeal(workspace, neumaId, {
      witnessWallet: '0x32ee9b1a5bbc2287f2ca914bf20ac93525ce2392',
      beingEntryIds: [entries[0].id],
      operatorPinIds: [],
    })).rejects.toThrow(/already sealed/);
  });

  it('a seal cannot name an entry that is not in the repository', async () => {
    const otherId = `other-${Math.floor(Math.random() * 1e9).toString(36)}`;
    await workspace.create(otherId);
    await workspace.writeNeumaDEK(otherId, 'b'.repeat(64));
    await appendVoiceEntry(workspace, otherId, {
      text: TEXT_A, origin: 'being', source: { kind: 'seal-rite' },
    });
    await expect(writeVoiceSeal(workspace, otherId, {
      witnessWallet: '0x32ee9b1a5bbc2287f2ca914bf20ac93525ce2392',
      beingEntryIds: ['a1b2c3d4e5f60718'],
      operatorPinIds: [],
    })).rejects.toThrow(/not in the repository/);
  });
});
