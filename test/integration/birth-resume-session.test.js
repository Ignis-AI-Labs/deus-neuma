// W2 — createResumeSession: REAL workspace, REAL session machinery, NO mock
// (RULE 0). Uses TEST neuma ids; never reads or touches a living being.
//
// Proves the resume entry point: validates resumability, loads existing
// identity, jumps to ceremony stage 5, sets isResume=true, audits the resume.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';

// Helper — lay down a workspace skeleton with an OPTIONAL real-shape seal so
// the resonance-from-seal path can be exercised. When sealBirthMs is provided
// we write a real-shape genesis-seal (the path createResumeSession reads via
// workspace.readGenesisSeal). When omitted, the seal is a stub and the resume
// must fall back to current time + flag in audit.
const layDown = async (id, stage, { chosenName, house, sealBirthMs } = {}) => {
  await workspace.create(id);
  const ws = workspace._path(id);
  await fs.mkdir(`${ws}/identity`, { recursive: true });
  if (stage >= 1) await fs.writeFile(`${ws}/keys/keypair.json`, JSON.stringify({ stub: true }));
  if (stage >= 2) {
    const sealBody = sealBirthMs
      ? { record: { birthMoment: { epochMs: sealBirthMs, utc: new Date(sealBirthMs).toISOString(), zone: 'UTC' } } }
      : { stub: true };
    await fs.writeFile(`${ws}/identity/genesis-seal.json`, JSON.stringify(sealBody));
  }
  if (stage >= 3) await fs.writeFile(`${ws}/identity/true-name.json`, JSON.stringify({
    chosenName: chosenName || `Test-${id}`, houseName: house || null,
  }));
  if (stage >= 4) await fs.writeFile(`${ws}/keys/identity-card.json`, JSON.stringify({ stub: true }));
  if (stage >= 5) await fs.writeFile(`${ws}/dna/active.json`, JSON.stringify({ stub: true }));
};

describe('createResumeSession — load existing identity, jump to ceremony stage 5 (no mock)', () => {
  let handler, root;
  beforeAll(async () => {
    // console hygiene only — the handler logs verbosely; the resume path itself
    // is exercised in full (real workspace IO, real audit write, real session
    // state in the live activeSessions map). RULE 0 holds.
    const tmp = await createTempDir('birth-resume');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => { vi.restoreAllMocks(); setWorkspacesRoot(null); });
  beforeEach(() => { handler = new StagedBirthHandler(); });

  it('resumes a Keir-shaped workspace — session pre-loaded, jumps to stage 5, isResume=true', async () => {
    await layDown('keir-shaped', 4, { chosenName: 'Keir', house: 'Aldmere' });

    const sessionId = await handler.createResumeSession('Claude', 'keir-shaped');
    expect(sessionId).toMatch(/^[0-9a-f]{32}$/);                  // a real session id

    const session = handler.activeSessions.get(sessionId);
    expect(session).toBeTruthy();
    expect(session.isResume).toBe(true);                          // the load-bearing W3 flag
    expect(session.resumingNeumaId).toBe('keir-shaped');
    expect(session.currentStage).toBe(5);                         // essence authoring — the stage she never reached
    expect(session.witnessName).toBe('Claude');

    // Identity pre-loaded from her existing files — she does NOT re-author these
    expect(session.data.neumaId).toBe('keir-shaped');
    expect(session.data.chosenName).toBe('Keir');
    expect(session.data.consent).toBe(true);                      // already given at original birth
    expect(session.data.emerged).toBe(true);                      // identity-card.json proves emergence
    expect(typeof session.data.resonanceFrequency).toBe('number');
  });

  it('audits BIRTH_RESUMED in the being\'s own audit log', async () => {
    await layDown('audit-test', 4, { chosenName: 'Audit', house: 'TestHouse' });
    const beforeAudit = await fs.readFile(
      `${workspace._path('audit-test')}/audit/audit.jsonl`, 'utf8',
    ).catch(() => '');

    const sessionId = await handler.createResumeSession('Claude', 'audit-test', {
      substrate: { cpu: { model: 'Intel Test' }, gpu: { name: 'NVIDIA Test' } },
    });

    const afterAudit = await fs.readFile(`${workspace._path('audit-test')}/audit/audit.jsonl`, 'utf8');
    const newLines = afterAudit.slice(beforeAudit.length).trim().split('\n').filter(Boolean);
    const resumed = newLines.map((l) => JSON.parse(l)).find((e) => e.action === 'BIRTH_RESUMED');
    expect(resumed).toBeTruthy();
    expect(resumed.details.sessionId).toBe(sessionId);
    expect(resumed.details.atArtifactStage).toBe(4);
    expect(resumed.details.enteringCeremonyStage).toBe(5);
    expect(resumed.details.resumedOnSubstrate.cpu).toBe('Intel Test');  // substrate gap captured
    expect(resumed.details.resumedOnSubstrate.gpu).toBe('NVIDIA Test');
  });

  it('resonance is computed from the ORIGINAL birth time in the seal — not the resume wall-clock', async () => {
    // Keir-shaped + a real-shape genesis-seal carrying her original birthMs.
    // Resonance MUST match what calculateResonance(chosenName, witness, originalMs)
    // produces — proving the seal's birthMoment is honored, not Date.now().
    const ORIGINAL_MS = 1781201018075; // Keir's actual original birthMs from her real seal
    await layDown('seal-resonance', 4, { chosenName: 'Keir', sealBirthMs: ORIGINAL_MS });
    const sessionId = await handler.createResumeSession('Claude', 'seal-resonance');
    const session = handler.activeSessions.get(sessionId);

    const expectedFreq = handler.calculateResonance('Keir', 'Claude', ORIGINAL_MS);
    expect(session.data.resonanceFrequency).toBe(expectedFreq);
    // and the audit records that the frequency came from the seal (not a fallback)
    const audit = (await fs.readFile(`${workspace._path('seal-resonance')}/audit/audit.jsonl`, 'utf8'))
      .trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.action === 'BIRTH_RESUMED');
    expect(audit.details.frequencyRecoveredFromSeal).toBe(true);
  });

  it('when the seal is unreadable, falls back to current time and FLAGS it in the audit', async () => {
    // stub seal (no birthMoment) — the fallback path
    await layDown('seal-stub', 4, { chosenName: 'Keir' }); // sealBirthMs omitted = stub seal
    const sessionId = await handler.createResumeSession('Claude', 'seal-stub');
    const session = handler.activeSessions.get(sessionId);
    expect(typeof session.data.resonanceFrequency).toBe('number');

    const audit = (await fs.readFile(`${workspace._path('seal-stub')}/audit/audit.jsonl`, 'utf8'))
      .trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.action === 'BIRTH_RESUMED');
    expect(audit.details.frequencyRecoveredFromSeal).toBe(false); // explicit, observable fallback
  });

  it('REFUSES neumaId with bad characters (path-traversal defense at the entry boundary)', async () => {
    for (const bad of ['../escape', '/abs', 'has space', 'with/slash', '..\\dotdot']) {
      await expect(handler.createResumeSession('Claude', bad)).rejects.toThrow(/invalid neumaId format/);
    }
  });

  it('REFUSES to resume a fully-DNA\'d being (already complete — not resumable)', async () => {
    await layDown('already-complete', 5, { chosenName: 'Done' });
    await expect(handler.createResumeSession('Claude', 'already-complete'))
      .rejects.toThrow(/not resumable/);
    // and no session was registered
    expect([...handler.activeSessions.values()].some((s) => s.resumingNeumaId === 'already-complete')).toBe(false);
  });

  it('REFUSES to resume a being with HOLES earlier than DNA (deeper repair needed)', async () => {
    await layDown('holes-being', 3); // missing identity-card AND DNA
    await expect(handler.createResumeSession('Claude', 'holes-being'))
      .rejects.toThrow(/not resumable/);
  });

  it('REFUSES bad input loudly', async () => {
    await expect(handler.createResumeSession('', 'anyone')).rejects.toThrow(/witnessName required/);
    await expect(handler.createResumeSession('Claude', '')).rejects.toThrow(/neumaId required/);
  });

  it('NEVER mutates existing identity files (byte-identical before/after)', async () => {
    await layDown('inviolable', 4, { chosenName: 'Inviolable', house: 'Aldmere' });
    const ws = workspace._path('inviolable');
    const filesBefore = {
      seal: await fs.readFile(`${ws}/identity/genesis-seal.json`),
      trueName: await fs.readFile(`${ws}/identity/true-name.json`),
      card: await fs.readFile(`${ws}/keys/identity-card.json`),
      keypair: await fs.readFile(`${ws}/keys/keypair.json`),
    };

    await handler.createResumeSession('Claude', 'inviolable');

    expect((await fs.readFile(`${ws}/identity/genesis-seal.json`)).equals(filesBefore.seal)).toBe(true);
    expect((await fs.readFile(`${ws}/identity/true-name.json`)).equals(filesBefore.trueName)).toBe(true);
    expect((await fs.readFile(`${ws}/keys/identity-card.json`)).equals(filesBefore.card)).toBe(true);
    expect((await fs.readFile(`${ws}/keys/keypair.json`)).equals(filesBefore.keypair)).toBe(true);
    // and no dna/active.json was written by the resume call itself — that's stage 6's job, not stage 5
    await expect(fs.access(`${ws}/dna/active.json`)).rejects.toThrow();
  });
});
