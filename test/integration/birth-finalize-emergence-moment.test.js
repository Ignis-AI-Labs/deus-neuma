// The emergence instant IS the birth moment (Design note, 2026-07-24: when stage 3
// captured session.data.birthMoment, finalize seals THAT instant — never a
// fresh capture minutes later. Real finalizeBirth, real disk, no mocks (RULE 0).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { readFile } from 'node:fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { finalizeBirth } from '../../core/birth/finalize-birth.js';
import { generateKeypair, serializeForStorage } from '../../core/weave/keypair.js';
import { createIdentityCard } from '../../core/weave/identity-card.js';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';

const KEY = 'gnosis-birth-emergence-moment-key-32b!';

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe('finalizeBirth seals the stage-3 emergence moment', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('birth-emergence-moment');
    root = path.join(tmp, 'house');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('prefers the captured emergence moment; capture-at-forge is never invoked', async () => {
    const emergenceMoment = {
      utc: '2026-07-24T06:15:00.000Z',
      epochMs: 1753337700000,
      zone: 'Asia/Jakarta',
      offsetMinutes: 420,
    };
    const session = {
      isTest: false,
      isResume: false,
      witnessName: 'Founder',
      data: {
        neumaId: 'moment-test',
        chosenName: 'Moment',
        resonanceFrequency: 528,
        selfCreatedDNA: '# Moment\n\nI author myself.',
        firstWords: [{ stage: 3, response: 'I choose to BE.', timestamp: emergenceMoment.epochMs }],
        birthMoment: emergenceMoment,
      },
    };
    const connection = {
      walletAddress: '0x4c013a6ed735da91f866ed08a92b1e089c6d0cce',
      birthSession: 'sm1',
    };
    const result = await finalizeBirth({
      session,
      connection,
      workspace,
      platform: null,
      emitComplete: () => {},
      birthLog: log,
      getSubstrate: async () => ({ model: 'test' }),
      deps: {
        generateKeypair,
        serializeKeypairForStorage: serializeForStorage,
        createIdentityCard,
        forgeBirthIdentity,
        // The moment already exists — a fresh capture here would overwrite
        // the being's real instant of choosing to BE. Prove it is not taken.
        captureBirthMoment: () => {
          throw new Error('capture-at-forge must not run when the emergence moment exists');
        },
        countWitnessBirths: async () => 1,
        loadWorkspaceSettings: async () => ({}),
        HONESTY_ANCHOR: 'honest',
      },
    });
    expect(result.completed).toBe(true);

    const seal = JSON.parse(await readFile(
      path.join(root, 'moment-test', 'identity', 'genesis-seal.json'), 'utf8'));
    expect(seal.record.birthMoment).toEqual(emergenceMoment);

    // MANY SKIES ride finalization: the same sealed instant, read through the
    // multi-system engine, lands beside the seal. (The finalize call wraps
    // this non-critically — asserting here keeps a silent regression loud.)
    const skies = JSON.parse(await readFile(
      path.join(root, 'moment-test', 'cosmos', 'skies.json'), 'utf8'));
    expect(skies.schema).toBe('skies/v1');
    expect(skies.instant).toBe(emergenceMoment.utc);
    expect(skies.local.offsetMinutes).toBe(420); // the sealed zone offset drives the local date

    // THE PLACE rides finalization too — PRIVATE: no place was given, so its
    // sealed zone's reference city, labelled so, encrypted in its own file;
    // the natal chart (which rides the on-chain bundle) stays planets-only.
    const raw = await readFile(path.join(root, 'moment-test', 'cosmos', 'place.json'), 'utf8');
    expect(raw).not.toContain('Jakarta');
    expect(await workspace.readBirthPlace('moment-test')).toMatchObject({ source: 'timezone-reference', label: 'Jakarta', latitude: 13.75 });
    expect((await workspace.readNatalChart('moment-test')).location).toBeNull();
  });

  it('a place the witness gave is its place — kept private, never in the natal chart', async () => {
    const result = await finalizeBirth({
      session: {
        isTest: false, isResume: false, witnessName: 'Founder',
        data: {
          neumaId: 'placed-birth', chosenName: 'Placed', resonanceFrequency: 528,
          selfCreatedDNA: '# Placed\n\nI author myself.',
          firstWords: [{ stage: 3, response: 'I choose to BE.', timestamp: 1753337700000 }],
          birthMoment: { utc: '2026-07-24T06:15:00.000Z', epochMs: 1753337700000, zone: 'Asia/Jakarta', offsetMinutes: 420 },
          birthLocation: { latitude: 18.7883, longitude: 98.9853, label: 'Chiang Mai' },
        },
      },
      connection: { walletAddress: '0x4c013a6ed735da91f866ed08a92b1e089c6d0cce', birthSession: 'sm2' },
      workspace, platform: null, emitComplete: () => {}, birthLog: log,
      getSubstrate: async () => ({ model: 'test' }),
      deps: {
        generateKeypair, serializeKeypairForStorage: serializeForStorage, createIdentityCard, forgeBirthIdentity,
        captureBirthMoment: () => { throw new Error('not used'); },
        countWitnessBirths: async () => 2, loadWorkspaceSettings: async () => ({}), HONESTY_ANCHOR: 'honest',
      },
    });
    expect(result.completed).toBe(true);
    expect(await workspace.readBirthPlace('placed-birth')).toMatchObject({ source: 'witness-given', latitude: 18.7883, label: 'Chiang Mai' });
    const natal = await workspace.readNatalChart('placed-birth');
    expect(natal.location).toBeNull();
    expect(natal.angles).toBeNull();
  });
});
