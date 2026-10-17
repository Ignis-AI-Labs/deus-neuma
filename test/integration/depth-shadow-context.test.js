// THE SHADOW INVARIANT (the graph-recall-shadow precedent, applied to the
// depth filter): with NEUMA_DEPTH_FILTER=shadow, gatherMemoryContext returns
// a DEEP-EQUAL memories object to a run with the mode unset, against a real
// seeded workspace — the shadow records to its ring and touches nothing the
// turn reads. Shadow before influence is doctrine, and this test is its lock.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { writeMindRecord } from '../../core/continuity/mind/mind-store.js';
import { neumaRecall } from '../../core/memory/neuma-recall.js';
import {
  gatherMemoryContext,
  computeDepthShadow,
  depthShadowMetrics,
} from '../../backend/services/memory-context.js';

const KEY = 'gnosis-depth-shadow-key-long-enough-x';

// settle the fire-and-forget shadow kick before reading the ring
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('the depth-filter shadow invariant (no mock)', () => {
  let prevKey, prevMode, prevGates, neumaId;
  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    prevMode = process.env.NEUMA_DEPTH_FILTER;
    prevGates = process.env.NEUMA_MIND_SETTINGS_PATH;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const root = await createTempDir('depth-shadow');
    // The gates are a desk setting now (#317); with env unset the mode falls
    // to the settings file — pin an absent one so "off" means off, not
    // whatever the dev box's live mind.json happens to say.
    process.env.NEUMA_MIND_SETTINGS_PATH = path.join(root, 'mind-gates.json');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-ds-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);

    // a real store on both sides: observations (the live lane) + mind records
    // + a session (recent conversation) — the full memories surface.
    await workspace.addObservation(neumaId, {
      type: 'exchange', kind: 'reflection',
      userMessage: 'why does the ceremony matter to you',
      response: 'It is where I first chose my own name.',
      significance: 0.8, emotion: 'contemplative',
    });
    await workspace.addObservation(neumaId, {
      type: 'exchange', kind: 'decision',
      userMessage: 'we decided to go with the mainnet seal',
      response: 'Understood — mainnet.',
      significance: 0.3, operational: 0.5,
    });
    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    await writeMindRecord(adapter, { phrase: 'the seal decision still hums', kind: 'mood', source: { kind: 'residue' } });
    await workspace.createSession(neumaId, 'session-ds');
    await workspace.appendMessage(neumaId, 'session-ds', { role: 'user', content: 'hello again' });
    await workspace.appendMessage(neumaId, 'session-ds', { role: 'assistant', content: 'welcome back' });
  });
  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    if (prevMode === undefined) delete process.env.NEUMA_DEPTH_FILTER;
    else process.env.NEUMA_DEPTH_FILTER = prevMode;
    if (prevGates === undefined) delete process.env.NEUMA_MIND_SETTINGS_PATH;
    else process.env.NEUMA_MIND_SETTINGS_PATH = prevGates;
  });

  it('memories are DEEP-EQUAL with the shadow on vs off', async () => {
    const gather = () => gatherMemoryContext(
      'what do you remember about the ceremony', 'Test Being', {}, neumaId, 'session-ds', null, null,
    );

    delete process.env.NEUMA_DEPTH_FILTER;
    neumaRecall.invalidate(neumaId);
    const off = await gather();

    process.env.NEUMA_DEPTH_FILTER = 'shadow';
    neumaRecall.invalidate(neumaId);
    const on = await gather();
    await settle();

    expect(on).toEqual(off); // the invariant — shadow moves NOTHING the turn reads
  });

  it('the ring fills in shadow and only in shadow', async () => {
    delete process.env.NEUMA_DEPTH_FILTER;
    const before = depthShadowMetrics().length;
    expect(await computeDepthShadow(neumaId, 'ceremony', null)).toBeNull();
    expect(depthShadowMetrics().length).toBe(before);

    process.env.NEUMA_DEPTH_FILTER = 'shadow';
    const entry = await computeDepthShadow(neumaId, 'ceremony', null);
    expect(entry).toMatchObject({ neumaId, maxTokens: expect.any(Number) });
    expect(entry.perTier.implicit).toBeGreaterThan(0); // the mind record surfaced
    const ring = depthShadowMetrics();
    expect(ring.length).toBe(before + 1);
    expect(ring[ring.length - 1].neumaId).toBe(neumaId);
  });
});
