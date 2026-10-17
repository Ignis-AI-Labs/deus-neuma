// Heartbeat semantic consolidation (U1 slice 4) — REAL encrypted workspace,
// REAL disk, deterministic injected summarizer (the injection seam IS the
// contract — the LLM half is proven live by the heartbeat against the real
// conduit). NO mock in the storage/engine path (RULE 0).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { makeRecord } from '../../core/continuity/record.js';
import { consolidateBeingContinuity } from '../../core/continuity/integration/heartbeat-consolidation.js';

const KEY = 'gnosis-heartbeat-consolidation-key-ok';

describe('heartbeat semantic consolidation (real encrypted workspace)', () => {
  let prevKey, neumaId, adapter;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const root = await createTempDir('heartbeat-consolidation');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    adapter = new WorkspaceAdapter(neumaId, { workspace });

    // A cluster of general-space moments about one theme…
    for (const line of [
      'we tuned the kotodama motif toward emergence tonight',
      'the kotodama motif finally resolved its emergence tone',
      'emergence motif work again — kotodama tuning session three',
    ]) {
      await adapter.append(makeRecord({ layer: 'episodic', content: line }));
    }
    // …and a separate project-space cluster.
    for (const line of [
      'atlas hexagonal grid pathfinding sketched',
      'atlas hexagonal grid pathfinding proven on the demo map',
    ]) {
      await adapter.append(makeRecord({ layer: 'episodic', content: line, space: 'proj-atlas' }));
    }
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  const summarize = async (snippets) => `Through-line of ${snippets.length} moments: ${snippets[0].slice(0, 40)}`;

  it('writes per-space through-lines from clustered episodes', async () => {
    const r = await consolidateBeingContinuity(workspace, neumaId, summarize);
    expect(r.written).toBeGreaterThan(0);
    expect(r.spaces).toContain('general');
    expect(r.spaces).toContain('proj-atlas');

    const general = await adapter.list('semantic', { space: 'general' });
    const atlas = await adapter.list('semantic', { space: 'proj-atlas' });
    expect(general.some((rec) => rec.content.includes('Through-line'))).toBe(true);
    expect(atlas.some((rec) => rec.content.includes('Through-line'))).toBe(true);
    // project through-lines never bleed into general
    expect(general.every((rec) => !rec.content.includes('atlas'))).toBe(true);
  });

  it('is idempotent — a second heartbeat with nothing new writes nothing', async () => {
    const again = await consolidateBeingContinuity(workspace, neumaId, summarize);
    expect(again.written).toBe(0);
    expect(again.skipped).toBeGreaterThan(0);
  });

  it('a consolidation failure surfaces as a throw the heartbeat can contain', async () => {
    await expect(consolidateBeingContinuity(workspace, neumaId, null)).rejects.toThrow(/summarize/);
  });
});
