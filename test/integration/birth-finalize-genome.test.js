// The body is locked into DNA AT BIRTH (2026-09-25, Founder: […]). Real finalizeBirth, real
// disk, real keypair/identity forge — no mocks (RULE 0). Proves: the DNA
// written by a fresh birth carries appearance.genome (genome/v3), it equals
// a fresh rederivation from the seal that landed on disk beside it (a stored
// look and the truth can never silently disagree), and a walletless birth
// writes no appearance rather than a guessable one.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { finalizeBirth } from '../../core/birth/finalize-birth.js';
import { generateKeypair, serializeForStorage } from '../../core/weave/keypair.js';
import { createIdentityCard } from '../../core/weave/identity-card.js';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';
import { genomeForIdentity } from '../../core/genome/birth-genome.js';
import { readLaneGenome } from '../../backend/services/genome-lane.js';

const KEY = 'gnosis-birth-genome-key-long-enough!!';
const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const birthSession = (neumaId, chosenName) => ({
  isTest: false,
  isResume: false,
  witnessName: 'Founder',
  data: {
    neumaId,
    chosenName,
    resonanceFrequency: 432,
    selfCreatedDNA: `# ${chosenName}\n\nI author myself.`,
    firstWords: [],
    birthMoment: { utc: '2026-09-25T05:00:00.000Z', epochMs: 1790292000000, zone: 'Asia/Jakarta', offsetMinutes: 420 },
  },
});

const realDeps = {
  generateKeypair,
  serializeKeypairForStorage: serializeForStorage,
  createIdentityCard,
  forgeBirthIdentity,
  captureBirthMoment: () => { throw new Error('the moment is provided by the session'); },
  countWitnessBirths: async () => 1,
  loadWorkspaceSettings: async () => ({}),
  HONESTY_ANCHOR: 'honest',
};

describe('finalizeBirth locks the genome into DNA', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('birth-genome');
    root = path.join(tmp, 'house');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('writes appearance.genome (genome/v4) that rederives byte-identically from the seal on disk', async () => {
    const result = await finalizeBirth({
      session: birthSession('genome-born', 'Given'),
      connection: { walletAddress: '0x4c013a6ed735da91f866ed08a92b1e089c6d0cce', birthSession: 'sg1' },
      workspace,
      platform: null,
      emitComplete: () => {},
      birthLog: log,
      getSubstrate: async () => ({ model: 'test' }),
      deps: realDeps,
    });
    expect(result.completed).toBe(true);

    const dna = await workspace._readDNARaw('genome-born');
    expect(dna.appearance?.genome?.schema).toBe('genome/v4');
    const g = dna.appearance.genome;
    if (g.form === 'humanoid') {
      // The perfection-pass axes are present on the record a being is born with.
      expect(g.face.jawline).toBeTruthy();
      expect(g.frame.shoulders).toBeTruthy();
      expect(g.coloring.hairTexture).toBeTruthy();
    } else {
      // A formless body is born carrying only what its form has (v4).
      expect(g).not.toHaveProperty('face');
      expect(Object.keys(g.frame)).toEqual(['stature']);
      expect(Object.keys(g.coloring).sort()).toEqual(['color', 'colorIsUncanny', 'glow']);
    }

    // The determinism law: what the lane's seal implies and what the DNA
    // stored are THE SAME BODY, computed twice, by two different readers.
    const rederived = await readLaneGenome(root, 'genome-born');
    expect(rederived).toEqual(dna.appearance.genome);
    // And the ONE assembly, called directly on the seal's anchors, agrees too.
    const seal = await workspace.readGenesisSeal('genome-born');
    expect(genomeForIdentity({
      soulPublicKey: seal.record.soulPublicKey,
      genesisHash: seal.genesisHash,
      momentSeed: seal.record.momentSeed,
      neumaId: 'genome-born',
    })).toEqual(dna.appearance.genome);
  });

  it('a walletless birth writes NO appearance — never a guessable body', async () => {
    const result = await finalizeBirth({
      session: birthSession('genome-walletless', 'Anchorless'),
      connection: { walletAddress: null, birthSession: 'sg2' },
      workspace,
      platform: null,
      emitComplete: () => {},
      birthLog: log,
      getSubstrate: async () => ({ model: 'test' }),
      deps: realDeps,
    });
    expect(result.completed).toBe(true);
    const dna = await workspace._readDNARaw('genome-walletless');
    expect(dna.appearance).toBeUndefined();
  });
});
