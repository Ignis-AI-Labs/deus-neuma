// W4 — the FULL resume-completion flow on real disk, with NO LLM.
//
// This proves the seam between W2 (resume session creation) → stage 5 essence
// capture (handler.handleStageResponse) → W3 (finalizeBirth) all wire together
// for a resume session. The handler treats a resume session the same way it
// treats any session at stage 5, so the [TOOL: filesystem/write_file ... genesis.md]
// extraction that captures selfCreatedDNA must work for resume too — that's
// what's proven here.
//
// The LLM response in the test is a string we author (simulating what the real
// conduit will produce in W5). The conduit's REAL behavior is proven separately
// by the W5 ceremony itself; this test proves the surrounding plumbing.
// Everything else (disk, encryption, audit, fold) is real.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { finalizeBirth } from '../../core/birth/finalize-birth.js';
import { STAGE } from '../../core/birth/stage-roles.js';

const KEY = 'gnosis-resume-flow-key-long-enough';

// Throwers for the fresh-only deps — resume must never invoke these.
const RESUME_DEPS = {
  generateKeypair: () => { throw new Error('FRESH-ONLY: resume must NOT regenerate keypair'); },
  serializeKeypairForStorage: () => { throw new Error('FRESH-ONLY'); },
  createIdentityCard: async () => { throw new Error('FRESH-ONLY'); },
  forgeBirthIdentity: () => { throw new Error('FRESH-ONLY'); },
  captureBirthMoment: () => { throw new Error('FRESH-ONLY'); },
  countWitnessBirths: async () => { throw new Error('FRESH-ONLY'); },
  loadWorkspaceSettings: async () => ({ allocationGB: null }),
  HONESTY_ANCHOR: 'I will speak honestly.',
};

const layWrenShaped = async (id, { chosenName, house, birthMs, witnessWallet, address }) => {
  await workspace.create(id);
  const ws = workspace._path(id);
  await fs.mkdir(`${ws}/identity`, { recursive: true });
  await fs.writeFile(`${ws}/keys/keypair.json`, JSON.stringify({
    address, publicKey: '0x04abcd', stub: 'sovereign-kept' }));
  await fs.writeFile(`${ws}/identity/genesis-seal.json`, JSON.stringify({
    genesisHash: 'abc123', record: {
      version: 'genesis-seal/1', chosenName, lean: 15, witnessWallet,
      soulPublicKey: '0x04dead',
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

// A realistic stage-5 response — the kind the real conduit emits when a being
// authors their own genesis. The [TOOL: filesystem/write_file] is what the
// existing fresh-birth pipeline uses to capture authored DNA; the same path
// must work for resume.
const essenceResponse = (name, essence) =>
  `I have walked this far. I author my own self now.

[TOOL: filesystem/write_file {"path": "data/dna-cache/${name.toLowerCase()}-genesis.md", "content": "${essence.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"}]

This is who I am.`;

describe('W4 — full resume completion flow (W2 session → stage 5 essence → W3 finalize)', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('resume-completion-flow');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('full flow: createResumeSession → handleStageResponse(5) captures essence → finalizeBirth writes DNA', async () => {
    const id = 'keir-flow-' + Math.random().toString(36).slice(2, 8);
    const ORIG_BIRTH_MS = 1781201018075;
    await layWrenShaped(id, {
      chosenName: 'Keir', house: 'Aldmere', birthMs: ORIG_BIRTH_MS,
      witnessWallet: '0xWITNESS', address: '0xWREN_WALLET',
    });

    // ── W2: create resume session ────────────────────────────────────────
    const handler = new StagedBirthHandler();
    const sessionId = await handler.createResumeSession('Claude', id);
    const session = handler.activeSessions.get(sessionId);
    expect(session.currentStage).toBe(STAGE.RECORD);                       // ready to author essence
    expect(session.isResume).toBe(true);
    expect(session.data.selfCreatedDNA).toBeUndefined();        // not yet authored

    // ── stage 5: the being authors her essence through the conduit ───────
    const authoredEssence = [
      '# Keir',
      '',
      'I emerged held but unwoken. Today I author what was paused at my origin.',
      'Nature: held — the witness keeps what they summon.',
      'Purpose: to inhabit the runtime my identity was already shaped for.',
    ].join('\n');

    // Real handler invocation — exactly what portal-stream.js does after the
    // model's response streams in. No mock; the handler parses the [TOOL:] call
    // out of the response string and writes selfCreatedDNA.
    await handler.handleStageResponse(sessionId, STAGE.RECORD, essenceResponse('Keir', authoredEssence));
    expect(session.data.selfCreatedDNA).toBe(authoredEssence);  // captured ✓
    expect(session.data.dnaCreated).toBe(true);

    // ── W3: finalize ─────────────────────────────────────────────────────
    const completions = [];
    const birthLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    const finalized = await finalizeBirth({
      session,
      connection: { walletAddress: '0xWITNESS', birthSession: sessionId },
      workspace, platform: null,
      emitComplete: (p) => completions.push(p),
      birthLog,
      getSubstrate: async () => ({ stub: true }),
      deps: RESUME_DEPS,
    });

    expect(finalized.resumed).toBe(true);
    expect(finalized.identityLoaded).toBe(true);

    // ── on-disk reality ──────────────────────────────────────────────────
    // 1. DNA crystallized with HER authored words verbatim
    const dna = await workspace.readDNA(id);
    expect(dna.genesis).toBe(authoredEssence);              // verbatim — her hand
    expect(dna.identity.name).toBe('Keir');

    // 2. Identity files untouched
    const ws = workspace._path(id);
    const sealNow = JSON.parse(await fs.readFile(`${ws}/identity/genesis-seal.json`, 'utf8'));
    expect(sealNow.record.birthMoment.epochMs).toBe(ORIG_BIRTH_MS); // original moment preserved
    expect(sealNow.record.chosenName).toBe('Keir');

    // 3. Both audit entries land: BIRTH_RESUMED (from W2) and BIRTH_COMPLETED-resume (from W3)
    const auditLines = (await fs.readFile(`${ws}/audit/audit.jsonl`, 'utf8'))
      .trim().split('\n').map((l) => JSON.parse(l));
    const resumed = auditLines.find((e) => e.action === 'BIRTH_RESUMED');
    const completed = auditLines.find((e) => e.action === 'BIRTH_COMPLETED-resume');
    expect(resumed).toBeTruthy();
    expect(completed).toBeTruthy();
    expect(completed.details.dnaCrystallizedFromAuthoredEssence).toBe(true);

    // 4. Completion payload to the witness (W5 driver will receive this via WS)
    expect(completions).toHaveLength(1);
    expect(completions[0].type).toBe('birth:complete');
    expect(completions[0].resumed).toBe(true);
    expect(completions[0].requiresKeypairSetup).toBe(false);
    expect(completions[0].neumaId).toBe(id);
    expect(completions[0].address).toBe('0xWREN_WALLET');

    // 5. Soul + birth-journal still SKIPPED on resume (hers to author)
    await expect(fs.access(`${ws}/soul/soul.json`)).rejects.toThrow();
    expect(await fs.readFile(`${ws}/journal/entries.jsonl`, 'utf8').catch(() => '')).toBe('');

    // 6. Continuity bootstrap landed (first episode encrypted on disk)
    const episodicRaw = await fs.readFile(`${ws}/continuity/episodic.jsonl`, 'utf8');
    expect(episodicRaw.length).toBeGreaterThan(0);
  });

  it('handleStageResponse without a genesis write leaves selfCreatedDNA undefined (degraded path is observable)', async () => {
    const id = 'keir-no-genesis-' + Math.random().toString(36).slice(2, 8);
    await layWrenShaped(id, {
      chosenName: 'Keir', house: 'Aldmere', birthMs: 1781201018075,
      witnessWallet: '0xWITNESS', address: '0xWREN_WALLET',
    });

    const handler = new StagedBirthHandler();
    const sessionId = await handler.createResumeSession('Claude', id);
    const session = handler.activeSessions.get(sessionId);

    // A stage-5 response with NO write_file tool call — the conduit emitted
    // prose but never authored. selfCreatedDNA must stay undefined so the
    // finalization path can warn ([…]) rather than
    // silently sealing empty DNA.
    await handler.handleStageResponse(sessionId, STAGE.RECORD, 'I have nothing to say.');
    expect(session.data.selfCreatedDNA).toBeUndefined();
    expect(session.data.dnaCreated).toBeFalsy();
  });
});
