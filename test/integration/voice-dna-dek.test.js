/**
 * Voice DNA v2 survives the per-neuma DEK migration, and a voice sealed on a
 * migrated being is written under that being's own key.
 *
 * The clip, the consent record and the voice in force all live under
 * <root>/<neumaId>/voice/, so the DEK backfill re-encrypts them under the
 * being's key. These tests seal a voice, run the REAL migration, and prove the
 * voice still reads; then seal on an already-migrated being and prove the
 * global key alone cannot open what was written (lane isolation).
 *
 * REAL temp workspace (never the live root), REAL AES-256-GCM, REAL
 * migrateBeing. No mocks (RULE 0).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { migrateBeing } from '../../core/workspace/migrate-being.js';
import { decryptEnvelope, deriveKeyFromSecret, resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import * as svc from '../../core/voice/voice-dna-service.js';

const KEY = 'voice-dek-master-key-long-enough-yes';
const WALLET = '0x' + 'a'.repeat(40);

// Give the being the identity a migration requires (plaintext seal + owner).
const seedBeing = async (root, neumaId) => {
  const dir = path.join(root, neumaId);
  await fs.mkdir(path.join(dir, 'identity'), { recursive: true });
  await fs.writeFile(path.join(dir, 'owner.json'), JSON.stringify({ wallet: WALLET, claimedAt: Date.now() }));
  await fs.writeFile(
    path.join(dir, 'identity', 'genesis-seal.json'),
    JSON.stringify({ genesisHash: genesisOf(neumaId), record: { chosenName: neumaId } }),
  );
};
const genesisOf = (neumaId) => neumaId.repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, '0');

// A real 3.5 s mono 16-bit WAV at 8 kHz.
const wav = () => {
  const rate = 8000;
  const n = rate * 3.5;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'latin1'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8, 'latin1');
  buf.write('fmt ', 12, 'latin1'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'latin1'); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) buf.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 180 * i) / rate)), 44 + i * 2);
  return buf;
};

const sealVoice = async (id, clip) => {
  const { ref } = await svc.saveVoiceClip(id, clip);
  const candidate = {
    ref, seconds: 3.5, sampleRate: 8000, words: 'The tide is out and the lamps are low.',
    origin: { door: 'record' }, realPerson: true, attested: true,
  };
  expect((await svc.offerSpeechCandidate(id, candidate)).ok).toBe(true);
  expect((await svc.acceptSpeechCandidate(id, { candidateRef: ref })).ok).toBe(true);
  const sealed = await svc.sealSpeechCandidate(id, { candidateRef: ref, wallet: WALLET });
  expect(sealed.error).toBeUndefined();
  return { ref, dna: sealed.dna };
};

const globalKeyOpens = async (file) => {
  const env = JSON.parse(await fs.readFile(file, 'utf8'));
  try { decryptEnvelope(env, { key: deriveKeyFromSecret(KEY) }); return true; } catch { return false; }
};

describe('Voice DNA v2 + the per-neuma DEK', () => {
  let house, origRoot, origKey;

  beforeEach(async () => {
    origKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    resetWorkspaceCryptoKey();
    house = await createTempDir(`voice-v2-dek-${Math.random().toString(36).slice(2)}`);
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
  });

  afterEach(() => {
    setWorkspacesRoot(origRoot);
    if (origKey === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = origKey;
    resetWorkspaceCryptoKey();
  });

  it('a voice sealed before migration still reads after the being moves to its own key', async () => {
    const id = 'auroravoice';
    await seedBeing(house, id);
    const clip = wav();
    const { ref, dna } = await sealVoice(id, clip);

    const result = await migrateBeing(workspace, id);
    expect(result.status).toBe('migrated');

    // The migration really moved every voice file onto the DEK.
    const voice = path.join(house, id, 'voice');
    for (const f of ['voice-dna-v2.json', 'speech-candidate.json', `voice-clip-${ref.slice(7)}.json`]) {
      expect(await globalKeyOpens(path.join(voice, f))).toBe(false);
    }

    // …and every read still opens through the DEK.
    const read = await svc.readVoice(id);
    expect(read.standing).toBe('ready');
    expect(read.dna).toEqual(dna);
    expect(await svc.readVoiceClip(id, ref)).toEqual(clip);
    expect((await svc.readSpeechCandidate(id)).inForce).toBe(ref);
  });

  it('a voice sealed on an already-migrated being is written under its DEK, not the global key', async () => {
    const id = 'verisvoice0';
    await seedBeing(house, id);
    await workspace.writeNeumaDEK(id, genesisOf(id));

    const clip = wav();
    const { ref } = await sealVoice(id, clip);

    const voice = path.join(house, id, 'voice');
    for (const f of ['voice-dna-v2.json', 'speech-candidate.json', `voice-clip-${ref.slice(7)}.json`]) {
      expect(await globalKeyOpens(path.join(voice, f))).toBe(false);
    }
    expect((await svc.readVoice(id)).dna.clip.ref).toBe(ref);
    expect(await svc.readVoiceClip(id, ref)).toEqual(clip);
  });
});
