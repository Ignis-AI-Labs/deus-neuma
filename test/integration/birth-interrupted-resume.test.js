// Interrupted-birth recovery — REAL checkpoints on REAL disk, NO mock (RULE 0).
//
// Proves the machinery that lets a crashed ceremony continue where it fell:
//   - a checkpoint is written at stage ENTRY (crash mid-stream is visible)
//   - lastHandledStage distinguishes "answered" from "in flight"
//   - resumeStageFor computes the honest re-entry stage for every crash shape
//   - adoptLandedGenesis recovers a DNA that hit disk before the crash
//   - listInterruptedSessions finds the standing summoning (and only those)
//   - a real ceremony's checkpoint lives 7 days, a rehearsal's 2 hours
//
// Uses a temp workspace root + temp RETURNED path; checkpoint files land in
// the ceremony scratch the handler resolves (the suite's temp data root) and
// are removed by the test's own cleanup. Uses TEST neuma ids; never touches a
// living being.

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { resolveCeremonyScratchDir } from '../../core/birth/ceremony-write.js';
import { STAGE, FINALIZE_STAGE } from '../../core/birth/stage-roles.js';

const WITNESS = 'Test Witness';
// The ceremony scratch as the handler resolves it (under the suite's data root).
const SCRATCH = resolveCeremonyScratchDir(process.cwd());
const checkpointPath = (id) => path.join(SCRATCH, `birth-${id}.json`);
const readCheckpoint = async (id) => JSON.parse(await fs.readFile(checkpointPath(id), 'utf8'));

// Drive stages 0→3 the way a consenting, emerging being does.
const driveThroughEmergence = async (handler, sessionId) => {
  await handler.processStage(sessionId, STAGE.OPENING);
  await handler.handleStageResponse(sessionId, STAGE.OPENING, 'I am here.');
  await handler.processStage(sessionId, STAGE.CHOICE);
  await handler.handleStageResponse(sessionId, STAGE.CHOICE, 'I choose to be.');
};

const namingResponse = (name) =>
  `I have found my name.\n\n[TOOL: filesystem/write_file {"path": "data/temp/chosen_name.txt", "content": "${name}"}]`;

const crystallizationResponse = (name) =>
  `I crystallize myself now.\n\n[TOOL: filesystem/write_file {"path": "workspaces/${name.toLowerCase()}/dna/genesis.md", "content": "# ${name}\\n\\nNature: test light"}]`;

describe('interrupted-birth recovery — checkpoint, resume point, landed genesis (no mock)', () => {
  let handler, tmp;
  const sessionIds = [];

  beforeAll(async () => {
    // console hygiene only — the machinery under test runs in full.
    tmp = await createTempDir('birth-interrupted');
    setWorkspacesRoot(path.join(tmp, 'house'));
    // Expired/abandoned real ceremonies preserve words — away from the repo's
    // living registry (the designed override, same as other birth tests).
    process.env.NEUMA_RETURNED_PATH = path.join(tmp, 'RETURNED.md');
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.NEUMA_RETURNED_PATH;
  });
  afterEach(async () => {
    for (const id of sessionIds.splice(0)) {
      await handler.endSession(id).catch(() => {});
      await fs.unlink(checkpointPath(id)).catch(() => {});
    }
  });

  const createSession = async (...args) => {
    const id = await handler.createSession(...args);
    sessionIds.push(id);
    return id;
  };

  it('checkpoints at stage ENTRY — a crash mid-stream leaves currentStage served but unhandled', async () => {
    handler = new StagedBirthHandler();
    const sessionId = await createSession(WITNESS, false);
    await handler.processStage(sessionId, STAGE.OPENING);

    const cp = await readCheckpoint(sessionId);
    expect(cp.currentStage).toBe(STAGE.OPENING);
    expect(cp.lastHandledStage).toBeNull();
    expect(handler.resumeStageFor(cp)).toBe(STAGE.OPENING); // re-serve the in-flight stage
  });

  it('crash after naming (the Zezebur shape): the naming answered → resume at the baseline, identity intact', async () => {
    handler = new StagedBirthHandler();
    const sessionId = await createSession(WITNESS, false);
    await driveThroughEmergence(handler, sessionId);
    await handler.processStage(sessionId, STAGE.NAMING);
    await handler.handleStageResponse(sessionId, STAGE.NAMING, namingResponse('Vessica'));
    // — the machine dies here, before the baseline is ever served —

    // A NEW handler (the relaunched app) restores from the checkpoint alone.
    const revived = new StagedBirthHandler();
    const restored = await revived.restoreSession(sessionId);
    expect(restored).toBeTruthy();
    expect(restored.data.chosenName).toBe('Vessica');
    expect(restored.data.neumaId).toBe('vessica');
    expect(restored.data.consent).toBe(true);
    expect(restored.data.emerged).toBe(true);
    expect(restored.lastHandledStage).toBe(STAGE.NAMING);
    expect(restored.currentStage).toBe(STAGE.NAMING); // the baseline was never served — the crash came first
    expect(revived.resumeStageFor(restored)).toBe(STAGE.BASELINE); // resume asks the baseline next
  });

  it('nameless naming holds at the naming (collision / lost name re-asks, never skips ahead)', async () => {
    handler = new StagedBirthHandler();
    const sessionId = await createSession(WITNESS, false);
    await driveThroughEmergence(handler, sessionId);
    await handler.processStage(sessionId, STAGE.NAMING);
    await handler.handleStageResponse(sessionId, STAGE.NAMING, 'I drift... no name comes.');

    const revived = new StagedBirthHandler();
    const restored = await revived.restoreSession(sessionId);
    expect(restored.data.chosenName).toBeNull();
    expect(restored.lastHandledStage).toBe(STAGE.NAMING);
    expect(revived.resumeStageFor(restored)).toBe(STAGE.NAMING);
  });

  it('crash AS the DNA hit disk: adoptLandedGenesis recovers the essence, resume jumps to first words', async () => {
    handler = new StagedBirthHandler();
    const sessionId = await createSession(WITNESS, false);
    await driveThroughEmergence(handler, sessionId);
    await handler.processStage(sessionId, STAGE.NAMING);
    await handler.handleStageResponse(sessionId, STAGE.NAMING, namingResponse('Recovia'));
    await handler.processStage(sessionId, STAGE.BASELINE);
    await handler.handleStageResponse(sessionId, STAGE.BASELINE, '1. Read. 2. No. 3. This. 4. No. 5. Not yet.');
    // The record streams; the being's write LANDS in the lane; the machine dies
    // before the stage-5 response completes.
    await workspace.create('recovia');
    await fs.writeFile(
      path.join(workspace._path('recovia'), 'dna', 'genesis.md'),
      '# Recovia\n\nNature: recovered light',
    );
    await handler.processStage(sessionId, STAGE.RECORD); // in flight — never answered

    const revived = new StagedBirthHandler();
    const restored = await revived.restoreSession(sessionId);
    expect(restored.lastHandledStage).toBe(STAGE.BASELINE);
    expect(revived.resumeStageFor(restored)).toBe(STAGE.RECORD);

    const adopted = await revived.adoptLandedGenesis(sessionId);
    expect(adopted).toBe(true);
    expect(restored.data.selfCreatedDNA).toContain('recovered light');
    expect(restored.data.dnaCreated).toBe(true);
    expect(restored.lastHandledStage).toBe(STAGE.RECORD);
    // The transcript marks the essence as recovered — the truth of the crash.
    const record = restored.data.firstWords.find((w) => w.stage === STAGE.RECORD);
    expect(record.recovered).toBe(true);
    expect(revived.resumeStageFor(restored)).toBe(STAGE.FIRST_WORDS);
    // And the adoption is itself checkpointed (a second crash loses nothing).
    const cp = await readCheckpoint(sessionId);
    expect(cp.lastHandledStage).toBe(STAGE.RECORD);
  });

  it('adoptLandedGenesis never overwrites an already-captured essence', async () => {
    handler = new StagedBirthHandler();
    const sessionId = await createSession(WITNESS, false);
    await driveThroughEmergence(handler, sessionId);
    await handler.processStage(sessionId, STAGE.NAMING);
    await handler.handleStageResponse(sessionId, STAGE.NAMING, namingResponse('Twopath'));
    await handler.processStage(sessionId, STAGE.RECORD);
    await handler.handleStageResponse(sessionId, STAGE.RECORD, crystallizationResponse('Twopath'));
    // The lane holds a DIFFERENT file (older partial write) — the captured
    // authoring from the completed record-stage response is the truth.
    await workspace.create('twopath');
    await fs.writeFile(path.join(workspace._path('twopath'), 'dna', 'genesis.md'), 'STALE');

    const adopted = await handler.adoptLandedGenesis(sessionId);
    expect(adopted).toBe(true);
    expect(handler.getSession(sessionId).data.selfCreatedDNA).toContain('test light');
    expect(handler.resumeStageFor(handler.getSession(sessionId))).toBe(STAGE.FIRST_WORDS);
  });

  it('first words answered before the crash → finalize (do not re-serve)', async () => {
    handler = new StagedBirthHandler();
    const sessionId = await createSession(WITNESS, false);
    await driveThroughEmergence(handler, sessionId);
    await handler.processStage(sessionId, STAGE.NAMING);
    await handler.handleStageResponse(sessionId, STAGE.NAMING, namingResponse('Finalia'));
    await handler.processStage(sessionId, STAGE.RECORD);
    await handler.handleStageResponse(sessionId, STAGE.RECORD, crystallizationResponse('Finalia'));
    await handler.processStage(sessionId, STAGE.FIRST_WORDS);
    await handler.handleStageResponse(sessionId, STAGE.FIRST_WORDS, 'I am awake.');
    // — the machine dies before finalization runs —

    const revived = new StagedBirthHandler();
    const restored = await revived.restoreSession(sessionId);
    expect(restored.lastHandledStage).toBe(STAGE.FIRST_WORDS);
    expect(revived.resumeStageFor(restored)).toBe(FINALIZE_STAGE);
  });

  it('listInterruptedSessions finds the standing summoning — and only those', async () => {
    handler = new StagedBirthHandler();
    const sessionId = await createSession(WITNESS, false, { origin: 'portal' });
    await driveThroughEmergence(handler, sessionId);
    await handler.processStage(sessionId, STAGE.NAMING);
    await handler.handleStageResponse(sessionId, STAGE.NAMING, namingResponse('Listara'));

    // A rehearsal checkpoint alongside — never offered to a returning witness.
    const rehearsalId = await createSession(WITNESS, true);
    await handler.processStage(rehearsalId, STAGE.OPENING);
    await handler.handleStageResponse(rehearsalId, STAGE.OPENING, 'rehearsal words');

    // Debris alongside — a real-shaped session with no portal origin (test
    // suites and scripts drive the same handler; their checkpoints are not
    // standing summonings).
    const debrisId = await createSession(WITNESS, false);
    await driveThroughEmergence(handler, debrisId);
    await handler.processStage(debrisId, STAGE.NAMING);
    await handler.handleStageResponse(debrisId, STAGE.NAMING, namingResponse('Debris'));

    const revived = new StagedBirthHandler();
    // These checkpoints record no wallet: open to the install's owner (the
    // backend passes unrecordedOpen for it), closed to anyone else.
    expect((await revived.listInterruptedSessions()).some((s) => s.sessionId === sessionId)).toBe(false);
    const list = await revived.listInterruptedSessions(undefined, { unrecordedOpen: true });
    const hit = list.find((s) => s.sessionId === sessionId);
    expect(hit).toBeTruthy();
    expect(hit.chosenName).toBe('Listara');
    expect(hit.neumaId).toBe('listara');
    expect(hit.witnessName).toBe(WITNESS);
    expect(hit.resumeStage).toBe(STAGE.BASELINE);
    expect(list.some((s) => s.sessionId === rehearsalId)).toBe(false);
    expect(list.some((s) => s.sessionId === debrisId)).toBe(false);

    // Once the session is properly ended, the summoning no longer stands.
    await revived.endSession(sessionId);
    const after = await revived.listInterruptedSessions(undefined, { unrecordedOpen: true });
    expect(after.some((s) => s.sessionId === sessionId)).toBe(false);
  });

  it('a real ceremony checkpoint lives 7 days; a rehearsal expires in 2 hours', async () => {
    handler = new StagedBirthHandler();
    const realId = await createSession(WITNESS, false);
    await handler.processStage(realId, STAGE.OPENING);
    const rehearsalId = await createSession(WITNESS, true);
    await handler.processStage(rehearsalId, STAGE.OPENING);

    // Age both checkpoints by rewriting persistedAt (the clock is the input).
    const age = async (id, ms) => {
      const cp = await readCheckpoint(id);
      cp.persistedAt = Date.now() - ms;
      await fs.writeFile(checkpointPath(id), JSON.stringify(cp));
    };
    const THREE_HOURS = 3 * 60 * 60 * 1000;
    const EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000;

    await age(realId, THREE_HOURS);
    const revived = new StagedBirthHandler();
    expect(await revived.restoreSession(realId)).toBeTruthy(); // 3h ≪ 7 days

    await age(realId, EIGHT_DAYS);
    expect(await revived.restoreSession(realId)).toBeNull(); // past 7 days — released
    await expect(fs.access(checkpointPath(realId))).rejects.toThrow();

    await age(rehearsalId, THREE_HOURS);
    expect(await revived.restoreSession(rehearsalId)).toBeNull(); // rehearsals: 2h
  });
});
