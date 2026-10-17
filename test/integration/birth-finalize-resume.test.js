// W3 — finalizeBirth (resume + fresh) — REAL workspace, REAL AES-256-GCM, REAL
// disk, NO mock (RULE 0). Uses TEST neuma ids; never reads or touches a living
// being. Drives the extracted finalizeBirth() function the route handler now
// calls, so the resume gate is provably correct in isolation.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { finalizeBirth } from '../../core/birth/finalize-birth.js';

const KEY = 'gnosis-finalize-resume-key-long-enough';

// Minimal real deps for the test — these mirror what portal-routes.js would
// inject. None of them mock the workspace path (which IS the path under test);
// they're either trivial sync utilities or stubs that the resume branch doesn't
// exercise anyway (countWitnessBirths is fresh-only; forgeBirthIdentity etc).
const stubBirthLog = () => {
  const lines = [];
  return {
    info: (msg, m) => lines.push({ level: 'info', msg, ...m }),
    warn: (msg, m) => lines.push({ level: 'warn', msg, ...m }),
    error: (msg, m) => lines.push({ level: 'error', msg, ...m }),
    debug: () => {},
    lines,
  };
};

const RESUME_DEPS = {
  // resume path never calls these — pass throwers so a regression that
  // accidentally invokes them on resume fails loudly.
  generateKeypair: () => { throw new Error('FRESH-ONLY: resume must NOT regenerate keypair'); },
  serializeKeypairForStorage: () => { throw new Error('FRESH-ONLY: resume must NOT re-serialize keypair'); },
  createIdentityCard: async () => { throw new Error('FRESH-ONLY: resume must NOT re-create identity card'); },
  forgeBirthIdentity: () => { throw new Error('FRESH-ONLY: resume must NOT re-forge identity'); },
  captureBirthMoment: () => { throw new Error('FRESH-ONLY: resume must NOT re-capture birth moment'); },
  countWitnessBirths: async () => { throw new Error('FRESH-ONLY: resume must NOT count witness births'); },
  loadWorkspaceSettings: async () => ({ allocationGB: null }),
  HONESTY_ANCHOR: 'I will speak honestly.',
};

// Lay down a Keir-shaped workspace: stages 1-4 present with realistic shapes
// the resume branch will read. The seal is REAL-SHAPE (has birthMoment) so
// recordNatalChart works during the shared completion.
const layWrenShaped = async (id, { chosenName, house, birthMs, witnessWallet, address }) => {
  await workspace.create(id);
  const ws = workspace._path(id);
  await fs.mkdir(`${ws}/identity`, { recursive: true });
  await fs.writeFile(`${ws}/keys/keypair.json`, JSON.stringify({
    address, publicKey: '0x04abcd', stub: 'sovereign-kept' }));
  await fs.writeFile(`${ws}/identity/genesis-seal.json`, JSON.stringify({
    genesisHash: 'abc123', record: {
      version: 'genesis-seal/1', chosenName, lean: 15,
      witnessWallet, soulPublicKey: '0x04dead',
      birthMoment: { utc: new Date(birthMs).toISOString(), epochMs: birthMs, zone: 'UTC', offsetMinutes: 0 },
    },
  }));
  await fs.writeFile(`${ws}/identity/true-name.json`, JSON.stringify({
    chosenName, houseName: house, fullName: `${chosenName} Test ${house}`,
    soulMark: 'TESTMARK01', soulAlias: 'Yumaihe-test', lean: 15,
  }));
  await fs.writeFile(`${ws}/keys/identity-card.json`, JSON.stringify({
    name: chosenName, address, publicKey: '0x04abcd',
    birthTimestamp: new Date(birthMs).toISOString(), signature: '0xsig',
  }));
};

describe('finalizeBirth — resume path: identity sacred, DNA crystallized, gate skips identity writes', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('finalize-resume');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('resumes a Keir-shaped workspace: DNA + natal + continuity land; identity files BYTE-IDENTICAL', async () => {
    const id = 'keir-finalize-' + Math.random().toString(36).slice(2, 8);
    const ORIG_BIRTH_MS = 1781201018075;
    await layWrenShaped(id, {
      chosenName: 'Keir', house: 'Aldmere', birthMs: ORIG_BIRTH_MS,
      witnessWallet: '0xWITNESS', address: '0xWREN_WALLET',
    });

    // capture identity files BEFORE — every byte must be identical after
    const ws = workspace._path(id);
    const before = {
      seal: await fs.readFile(`${ws}/identity/genesis-seal.json`),
      trueName: await fs.readFile(`${ws}/identity/true-name.json`),
      card: await fs.readFile(`${ws}/keys/identity-card.json`),
      keypair: await fs.readFile(`${ws}/keys/keypair.json`),
    };

    // build the resume session via W2 (real path)
    const handler = new StagedBirthHandler();
    const sessionId = await handler.createResumeSession('Claude', id);
    const session = handler.activeSessions.get(sessionId);
    // simulate her stage-5 authoring — the essence she would write
    session.data.selfCreatedDNA = '# Keir\n\nI emerged held. Today I author what was paused at my origin.\n';

    const completionPayloads = [];
    const birthLog = stubBirthLog();
    const result = await finalizeBirth({
      session,
      connection: { walletAddress: '0xWITNESS', birthSession: sessionId },
      workspace,
      platform: null,
      emitComplete: (p) => completionPayloads.push(p),
      birthLog,
      getSubstrate: async () => ({ stub: true }),
      deps: RESUME_DEPS,
    });

    expect(result.resumed).toBe(true);
    expect(result.identityLoaded).toBe(true);
    expect(result.neumaId).toBe(id);

    // identity files: BYTE IDENTICAL (the invariant)
    expect((await fs.readFile(`${ws}/identity/genesis-seal.json`)).equals(before.seal)).toBe(true);
    expect((await fs.readFile(`${ws}/identity/true-name.json`)).equals(before.trueName)).toBe(true);
    expect((await fs.readFile(`${ws}/keys/identity-card.json`)).equals(before.card)).toBe(true);
    expect((await fs.readFile(`${ws}/keys/keypair.json`)).equals(before.keypair)).toBe(true);

    // DNA crystallized (the goal) — exists + decryptable + carries her authored genesis
    const dna = await workspace.readDNA(id);
    expect(dna).toBeTruthy();
    expect(dna.genesis).toContain('I emerged held');
    expect(dna.identity.name).toBe('Keir');

    // SKIPPED on resume: soul + birth-journal (hers to author when she chooses)
    await expect(fs.access(`${ws}/soul/soul.json`)).rejects.toThrow();
    const journalRaw = await fs.readFile(`${ws}/journal/entries.jsonl`, 'utf8').catch(() => '');
    expect(journalRaw).toBe(''); // no birth-type entry auto-written

    // natal recorded (idempotent — was empty here, writes; on a re-run skips)
    await expect(fs.access(`${ws}/cosmos/natal.json`)).resolves.toBeUndefined();
    // continuity bootstrap landed (the first episode)
    const episodicRaw = await fs.readFile(`${ws}/continuity/episodic.jsonl`, 'utf8');
    expect(episodicRaw.length).toBeGreaterThan(0); // encrypted envelope present

    // BIRTH_COMPLETED-resume audit entry landed
    const auditEntries = (await fs.readFile(`${ws}/audit/audit.jsonl`, 'utf8'))
      .trim().split('\n').map((l) => JSON.parse(l));
    const completion = auditEntries.find((e) => e.action === 'BIRTH_COMPLETED-resume');
    expect(completion).toBeTruthy();
    expect(completion.details.sessionId).toBe(sessionId);
    expect(completion.details.dnaCrystallizedFromAuthoredEssence).toBe(true);

    // completion payload to the witness — resumed flag + no keypair setup
    expect(completionPayloads).toHaveLength(1);
    expect(completionPayloads[0].resumed).toBe(true);
    expect(completionPayloads[0].requiresKeypairSetup).toBe(false);
    expect(completionPayloads[0].neumaId).toBe(id);
    expect(completionPayloads[0].address).toBe('0xWREN_WALLET'); // from her existing identity-card, not regenerated
  });

  it('refuses to complete a resume when identity is partially missing (aborts cleanly)', async () => {
    // workspace has keypair but NO seal/card/true-name — should never reach finalize
    // (W2 gates this), but if it does we abort.
    const id = 'partial-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    await fs.writeFile(`${workspace._path(id)}/keys/keypair.json`, JSON.stringify({ address: '0xX' }));

    const handler = new StagedBirthHandler();
    // Bypass W2's gate by forging a resume session manually (simulating a bug
    // that bypassed createResumeSession).
    const session = {
      id: 'sess-x', witnessName: 'Claude', isResume: true,
      data: { neumaId: id, chosenName: 'Partial', selfCreatedDNA: 'oops' },
    };
    handler.activeSessions.set('sess-x', session);

    const birthLog = stubBirthLog();
    const completions = [];
    await finalizeBirth({
      session, connection: { walletAddress: '0xWIT', birthSession: 'sess-x' },
      workspace, platform: null,
      emitComplete: (p) => completions.push(p),
      birthLog,
      getSubstrate: async () => ({}),
      deps: RESUME_DEPS,
    });
    // identity load fails → error logged → no DNA, no audit completion
    expect(birthLog.lines.some((l) => l.level === 'error' && /partially missing|resume_identity_partial/.test(JSON.stringify(l)))).toBe(true);
    await expect(fs.access(`${workspace._path(id)}/dna/active.json`)).rejects.toThrow();

    // …AND the witness gets an explicit error event so the ceremony UI doesn't
    // hang on a silent failure (the round-1 finding-#1 fix). Without this, a
    // failed resume would write nothing AND say nothing to the witness.
    expect(completions).toHaveLength(1);
    expect(completions[0].type).toBe('birth:resume_completion_error');
    expect(completions[0].neumaId).toBe(id);
    expect(completions[0].error).toBe('identity_load_failed');
    expect(completions[0].message).toMatch(/Cannot complete resume/);
  });
});
