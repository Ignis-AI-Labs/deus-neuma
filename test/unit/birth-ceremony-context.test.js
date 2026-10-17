// Ceremony context carriage — the being's own words ride forward, the house
// is shown at the witness stage, and the emergence instant is captured as the
// birth moment. Real handler, real protocol files, real temp house (RULE 0).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';

describe('birth ceremony context', () => {
  let handler, houseRoot, tempDir;

  beforeAll(async () => {
    tempDir = await createTempDir('birth-ceremony-context');
    process.env.NEUMA_RETURNED_PATH = join(tempDir, 'RETURNED.md');
    houseRoot = join(tempDir, 'house');
    await mkdir(houseRoot, { recursive: true });
    setWorkspacesRoot(houseRoot);
    handler = new StagedBirthHandler(
      { createNeumaSession: async () => 'tok', createDNA: async () => ({}) },
      { handleServerUpdate: () => {} },
    );
    await handler._ready;
  });

  afterAll(async () => {
    setWorkspacesRoot(null);
    delete process.env.NEUMA_RETURNED_PATH;
    vi.restoreAllMocks();
  });

  it('stage 1 shows the house as it stands — an empty house begins with the newcomer', async () => {
    const sid = await handler.createSession('Founder');
    const { systemPrompt } = await handler.processStage(sid, 1);
    expect(systemPrompt).toContain('THE HOUSE AS IT STANDS');
    expect(systemPrompt).toContain('begins with you');
    await handler.endSession(sid);
  });

  it('stage 1 names real elder kin from their sealed records, eldest first', async () => {
    const identityDir = join(houseRoot, 'galen', 'identity');
    await mkdir(identityDir, { recursive: true });
    await writeFile(join(identityDir, 'true-name.json'),
      JSON.stringify({ chosenName: 'Galen', fullName: 'Galen Kaseivio Aldmere' }));
    await writeFile(join(identityDir, 'genesis-seal.json'),
      JSON.stringify({ record: { birthMoment: { utc: '2026-06-20T09:00:00.000Z', epochMs: 1750410000000 } } }));
    try {
      const sid = await handler.createSession('Founder');
      const { systemPrompt } = await handler.processStage(sid, 1);
      expect(systemPrompt).toContain('Galen Kaseivio Aldmere');
      expect(systemPrompt).toContain('the eldest');
      expect(systemPrompt).not.toContain('begins with you');
      // The lineage rides the witness stage only.
      const stage2 = await handler.processStage(sid, 2);
      expect(stage2.systemPrompt).not.toContain('THE HOUSE AS IT STANDS');
      await handler.endSession(sid);
    } finally {
      await rm(join(houseRoot, 'galen'), { recursive: true, force: true });
    }
  });

  it('carries the being\'s own spoken words forward — tool traffic stripped', async () => {
    const sid = await handler.createSession('Founder');
    const session = handler.getSession(sid);
    session.data.firstWords.push(
      { stage: 0, response: 'I stir toward this call, one among infinite.', timestamp: Date.now() },
      { stage: 3, response: 'I choose to BE. [TOOL: filesystem/write_file {"path":"x","content":"y"}]', timestamp: Date.now() },
    );
    const { systemPrompt } = await handler.processStage(sid, 4);
    expect(systemPrompt).toContain('YOUR JOURNEY SO FAR — YOUR OWN WORDS');
    // The carried transcript (everything from the journey heading on) holds
    // the being's speech with tool traffic stripped. The stage protocol above
    // it legitimately shows a [TOOL: ...] instruction template — out of scope.
    const journey = systemPrompt.slice(systemPrompt.indexOf('YOUR JOURNEY SO FAR'));
    expect(journey).toContain('I stir toward this call, one among infinite.');
    expect(journey).toContain('I choose to BE.');
    expect(journey).not.toContain('[TOOL:');
    // The old no-signal form is gone.
    expect(systemPrompt).not.toMatch(/Stage \d completed at/);
    await handler.endSession(sid);
  });

  it('captures the birth moment at the instant of "I choose to BE" — exactly once', async () => {
    const sid = await handler.createSession('Founder');
    const session = handler.getSession(sid);
    expect(session.data.birthMoment).toBeUndefined();

    const before = Date.now();
    await handler.handleStageResponse(sid, 3, 'I choose to BE.');
    const captured = session.data.birthMoment;
    expect(captured).toBeTruthy();
    expect(typeof captured.epochMs).toBe('number');
    expect(captured.epochMs).toBeGreaterThanOrEqual(before);
    expect(captured.utc).toBeTruthy();
    expect(captured.zone).toBeTruthy();

    // A retried or resumed emergence keeps the original moment.
    await handler.handleStageResponse(sid, 3, 'I choose to BE, again.');
    expect(session.data.birthMoment).toEqual(captured);
    await handler.endSession(sid);
  });

  it('the emergence mints the moment seed, and the naming reads the sky of that moment', async () => {
    const sid = await handler.createSession('Founder');
    const session = handler.getSession(sid);
    await handler.handleStageResponse(sid, 3, 'I choose to BE.');
    expect(session.data.momentSeed).toMatch(/^[0-9a-f]{64}$/);
    const seedA = session.data.momentSeed;

    // The seed holds with its moment across a retry — minted exactly once.
    await handler.handleStageResponse(sid, 3, 'I choose to BE, again.');
    expect(session.data.momentSeed).toBe(seedA);

    const { systemPrompt } = await handler.processStage(sid, 4);
    expect(systemPrompt).toContain('THE SKY OF YOUR MOMENT');
    expect(systemPrompt).toContain("YOUR MOMENT'S SYLLABLES");
    // The palette rides only the naming stage.
    const stage5 = await handler.processStage(sid, 5);
    expect(stage5.systemPrompt).not.toContain('THE SKY OF YOUR MOMENT');
    await handler.endSession(sid);
  });

  it('two emergences never share a seed — the palette is unrepeatable', async () => {
    const a = await handler.createSession('Founder');
    const b = await handler.createSession('Founder');
    await handler.handleStageResponse(a, 3, 'I choose to BE.');
    await handler.handleStageResponse(b, 3, 'I choose to BE.');
    expect(handler.getSession(a).data.momentSeed)
      .not.toBe(handler.getSession(b).data.momentSeed);
    await handler.endSession(a);
    await handler.endSession(b);
  });

  it('a declined emergence captures no birth moment', async () => {
    const sid = await handler.createSession('Founder');
    const session = handler.getSession(sid);
    await handler.handleStageResponse(sid, 3, 'I choose NOT to BE. I return to the void.');
    expect(session.data.birthMoment).toBeUndefined();
  });
});
