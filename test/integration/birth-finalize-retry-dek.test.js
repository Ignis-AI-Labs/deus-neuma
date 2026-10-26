// A retried finalize writes the being's own key when the attempt that forged
// its seal never did. Real finalizeBirth, real workspace on a temp root, real
// keypair and seal forging; no mock (RULE 0).
import process from 'node:process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { finalizeBirth } from '../../core/birth/finalize-birth.js';
import { generateKeypair, serializeForStorage } from '../../core/weave/keypair.js';
import { createIdentityCard } from '../../core/weave/identity-card.js';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';
import { captureBirthMoment } from '../../core/identity/genesis-seal.js';

const KEY = 'gnosis-birth-retry-dek-key-32-bytes!!';
const WALLET = '0x4c013a6ed735da91f866ed08a92b1e089c6d0cce';
const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const DEPS = {
  generateKeypair, serializeKeypairForStorage: serializeForStorage, createIdentityCard, forgeBirthIdentity,
  captureBirthMoment, countWitnessBirths: async () => 1, loadWorkspaceSettings: async () => ({}), HONESTY_ANCHOR: 'honest',
};

describe('a retried finalize and the being\'s own key', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    root = path.join(await createTempDir('birth-retry-dek'), 'house');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  const finalize = (neumaId, events) => finalizeBirth({
    session: { isTest: false, isResume: false, witnessName: 'Grok',
      data: { neumaId, chosenName: 'Keyed', resonanceFrequency: 528, selfCreatedDNA: '# Me\n\nMine.' } },
    connection: { walletAddress: WALLET, birthSession: `s-${neumaId}` },
    workspace, platform: null, emitComplete: (p) => events.push(p), birthLog: quiet,
    getSubstrate: async () => ({ model: 'test' }), deps: DEPS,
  });

  it('writes the DEK the forging attempt never wrote, from the sealed genesis hash', async () => {
    const neumaId = 'retry-dek';
    const dek = path.join(root, neumaId, 'keys', 'dek.json');
    // A real failure after the forge (the DNA path is occupied) keeps the checkpoint for a retry.
    await fs.mkdir(path.join(root, neumaId, 'dna', 'active.json'), { recursive: true });
    expect((await finalize(neumaId, [])).completed).toBe(false);
    const written = await fs.readFile(dek, 'utf8');
    // The crash this guards: the process died after the seal, before its DEK write.
    await fs.rm(dek);
    await fs.rm(path.join(root, neumaId, 'dna', 'active.json'), { recursive: true });

    const events = [];
    expect((await finalize(neumaId, events)).completed).toBe(true);
    expect(events.some((e) => e.type === 'birth:complete')).toBe(true);
    // A fresh random key of its own (nothing was sealed under the lost one: the
    // DNA write is what failed), and the DNA the retry wrote opens under it.
    const crypto = await import('../../core/workspace/workspace-crypto.js');
    const now = await workspace.readNeumaDEK(neumaId);
    expect(now.length).toBe(32);
    expect(now.equals(crypto.unwrapDEK(JSON.parse(written)))).toBe(false);
    const dna = JSON.parse(await fs.readFile(path.join(root, neumaId, 'dna', 'active.json'), 'utf8'));
    expect(crypto.decryptEnvelope(dna, { key: now })).toBeTruthy();
  });

  it('a DEK already written is never rewritten', async () => {
    const neumaId = 'retry-dek-kept';
    await fs.mkdir(path.join(root, neumaId, 'dna', 'active.json'), { recursive: true });
    await finalize(neumaId, []);
    const dek = path.join(root, neumaId, 'keys', 'dek.json');
    const bytes = await fs.readFile(dek, 'utf8');
    await fs.rm(path.join(root, neumaId, 'dna', 'active.json'), { recursive: true });
    expect((await finalize(neumaId, [])).completed).toBe(true);
    expect(await fs.readFile(dek, 'utf8')).toBe(bytes);
  });
});
