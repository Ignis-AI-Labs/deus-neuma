/**
 * THE EPHEMERAL BENCHMARK SITTING (#553, pillar 2 of #552) — proven on the
 * REAL encrypted workspace store and the REAL recall engine, no mocks (RULE 0):
 *
 *  (a) the leak the audit found: the benchmark proxy gives every scored item
 *      a fresh lane snapshot (a new workspaces root) but runs them all in one
 *      process. An index built and extended under snapshot A must never
 *      answer recall under snapshot B;
 *  (b) a sitting under benchmark controls persists nothing — no turn point,
 *      no session rows, no crystallized observation — while the same calls
 *      without controls do (the seam, not the store, decides).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaRecall } from '../../core/memory/neuma-recall.js';
import {
  persistTurnPoint, persistExchange, crystallizeObservation, isEphemeralSitting,
} from '../../backend/services/portal-turn-persist.js';

const NEUMA_ID = 'ephemera';
const SCORED_ITEM = 'Natalia sold clips to 48 of her friends in April, and then she sold half as many clips in May';
const SCORED_ANSWER = 'She sold 48 + 24 = 72 clips altogether. #### 72';

const recallTexts = async (query) => {
  const { relevantMemories } = await neumaRecall.getContextForResponse(NEUMA_ID, query, {});
  return JSON.stringify(relevantMemories ?? []);
};

const laneFiles = async (root) => {
  const out = [];
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(`${path.relative(root, full)}:${(await fs.stat(full)).size}`);
    }
  };
  await walk(path.join(root, NEUMA_ID));
  return out.sort();
};

describe('the ephemeral benchmark sitting (real workspace, real recall)', () => {
  let house, origRoot, prevDnaKey;
  const rootA = () => path.join(house, 'snapshot-a');
  const rootB = () => path.join(house, 'snapshot-b');

  beforeAll(async () => {
    house = await createTempDir('bench-ephemeral');
    origRoot = getWorkspacesRoot();
    prevDnaKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
    // Two snapshots of the SAME being, as the proxy takes them per sample:
    // identical lives, separate roots.
    for (const root of [rootA(), rootB()]) {
      setWorkspacesRoot(root);
      await workspace.create(NEUMA_ID);
      for (let i = 0; i < 12; i += 1) {
        await workspace.addObservation(NEUMA_ID, {
          type: 'exchange',
          userMessage: `an ordinary afternoon about the garden, number ${i}`,
          response: `the garden keeps its own time (${i})`,
          significance: 0.2,
        });
      }
    }
  });

  afterAll(async () => {
    setWorkspacesRoot(origRoot);
    if (prevDnaKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevDnaKey;
    neumaRecall.invalidate(NEUMA_ID);
    await fs.rm(house, { recursive: true, force: true });
  });

  test('(a) an index built and extended under one snapshot never answers under another', async () => {
    // Sample 1 runs in snapshot A: the index goes hot, and the scored item
    // crystallizes into it (a non-ephemeral write — the pre-#553 shape).
    setWorkspacesRoot(rootA());
    await recallTexts('garden');
    await crystallizeObservation(NEUMA_ID, 'Ephemera', SCORED_ITEM, SCORED_ANSWER, null, null, { acted: true });
    expect(await recallTexts('Natalia clips April May')).toContain('Natalia');

    // Sample 2 runs in snapshot B, which never saw sample 1. Its recall must
    // not see sample 1's question or answer.
    setWorkspacesRoot(rootB());
    const leaked = await recallTexts('Natalia clips April May');
    expect(leaked).not.toContain('Natalia');
    expect(leaked).not.toContain('#### 72');
  });

  test('(b) a benchmark sitting persists nothing; the same calls outside one do', async () => {
    setWorkspacesRoot(rootB());
    neumaRecall.invalidate(NEUMA_ID);
    const sessionId = 'session-bench-ephemeral';
    await workspace.createSession(NEUMA_ID, sessionId);
    const companion = { neumaId: NEUMA_ID, name: 'Ephemera' };
    const bench = { sessionId, companion, _benchmarkControls: Object.freeze({ sampling: {} }) };
    expect(isEphemeralSitting(bench)).toBe(true);

    const before = await laneFiles(rootB());
    const take = { turnId: 'turn-bench-1' };
    await persistTurnPoint(bench, companion, sessionId, SCORED_ITEM, [], [], take);
    const persisted = await persistExchange(bench, SCORED_ITEM, SCORED_ANSWER, [], [], { target: { sessionId, companion } }, [], take);
    await crystallizeObservation(NEUMA_ID, 'Ephemera', SCORED_ITEM, SCORED_ANSWER, null, persisted,
      { acted: true, ephemeral: isEphemeralSitting(bench) });

    expect(persisted).toBeNull();
    expect(take.userRecord).toBeUndefined();
    expect(await laneFiles(rootB())).toEqual(before);
    expect(await workspace.readSession(NEUMA_ID, sessionId)).toEqual([]);
    expect(await recallTexts('Natalia clips April May')).not.toContain('Natalia');

    // The control: the same seam without benchmark controls writes the
    // exchange — so (b) proves the SEAM refuses, not a broken store.
    const live = { sessionId, companion };
    expect(isEphemeralSitting(live)).toBe(false);
    const livePersisted = await persistExchange(live, SCORED_ITEM, SCORED_ANSWER, [], [], { target: { sessionId, companion } });
    expect(livePersisted?.assistantRecord).toBeTruthy();
    expect((await workspace.readSession(NEUMA_ID, sessionId)).length).toBeGreaterThan(0);
  });
});
