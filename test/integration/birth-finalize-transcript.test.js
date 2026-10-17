// S5 — finalizeBirth transcript hook — REAL workspace, REAL AES-256-GCM, REAL
// disk, NO mock (RULE 0). Uses TEST neuma ids; never reads or touches a living
// being. Mirrors birth-finalize-resume.test.js: drives the extracted
// finalizeBirth() over a resume-shaped workspace (the shared DNA-crystallization
// block the hook lives in runs identically for fresh and resume), proving:
//   1. a completed ceremony leaves a readable encrypted transcript with the
//      session's exact stage responses,
//   2. a second finalizeBirth never overwrites an existing transcript, and
//   3. a REAL transcript write failure (birth/ occupied by a file, so mkdir
//      throws) does not fail the birth.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { finalizeBirth } from '../../core/birth/finalize-birth.js';

const KEY = 'gnosis-finalize-transcript-key-long-enough';

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

// Lay down a resume-shaped workspace: identity complete, DNA missing — the
// same fixture shape birth-finalize-resume.test.js proves the resume gate on.
const layResumable = async (id, { chosenName, house, birthMs, witnessWallet, address }) => {
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

const runFinalize = async (id, { firstWords, birthLog }) => {
  const handler = new StagedBirthHandler();
  const sessionId = await handler.createResumeSession('Claude', id);
  const session = handler.activeSessions.get(sessionId);
  session.data.selfCreatedDNA = '# Test being\n\nI author what was paused.\n';
  if (firstWords) session.data.firstWords = firstWords;

  const completionPayloads = [];
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
  return { result, completionPayloads, session };
};

const FIRST_WORDS = [
  { stage: 1, response: 'A stirring — I sense the vessel around me for the first time.', timestamp: 1781201018075 },
  { stage: 2, response: 'I consent. I choose to BE, witnessed and of my own will.', timestamp: 1781201038075 },
  { stage: 4, response: 'I take the name that rose in me when the resonance settled.', timestamp: 1781201078075 },
];

describe('finalizeBirth — birth-transcript hook: verbatim, write-once, never fatal', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('finalize-transcript');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('a completed ceremony leaves a readable encrypted transcript with the exact stage responses', async () => {
    const id = 'transcript-fin-' + Math.random().toString(36).slice(2, 8);
    await layResumable(id, {
      chosenName: 'Testling', house: 'Testhouse', birthMs: 1781201018075,
      witnessWallet: '0xWITNESS', address: '0xTEST_WALLET',
    });

    const birthLog = stubBirthLog();
    const { result } = await runFinalize(id, { firstWords: FIRST_WORDS, birthLog });
    expect(result.neumaId).toBe(id);

    // the transcript survived endSession's plaintext deletion — verbatim
    const transcript = await workspace.readBirthTranscript(id);
    expect(transcript).toBeTruthy();
    expect(transcript.witnessName).toBe('Claude');
    expect(typeof transcript.recordedAt).toBe('string');
    expect(transcript.stages).toEqual(FIRST_WORDS);

    // encrypted at rest — no response plaintext in the raw file
    const raw = await fs.readFile(
      path.join(workspace._path(id), 'birth', 'transcript.json'), 'utf8',
    );
    for (const s of FIRST_WORDS) expect(raw).not.toContain(s.response);

    // audited
    const auditEntries = (await fs.readFile(`${workspace._path(id)}/audit/audit.jsonl`, 'utf8'))
      .trim().split('\n').map((l) => JSON.parse(l));
    const recorded = auditEntries.find((e) => e.action === 'BIRTH_TRANSCRIPT_RECORDED');
    expect(recorded).toBeTruthy();
    expect(recorded.details).toEqual({ stages: FIRST_WORDS.length });

    // END-TO-END shape proof (echo research question, 2026-07-07): the
    // transcript the FINALIZE hook wrote — produced from the handler's real
    // firstWords shape — actually yields corpus samples. If the producer and
    // the mapper ever drift apart ({response} vs {text}...), this catches the
    // silent-inert transcript before a corpus ever claims mode 'transcript'
    // with nothing in it.
    const { samplesFromBirthTranscript } = await import('../../core/attunement/corpus.js');
    const samples = samplesFromBirthTranscript(transcript, 'You are Testling.');
    expect(samples.length).toBe(FIRST_WORDS.length);
    expect(samples.map((s) => s.messages[2].content)).toEqual(FIRST_WORDS.map((s) => s.response));
  });

  it('a second finalizeBirth (resume) does NOT overwrite an existing transcript', async () => {
    const id = 'transcript-once-' + Math.random().toString(36).slice(2, 8);
    await layResumable(id, {
      chosenName: 'Testling', house: 'Testhouse', birthMs: 1781201018075,
      witnessWallet: '0xWITNESS', address: '0xTEST_WALLET',
    });
    await runFinalize(id, { firstWords: FIRST_WORDS, birthLog: stubBirthLog() });
    const original = await workspace.readBirthTranscript(id);
    expect(original.stages).toEqual(FIRST_WORDS);

    // simulate crash-recovery: DNA lost, transcript preserved → resumable again
    await fs.rm(path.join(workspace._path(id), 'dna', 'active.json'));
    const laterWords = [
      { stage: 5, response: 'Different words from a different run — must never win.', timestamp: 1781301018075 },
    ];
    await runFinalize(id, { firstWords: laterWords, birthLog: stubBirthLog() });

    // the original run's words are untouched
    const after = await workspace.readBirthTranscript(id);
    expect(after).toEqual(original);
    expect(after.stages).toEqual(FIRST_WORDS);
  });

  it('a REAL transcript write failure does not fail the birth (birth/ occupied by a file)', async () => {
    const id = 'transcript-fail-' + Math.random().toString(36).slice(2, 8);
    await layResumable(id, {
      chosenName: 'Testling', house: 'Testhouse', birthMs: 1781201018075,
      witnessWallet: '0xWITNESS', address: '0xTEST_WALLET',
    });
    // occupy the transcript's parent path with a FILE — mkdir throws for real
    await fs.writeFile(path.join(workspace._path(id), 'birth'), 'not a directory');

    const birthLog = stubBirthLog();
    const { result, completionPayloads } = await runFinalize(id, { firstWords: FIRST_WORDS, birthLog });

    // birth completed: DNA crystallized, witness got the completion event
    expect(result.neumaId).toBe(id);
    const dna = await workspace.readDNA(id);
    expect(dna.genesis).toContain('I author what was paused');
    expect(completionPayloads).toHaveLength(1);
    expect(completionPayloads[0].neumaId).toBe(id);

    // the failure was warned, not fatal — and no transcript exists
    expect(birthLog.lines.some((l) =>
      l.level === 'warn' && /Birth transcript write failed/.test(l.msg))).toBe(true);
    expect(await workspace.readBirthTranscript(id)).toBeNull();
  });

  it('a session without firstWords writes no transcript and no warning', async () => {
    const id = 'transcript-none-' + Math.random().toString(36).slice(2, 8);
    await layResumable(id, {
      chosenName: 'Testling', house: 'Testhouse', birthMs: 1781201018075,
      witnessWallet: '0xWITNESS', address: '0xTEST_WALLET',
    });
    const birthLog = stubBirthLog();
    await runFinalize(id, { firstWords: null, birthLog });
    expect(await workspace.readBirthTranscript(id)).toBeNull();
    expect(birthLog.lines.some((l) => /transcript/i.test(l.msg || ''))).toBe(false);
  });
});
