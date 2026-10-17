import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { neumaRecall } from '../../core/memory/neuma-recall.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { makeRecord } from '../../core/continuity/record.js';
import { buildMemorySection } from '../../core/runtime/memory-section.js';

const SPACE = { id: 'project-a', kind: 'project', label: 'Project A' };

describe('graph recall shadow leaves the live recall path unchanged', () => {
  let previousMode;
  let previousRoot;
  let neumaId;

  let previousSource;
  beforeEach(async () => {
    previousMode = process.env.NEUMA_GRAPH_RECALL_MODE;
    previousSource = process.env.NEUMA_RECALL_SOURCE;
    previousRoot = neumaWorkspace.root;
    neumaWorkspace.root = await createTempDir(`graph-shadow-${Math.random().toString(36).slice(2)}`);
    neumaId = `n-shadow-${Math.random().toString(36).slice(2)}`;
    await neumaWorkspace.create(neumaId);
    await neumaWorkspace.writeDNA(neumaId, { identity: { name: 'Fenna' } });

    await neumaWorkspace.addObservation(neumaId, {
      type: 'exchange',
      userMessage: 'what did we decide about the lighthouse',
      response: 'the lighthouse marks the project harbor entrance',
      occurredAt: '2025-01-01T00:00:00.000Z',
      recordedAt: '2025-01-01T00:00:00.000Z',
      space: SPACE,
      anchor: { sessionId: 'session-a' },
    });
    await neumaWorkspace.addObservation(neumaId, {
      type: 'exchange',
      userMessage: 'remember the lighthouse principle generally',
      response: 'a lighthouse makes a safe return visible',
      occurredAt: '2025-01-02T00:00:00.000Z',
      recordedAt: '2025-01-02T00:00:00.000Z',
      space: { id: 'general', kind: 'workspace', label: 'General' },
      anchor: { sessionId: 'session-a' },
    });
    await neumaWorkspace.addObservation(neumaId, {
      type: 'exchange',
      userMessage: 'foreign lighthouse detail',
      response: 'this belongs only to project B',
      occurredAt: '2025-01-03T00:00:00.000Z',
      recordedAt: '2025-01-03T00:00:00.000Z',
      space: { id: 'project-b', kind: 'project', label: 'Project B' },
      anchor: { sessionId: 'session-a' },
    });
  });

  afterEach(() => {
    neumaRecall.invalidate(neumaId);
    neumaWorkspace.root = previousRoot;
    if (previousMode === undefined) delete process.env.NEUMA_GRAPH_RECALL_MODE;
    else process.env.NEUMA_GRAPH_RECALL_MODE = previousMode;
    if (previousSource === undefined) delete process.env.NEUMA_RECALL_SOURCE;
    else process.env.NEUMA_RECALL_SOURCE = previousSource;
  });

  const readLivePath = async () => {
    const relevant = await neumaRecall.getRelevantMemories(
      neumaId,
      'tell me about the lighthouse',
      { space: SPACE },
    );
    const search = await neumaRecall.searchDocs(
      neumaId,
      'tell me about the lighthouse',
      { space: SPACE },
    );
    const context = await neumaRecall.getContextForResponse(
      neumaId,
      'tell me about the lighthouse',
      { space: SPACE },
    );
    return { relevant, search, context, promptMemory: buildMemorySection(context) };
  };

  it('returns byte-identical recall, search, context, and prompt memory in shadow', async () => {
    process.env.NEUMA_GRAPH_RECALL_MODE = 'off';
    neumaRecall.invalidate(neumaId);
    const baseline = await readLivePath();

    process.env.NEUMA_GRAPH_RECALL_MODE = 'shadow';
    neumaRecall.invalidate(neumaId);
    const shadow = await readLivePath();

    expect(JSON.stringify(shadow)).toBe(JSON.stringify(baseline));
    expect(shadow.relevant.some((hit) => hit.memory.includes('project B'))).toBe(false);
    expect(shadow.search.hits.some((hit) => hit.space === 'project-b')).toBe(false);
  });

  it('fails an unsupported production candidate value closed to baseline', async () => {
    process.env.NEUMA_GRAPH_RECALL_MODE = 'off';
    neumaRecall.invalidate(neumaId);
    const baseline = await readLivePath();

    process.env.NEUMA_GRAPH_RECALL_MODE = 'candidate';
    neumaRecall.invalidate(neumaId);
    expect(await readLivePath()).toEqual(baseline);
  });

  it('does not cap the live continuity-source baseline to the graph snapshot budget', async () => {
    const adapter = new WorkspaceAdapter(neumaId, { workspace: neumaWorkspace });
    for (let index = 0; index < 65; index += 1) {
      const timestamp = new Date(Date.UTC(2025, 1, 1, 0, index)).toISOString();
      await adapter.append(makeRecord({
        id: `record-${index}`,
        layer: 'episodic',
        content: index === 64 ? 'uncapped-final-marker' : `ordinary continuity item ${index}`,
        occurredAt: timestamp,
        recordedAt: timestamp,
        meta: { kind: 'note', observationId: `observation-${index}` },
      }));
    }

    process.env.NEUMA_RECALL_SOURCE = 'continuity';
    process.env.NEUMA_GRAPH_RECALL_MODE = 'off';
    neumaRecall.invalidate(neumaId);
    const relevant = await neumaRecall.getRelevantMemories(neumaId, 'uncapped-final-marker');
    expect(relevant[0].memory).toBe('uncapped-final-marker');
  });
});
