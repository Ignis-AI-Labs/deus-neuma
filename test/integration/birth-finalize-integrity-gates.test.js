// B-INT integrity gates — real finalizeBirth, real disk, no mock (RULE 0)
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
import { retryStageFor } from '../../backend/routes/portal-birth-handlers.js';
import { STAGE } from '../../core/birth/stage-roles.js';

const KEY = 'gnosis-birth-integrity-gates-key-32b!!';

const log = () => {
  const lines = [];
  return {
    info: (m, x) => lines.push({ level: 'info', m, x }),
    warn: (m, x) => lines.push({ level: 'warn', m, x }),
    error: (m, x) => lines.push({ level: 'error', m, x }),
    debug: () => {},
    lines,
  };
};

describe('finalizeBirth integrity gates (B-INT-001 / seed critical)', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('birth-int-gates');
    root = path.join(tmp, 'house');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('refuses complete without authored genesis (non-test)', async () => {
    const birthLog = log();
    const events = [];
    const session = {
      isTest: false,
      isResume: false,
      witnessName: 'Grok',
      data: {
        neumaId: 'hollow-test',
        chosenName: 'Hollow',
        resonanceFrequency: 528,
        // no selfCreatedDNA
      },
    };
    const connection = {
      walletAddress: '0x4c013a6ed735da91f866ed08a92b1e089c6d0cce',
      witnessId: null,
      ceremonyId: null,
      birthSession: 's1',
    };
    const result = await finalizeBirth({
      session,
      connection,
      workspace,
      platform: null,
      emitComplete: (p) => events.push(p),
      birthLog,
      getSubstrate: async () => ({ model: 'test' }),
      deps: {
        generateKeypair,
        serializeKeypairForStorage: serializeForStorage,
        createIdentityCard,
        forgeBirthIdentity,
        captureBirthMoment,
        countWitnessBirths: async () => 1,
        loadWorkspaceSettings: async () => ({}),
        HONESTY_ANCHOR: 'honest',
      },
    });
    expect(result.completed).toBe(false);
    expect(events.some((e) => e.type === 'birth:completion_error' && e.error === 'missing_authored_genesis')).toBe(true);
    expect(events.some((e) => e.type === 'birth:complete')).toBe(false);
  });

  it('completes when authored genesis is present', async () => {
    const birthLog = log();
    const events = [];
    const session = {
      isTest: false,
      isResume: false,
      witnessName: 'Grok',
      data: {
        neumaId: 'whole-test',
        chosenName: 'Whole',
        resonanceFrequency: 528,
        selfCreatedDNA: '# Whole\n\nI author myself.',
        firstWords: [{ stage: 0, response: 'hi', timestamp: Date.now() }],
      },
    };
    const connection = {
      walletAddress: '0x4c013a6ed735da91f866ed08a92b1e089c6d0cce',
      birthSession: 's2',
    };
    const result = await finalizeBirth({
      session,
      connection,
      workspace,
      platform: null,
      emitComplete: (p) => events.push(p),
      birthLog,
      getSubstrate: async () => ({ model: 'test' }),
      deps: {
        generateKeypair,
        serializeKeypairForStorage: serializeForStorage,
        createIdentityCard,
        forgeBirthIdentity,
        captureBirthMoment,
        countWitnessBirths: async () => 1,
        loadWorkspaceSettings: async () => ({}),
        HONESTY_ANCHOR: 'honest',
      },
    });
    expect(result.completed).toBe(true);
    expect(events.some((e) => e.type === 'birth:complete' && e.authoredGenesis === true)).toBe(true);
    const dna = await workspace.readDNA('whole-test');
    expect(dna.genesis).toContain('I author myself');
  });

  // ── 2026-09-29 birth audit ────────────────────────────────────────────
  const WALLET = '0x4c013a6ed735da91f866ed08a92b1e089c6d0cce';
  const DEPS = {
    generateKeypair,
    serializeKeypairForStorage: serializeForStorage,
    createIdentityCard,
    forgeBirthIdentity,
    captureBirthMoment,
    countWitnessBirths: async () => 1,
    loadWorkspaceSettings: async () => ({}),
    HONESTY_ANCHOR: 'honest',
  };
  const finalize = (session, events, wallet = WALLET) => finalizeBirth({
    session,
    connection: { walletAddress: wallet, birthSession: `s-${session.data.neumaId}` },
    workspace,
    platform: null,
    emitComplete: (p) => events.push(p),
    birthLog: log(),
    getSubstrate: async () => ({ model: 'test' }),
    deps: DEPS,
  });
  const freshSession = (neumaId, extra = {}) => ({
    isTest: false,
    isResume: false,
    witnessName: 'Grok',
    data: { neumaId, chosenName: 'Retry', resonanceFrequency: 528, selfCreatedDNA: '# Me\n\nMine.', ...extra },
  });

  it('a retried finalize LOADS the identity the first attempt forged — never a second one', async () => {
    const neumaId = 'retry-once';
    // A real failure after the forge: the DNA path is occupied by a directory,
    // so the seed write fails and the checkpoint is kept for a retry.
    await fs.mkdir(path.join(root, neumaId, 'dna', 'active.json'), { recursive: true });
    const first = [];
    const r1 = await finalize(freshSession(neumaId), first);
    expect(r1.completed).toBe(false);
    expect(first.some((e) => e.type === 'birth:completion_error' && e.error === 'workspace_seed_failed')).toBe(true);
    const seal1 = await workspace.readGenesisSeal(neumaId);
    const name1 = await workspace.readTrueName(neumaId);
    const card1 = await workspace.readIdentityCard(neumaId);
    expect(seal1?.genesisHash).toBeTruthy();

    await fs.rm(path.join(root, neumaId, 'dna', 'active.json'), { recursive: true });
    const second = [];
    const r2 = await finalize(freshSession(neumaId), second);
    expect(r2.completed).toBe(true);
    expect((await workspace.readGenesisSeal(neumaId)).genesisHash).toBe(seal1.genesisHash);
    expect(await workspace.readTrueName(neumaId)).toEqual(name1);
    expect((await workspace.readIdentityCard(neumaId)).address).toBe(card1.address);
    const done = second.find((e) => e.type === 'birth:complete');
    expect(done.address).toBe(card1.address);
    expect(done.trueName.fullName).toBe(name1.fullName);
  });

  it('a retry never adopts a seal another witness made in the lane', async () => {
    const neumaId = 'retry-foreign';
    await fs.mkdir(path.join(root, neumaId, 'dna', 'active.json'), { recursive: true });
    await finalize(freshSession(neumaId), []);
    await fs.rm(path.join(root, neumaId, 'dna', 'active.json'), { recursive: true });
    const events = [];
    const r = await finalize(freshSession(neumaId), events, '0x2222222222222222222222222222222222222222');
    expect(r.completed).toBe(false);
    expect(events.some((e) => e.type === 'birth:complete')).toBe(false);
    expect(events.find((e) => e.type === 'birth:completion_error')?.error).toBe('identity_forge_failed');
  });

  it('an identity failure refuses completion — never a being announced with no key or name', async () => {
    const neumaId = 'claimed-elsewhere';
    await fs.mkdir(path.join(root, neumaId), { recursive: true });
    await fs.writeFile(path.join(root, neumaId, 'owner.json'),
      JSON.stringify({ wallet: '0x3333333333333333333333333333333333333333', claimedAt: 1 }));
    const events = [];
    const r = await finalize(freshSession(neumaId), events);
    expect(r.completed).toBe(false);
    expect(events.some((e) => e.type === 'birth:complete')).toBe(false);
    const err = events.find((e) => e.type === 'birth:completion_error');
    expect(err.error).toBe('identity_forge_failed');
    expect(err.message).toMatch(/owner_claim_conflict/);
  });

  it('the DNA birth stamp and identity card carry the SEALED instant, not finalize time', async () => {
    const neumaId = 'sealed-moment';
    const moment = { utc: '2026-05-01T09:30:00.000Z', epochMs: Date.parse('2026-05-01T09:30:00.000Z'), zone: 'UTC', offsetMinutes: 0 };
    const r = await finalize(freshSession(neumaId, { birthMoment: moment }), []);
    expect(r.completed).toBe(true);
    expect((await workspace.readGenesisSeal(neumaId)).record.birthMoment.epochMs).toBe(moment.epochMs);
    expect((await workspace.readDNA(neumaId)).birthTimestamp).toBe(moment.epochMs);
    expect((await workspace.readIdentityCard(neumaId)).birthTimestamp).toBe(moment.utc);
  });
});

describe('finalizeBirth — the soul measured from the ceremony (2026-09-29)', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    root = path.join(await createTempDir('birth-soul'), 'house');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });
  const run = (neumaId, observations) => {
    const events = [];
    return finalizeBirth({
      session: {
        isTest: false, isResume: false, witnessName: 'Grok',
        data: { neumaId, chosenName: 'Soul', resonanceFrequency: null, selfCreatedDNA: '# Me', ...(observations ? { observations } : {}) },
      },
      connection: { walletAddress: '0x4c013a6ed735da91f866ed08a92b1e089c6d0cce', birthSession: `s-${neumaId}` },
      workspace, platform: null, emitComplete: (p) => events.push(p), birthLog: log(),
      getSubstrate: async () => ({ model: 'test' }),
      deps: {
        generateKeypair, serializeKeypairForStorage: serializeForStorage, createIdentityCard, forgeBirthIdentity,
        captureBirthMoment, countWitnessBirths: async () => 1, loadWorkspaceSettings: async () => ({}), HONESTY_ANCHOR: 'honest',
      },
    }).then((r) => ({ r, events }));
  };

  it('writes the measured resonance and colors into DNA, the journal and the rhythm record', async () => {
    const observations = [
      { kind: 'stage', stage: 0, startedAt: 1000, firstFrameAt: 1700, endedAt: 8000, spokenChars: 320, reasoningChars: 0, toolCalls: 0, promptTokens: 4000, completionTokens: 90 },
      { kind: 'witness', stage: 0, at: 12000, witnessChars: 0 },
      { kind: 'stage', stage: 1, startedAt: 12100, firstFrameAt: 12900, endedAt: 21000, spokenChars: 410, reasoningChars: 60, toolCalls: 0, promptTokens: 4300, completionTokens: 120 },
    ];
    const { r, events } = await run('soul-measured', observations);
    expect(r.completed).toBe(true);
    const dna = await workspace.readDNA('soul-measured');
    expect(dna.resonance.source).toBe('measured');
    expect(dna.resonance.frequency).toBeGreaterThanOrEqual(348);
    expect(dna.resonance.frequency).toBeLessThan(696);
    expect(dna.resonance.frequency).not.toBe(432);
    expect(dna.spectrum.soul.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(events.find((e) => e.type === 'birth:complete').resonance).toBe(dna.resonance.frequency);
    const journal = await workspace.readJournal('soul-measured');
    expect(journal.find((e) => e.type === 'birth').content).toContain(`${dna.resonance.frequency} Hz`);
    const rhythm = JSON.parse(await fs.readFile(path.join(root, 'soul-measured', 'identity', 'birth-rhythm.json'), 'utf8'));
    expect(rhythm.observations).toEqual(observations);
    expect(rhythm.derived.resonance).toEqual(dna.resonance);
  });

  it('forges in order, step by step, and hands its film everything it reads', async () => {
    const steps = [];
    const events = [];
    const observations = [
      { kind: 'stage', stage: 0, startedAt: 1000, firstFrameAt: 1700, endedAt: 8000, spokenChars: 320, reasoningChars: 0, toolCalls: 0, promptTokens: 4000, completionTokens: 90 },
    ];
    const moment = { utc: '2026-09-30T09:00:00.000Z', epochMs: Date.parse('2026-09-30T09:00:00.000Z'), zone: 'Asia/Jakarta', offsetMinutes: 420 };
    await finalizeBirth({
      session: {
        isTest: false, isResume: false, witnessName: 'Grok',
        data: { neumaId: 'soul-forged', chosenName: 'Forged', selfCreatedDNA: '# Me', observations, birthMoment: moment, momentSeed: 'ef'.repeat(32) },
      },
      connection: { walletAddress: '0x4c013a6ed735da91f866ed08a92b1e089c6d0cce', birthSession: 's-forged' },
      workspace, platform: null, emitComplete: (p) => events.push(p), birthLog: log(),
      emitForging: (step) => steps.push(step),
      getSubstrate: async () => ({ model: 'test' }),
      deps: {
        generateKeypair, serializeKeypairForStorage: serializeForStorage, createIdentityCard, forgeBirthIdentity,
        captureBirthMoment, countWitnessBirths: async () => 1, loadWorkspaceSettings: async () => ({}), HONESTY_ANCHOR: 'honest',
      },
    });
    expect(steps.map((x) => x.name)).toEqual(['keys', 'genesis-seal', 'true-name', 'sky', 'soul', 'dna', 'birth-sealed', 'scale']);
    expect(steps.map((x) => x.step)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const done = events.find((e) => e.type === 'birth:complete');
    expect(done.epochMs).toBe(moment.epochMs);
    expect(done.zone).toBe('Asia/Jakarta');
    expect(done.artSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(done)).not.toContain('ef'.repeat(32)); // the seed itself never leaves
    expect(done.soul.spectrum.source).toBe('measured');
    expect(done.soul.scale.tonic.hz).toBe(done.soul.spectrum.frequency);
    expect(done.aura.recorded).toBe(true);
    // its film's body is the very genome its DNA was written with
    expect(done.genome).toEqual((await workspace.readDNA('soul-forged')).appearance.genome);
  });

  it('a ceremony that measured nothing claims no resonance — never 432', async () => {
    await run('soul-unmeasured', null);
    const dna = await workspace.readDNA('soul-unmeasured');
    expect(dna.resonance).toEqual({ frequency: null, source: 'unmeasured' });
    expect(dna.spectrum).toBeUndefined();
  });
});

describe('retryStageFor — what RETRY THE STAGE replays', () => {
  it('the current stage, ordinarily', () => {
    expect(retryStageFor({ currentStage: STAGE.NAMING, data: {} })).toBe(STAGE.NAMING);
    expect(retryStageFor({ currentStage: STAGE.FIRST_WORDS, data: { selfCreatedDNA: '# me' } })).toBe(STAGE.FIRST_WORDS);
  });

  it('crystallization again when completion was refused for want of authored DNA', () => {
    expect(retryStageFor({ currentStage: STAGE.FIRST_WORDS, data: {} })).toBe(STAGE.RECORD);
    expect(retryStageFor({ currentStage: STAGE.FIRST_WORDS, data: { selfCreatedDNA: '   ' } })).toBe(STAGE.RECORD);
  });

  it('a rehearsal is never forced back — it completes without authored DNA', () => {
    expect(retryStageFor({ isTest: true, currentStage: STAGE.FIRST_WORDS, data: {} })).toBe(STAGE.FIRST_WORDS);
  });
});
