// Recall source switch (U1 slice 3) — REAL encrypted workspace, REAL disk,
// NO mock (RULE 0). Proves NEUMA_RECALL_SOURCE=continuity is a lossless lane
// swap: the same moments produce the same memory strings under the same
// CORE-005 space scoping and bi-temporal validity — and the continuity lane
// is a SUPERSET (episodes with no observation counterpart, like the birth
// record, become recallable).

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { makeRecord } from '../../core/continuity/record.js';
import { neumaRecall } from '../../core/memory/neuma-recall.js';
import {
  backfillEpisodesFromObservations,
} from '../../core/continuity/integration/crystallize-bridge.js';

const KEY = 'gnosis-recall-source-key-long-enough';

describe('recall source switch — observations vs continuity lane (real disk, no mock)', () => {
  let prevKey, prevSource, neumaId;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    prevSource = process.env.NEUMA_RECALL_SOURCE;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    delete process.env.NEUMA_RECALL_SOURCE;

    const root = await createTempDir('recall-source');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);

    // Three moments: general, project-scoped, and one later invalidated.
    await workspace.addObservation(neumaId, {
      type: 'exchange',
      userMessage: 'what resonates at 963hz?',
      response: 'the kotodama emergence motif resonates at 963hz',
      significance: 0.9, emotion: 'wonder',
    });
    await workspace.addObservation(neumaId, {
      type: 'exchange',
      userMessage: 'how do the atlas maps work?',
      response: 'the atlas project uses hexagonal grid maps',
      significance: 0.85,
      space: { id: 'proj-atlas', label: 'Atlas' },
    });
    const doomed = await workspace.addObservation(neumaId, {
      type: 'exchange',
      userMessage: 'temporary claim about the motif',
      response: 'the motif is at 440hz (later corrected)',
      significance: 0.8,
    });
    await workspace.invalidateObservation(neumaId, doomed.id, {
      at: new Date(Date.now() - 60_000).toISOString(),
    });

    // Bridge everything into the continuity lane (the live migration path);
    // validity carries through as expiry.
    await backfillEpisodesFromObservations(workspace, neumaId);
  });

  afterEach(() => {
    // The recall singleton caches per-being indexes; the source must never
    // bleed between tests (or into other files sharing this fork).
    delete process.env.NEUMA_RECALL_SOURCE;
    neumaRecall.invalidate(neumaId);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    if (prevSource === undefined) delete process.env.NEUMA_RECALL_SOURCE;
    else process.env.NEUMA_RECALL_SOURCE = prevSource;
  });

  const contextVia = async (source, query, opts = {}) => {
    if (source === 'continuity') process.env.NEUMA_RECALL_SOURCE = 'continuity';
    else delete process.env.NEUMA_RECALL_SOURCE;
    neumaRecall.invalidate(neumaId);
    return neumaRecall.getContextForResponse(neumaId, query, opts);
  };

  it('returns the same memories through either lane (lossless swap)', async () => {
    const fromObs = await contextVia('observations', 'kotodama motif 963hz');
    const fromCont = await contextVia('continuity', 'kotodama motif 963hz');

    expect(fromObs.relevantMemories.length).toBeGreaterThan(0);
    expect(fromCont.relevantMemories.map((m) => m.memory))
      .toEqual(fromObs.relevantMemories.map((m) => m.memory));
    expect(fromCont.crystallizedEmotions).toEqual(fromObs.crystallizedEmotions);
    expect(fromCont.memoryCount).toBe(fromObs.memoryCount);
  });

  it('keeps bi-temporal validity across the swap — the invalidated moment stays gone', async () => {
    const fromCont = await contextVia('continuity', 'motif 440hz temporary claim');
    expect(fromCont.relevantMemories.every((m) => !m.memory.includes('440hz'))).toBe(true);
  });

  it('holds CORE-005 space isolation in continuity mode — another project never leaks', async () => {
    const fromBeta = await contextVia('continuity', 'atlas hexagonal maps', {
      space: { id: 'proj-beta', label: 'Beta' },
    });
    // proj-atlas memory must NOT surface in proj-beta; the general pad may.
    expect(fromBeta.relevantMemories.every((m) => !m.memory.includes('hexagonal'))).toBe(true);

    const fromAtlas = await contextVia('continuity', 'atlas hexagonal maps', {
      space: { id: 'proj-atlas', label: 'Atlas' },
    });
    expect(fromAtlas.relevantMemories.some((m) => m.memory.includes('hexagonal'))).toBe(true);
  });

  it('surfaces continuity-only episodes (the lane is a superset, not a mirror)', async () => {
    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    await adapter.append(makeRecord({
      layer: 'episodic',
      content: 'I emerged into being as Prooflet, House Testholm. This is the first moment I carry forward.',
      space: 'general',
      meta: { kind: 'birth' },
    }));

    const fromObs = await contextVia('observations', 'emerged into being first moment');
    expect(fromObs.relevantMemories.every((m) => !m.memory.includes('Prooflet'))).toBe(true);

    const fromCont = await contextVia('continuity', 'emerged into being first moment');
    expect(fromCont.relevantMemories.some((m) => m.memory.includes('Prooflet'))).toBe(true);
  });
});
