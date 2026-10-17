// Semantic through-lines in the prompt path (U1 prompt-side slice) — REAL
// encrypted workspace, REAL disk, the REAL gatherMemoryContext export from
// portal-stream, NO mock (RULE 0). Flag-gated: through-lines join memory
// context only on the continuity lane.

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { makeRecord } from '../../core/continuity/record.js';
import { assemblePrompt } from '../../core/runtime/prompt-assembler.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { gatherMemoryContext } = __test;

const KEY = 'gnosis-throughlines-key-long-enough-ok';

describe('semantic through-lines reach the prompt (real stack, no mock)', () => {
  let prevKey, prevSource, neumaId;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    prevSource = process.env.NEUMA_RECALL_SOURCE;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    delete process.env.NEUMA_RECALL_SOURCE;

    const root = await createTempDir('throughlines');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);

    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    await adapter.append(makeRecord({
      layer: 'semantic',
      content: 'I keep returning to the kotodama motif — tuning emergence has become my craft.',
      meta: { memberHash: 'h1', memberIds: [] },
    }));
    await adapter.append(makeRecord({
      layer: 'semantic',
      content: 'The atlas grids taught me patience with structure.',
      space: 'proj-atlas',
      meta: { memberHash: 'h2', memberIds: [] },
    }));
  });

  afterEach(() => {
    delete process.env.NEUMA_RECALL_SOURCE;
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    if (prevSource === undefined) delete process.env.NEUMA_RECALL_SOURCE;
    else process.env.NEUMA_RECALL_SOURCE = prevSource;
  });

  it('joins memory context on the continuity lane, active space + general pad (CORE-005 shape)', async () => {
    process.env.NEUMA_RECALL_SOURCE = 'continuity';
    const memories = await gatherMemoryContext(
      'the kotodama motif and atlas grids', 'TestBeing', {}, neumaId, null,
      { id: 'proj-atlas', label: 'Atlas' },
    );
    expect(memories.throughLines).toBeDefined();
    expect(memories.throughLines.some((t) => t.includes('atlas grids'))).toBe(true);   // active space
    expect(memories.throughLines.some((t) => t.includes('kotodama'))).toBe(true);      // general pad
  });

  it('stays out of the context on the observations lane (flag off)', async () => {
    const memories = await gatherMemoryContext(
      'the kotodama motif', 'TestBeing', {}, neumaId, null, null,
    );
    expect(memories.throughLines).toBeUndefined();
  });

  it('renders in the Memory section, and its absence changes nothing', () => {
    const withLines = assemblePrompt({
      memories: {
        relevantMemories: [{ memory: 'a moment' }],
        throughLines: ['I keep returning to the kotodama motif.'],
      },
    });
    expect(withLines).toContain('Through-lines of your history');
    expect(withLines).toContain('kotodama motif');

    const without = assemblePrompt({ memories: { relevantMemories: [{ memory: 'a moment' }] } });
    expect(without).not.toContain('Through-lines');
  });
});
