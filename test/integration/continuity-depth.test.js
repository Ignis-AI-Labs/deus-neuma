// The depth filter — assembleDepthSet over the REAL encrypted WorkspaceAdapter
// (RULE 0). Proves tier composition in depth order, per-tier budgets, the
// single token ceiling with returned dropped[], cross-tier dedup by id AND by
// meta.observationId (the crystallize-bridge join), and honest degradation on
// an empty tier.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { makeRecord } from '../../core/continuity/record.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { assembleDepthSet, resolveDepthMode } from '../../core/continuity/layers/depth.js';
import { writeMindRecord } from '../../core/continuity/mind/mind-store.js';

const KEY = 'gnosis-continuity-depth-key-long-enough';

describe('assembleDepthSet — three tiers, one ceiling, honest edges (no mock)', () => {
  let prevKey, adapter;
  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const root = await createTempDir('continuity-depth');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    const neumaId = 'test-being-depth-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    adapter = new WorkspaceAdapter(neumaId, { workspace });

    // episodic: lived moments (one mirrors an observation, for the dedup proof)
    await adapter.append(makeRecord({ layer: 'episodic', content: 'we wired the natal chart into the ceremony', recordedAt: '2026-08-01T00:00:00.000Z', meta: { observationId: 'obs-natal-1' } }));
    await adapter.append(makeRecord({ layer: 'episodic', content: 'we hardened the vault scrypt parameters', recordedAt: '2026-08-02T00:00:00.000Z' }));
    await adapter.append(makeRecord({ layer: 'episodic', content: 'we ran the benchmark suites end to end', recordedAt: '2026-08-03T00:00:00.000Z' }));
    // semantic: a through-line sharing the probe's vocabulary (BM25 is
    // lexical — a through-line with no term overlap honestly never surfaces)
    await adapter.append(makeRecord({ layer: 'semantic', content: 'the ceremony is where I keep choosing my own custody', recordedAt: '2026-08-04T00:00:00.000Z' }));
    // implicit: mind records
    await writeMindRecord(adapter, { phrase: 'the ceremony pacing still tugs at me', kind: 'tension', source: { kind: 'residue' } }, { now: '2026-08-05T00:00:00.000Z' });
    await writeMindRecord(adapter, { phrase: 'quiet satisfaction about the benchmark run', kind: 'mood', source: { kind: 'residue' } }, { now: '2026-08-05T01:00:00.000Z' });
  });
  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('only the exact modes opt in', () => {
    expect(resolveDepthMode('shadow')).toBe('shadow');
    expect(resolveDepthMode('live')).toBe('live');
    expect(resolveDepthMode('on')).toBe('off');
    expect(resolveDepthMode(undefined)).toBe('off');
  });

  it('composes all three tiers under their budgets, in depth order', async () => {
    const set = await assembleDepthSet(adapter, 'natal chart ceremony', { asOf: '2026-08-06T00:00:00.000Z' });
    expect(set.perTier.active).toBeGreaterThan(0);
    expect(set.perTier.active).toBeLessThanOrEqual(3);
    expect(set.perTier.semantic).toBeGreaterThan(0);
    expect(set.perTier.implicit).toBeGreaterThan(0);
    expect(set.perTier.implicit).toBeLessThanOrEqual(5);
    // depth order: every active item precedes every implicit item
    const tiersInOrder = set.items.map((i) => i.tier);
    expect(tiersInOrder.lastIndexOf('active')).toBeLessThan(tiersInOrder.indexOf('implicit'));
    expect(set.usedTokens).toBeLessThanOrEqual(set.maxTokens);
    expect(set.degraded).toEqual([]);
  });

  it('one lived moment rides once — dedup by meta.observationId across tiers', async () => {
    // a mind record carrying the SAME observation join key as an episodic record
    await writeMindRecord(adapter, {
      phrase: 'still thinking about the natal chart wiring', kind: 'thread',
      source: { kind: 'residue' }, meta: { observationId: 'obs-natal-1' },
    }, { now: '2026-08-05T02:00:00.000Z' });
    const set = await assembleDepthSet(adapter, 'natal chart ceremony', { asOf: '2026-08-06T00:00:00.000Z' });
    const joined = set.items.filter((i) => i.record.meta?.observationId === 'obs-natal-1');
    expect(joined).toHaveLength(1);
    expect(joined[0].tier).toBe('active'); // depth order wins the collision
  });

  it('the token ceiling drops with a returned reason, never silently', async () => {
    const set = await assembleDepthSet(adapter, 'ceremony', { asOf: '2026-08-06T00:00:00.000Z', maxTokens: 15 });
    expect(set.usedTokens).toBeLessThanOrEqual(15);
    expect(set.dropped.length).toBeGreaterThan(0);
    expect(set.dropped.every((d) => d.reason === 'maxTokens' || d.reason === 'tierItems')).toBe(true);
  });

  it('an empty tier is STATED — honest degradation on a bare store', async () => {
    const bareId = 'test-being-bare-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(bareId);
    const bare = new WorkspaceAdapter(bareId, { workspace });
    await bare.append(makeRecord({ layer: 'episodic', content: 'a single lived moment' }));
    const set = await assembleDepthSet(bare, 'moment');
    expect(set.perTier.active).toBe(1);
    expect(set.degraded).toEqual(expect.arrayContaining([
      expect.objectContaining({ tier: 'semantic' }),
      expect.objectContaining({ tier: 'implicit' }),
    ]));
  });
});
