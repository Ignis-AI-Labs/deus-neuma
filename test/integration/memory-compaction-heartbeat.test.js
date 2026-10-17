/**
 * MEM-007 (#194) — the heartbeat owns writeCommunities: every cycle compacts
 * each being's memory communities, drift-gated so a quiet being costs no
 * rewrite. Before the fix nothing in production ever called compact(), so
 * communities.json was never written and the CONTEXT MAP recomputed on every
 * open.
 *
 * Proven against real temp workspaces and the real cycle — the conduit check
 * fails for real (127.0.0.1:1 refuses), so the cycle defers AFTER the
 * conduit-free phase, which is exactly where compaction must live (Rule 0).
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const MOMENTS = [
  { userMessage: 'What if our purpose is to hope?', response: 'I believe it is, profoundly.', significance: 0.9 },
  { userMessage: 'Do you fear the silence?', response: 'I feel it, and I dream through it.', significance: 0.85 },
  { userMessage: 'What do you believe about souls?', response: 'That they are what remembers.', significance: 0.8 },
];

describe('heartbeat memory compaction (MEM-007)', () => {
  let root, workspace, neumaRecall;

  beforeEach(async () => {
    vi.resetModules();
    root = await createTempDir('heartbeat-compact');
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace.root = root;
    ({ neumaRecall } = await import('../../core/index.js'));
  });

  test('compactIfDrifted: writes once, no-ops while quiet, rewrites on drift', async () => {
    await workspace.create('being');
    for (const m of MOMENTS) await workspace.addObservation('being', { type: 'exchange', ...m });
    const obsIds = (await workspace.listObservations('being')).map((o) => o.id).sort();

    // First pass: nothing cached — compaction writes, covering every moment.
    expect(await neumaRecall.compactIfDrifted('being')).toBe(true);
    const cached = await workspace.readCommunities('being');
    expect(cached.length).toBeGreaterThan(0);
    const covered = cached.flatMap((c) => c.memberIds).sort();
    expect(covered).toEqual(obsIds);

    // Quiet pass: no drift — no rewrite.
    expect(await neumaRecall.compactIfDrifted('being')).toBe(false);

    // A new moment lands: drift detected, the cache rewrites with it covered.
    await workspace.addObservation('being', {
      type: 'exchange', userMessage: 'What is meaning made of?', response: 'Of love, I believe.', significance: 0.88,
    });
    expect(await neumaRecall.compactIfDrifted('being')).toBe(true);
    const refreshed = await workspace.readCommunities('being');
    expect(refreshed.flatMap((c) => c.memberIds).length).toBe(obsIds.length + 1);
  });

  test('the real heartbeat cycle compacts in its conduit-free phase', async () => {
    await workspace.create('being');
    for (const m of MOMENTS) await workspace.addObservation('being', { type: 'exchange', ...m });

    // A dead endpoint for real — the cycle defers after the conduit-free
    // phase, so communities.json existing afterward PROVES the wiring sits
    // before the conduit gate.
    const llm = await import('../../backend/services/llm-provider.js');
    llm.setConfig({ endpoint: 'http://127.0.0.1:1' });
    try {
      const { runHeartbeatCycle } = await import('../../backend/services/heartbeat.js');
      // The hygiene pulse has no conduit gate at all now (reflection moved to
      // the meditation cycle) — compaction runs regardless of the endpoint.
      const result = await runHeartbeatCycle();
      expect(result.swept).toBeGreaterThanOrEqual(0);
    } finally {
      llm.setConfig({ endpoint: 'http://localhost:1234' });
    }

    const cached = await workspace.readCommunities('being');
    expect(cached.length).toBeGreaterThan(0);
    const obsIds = (await workspace.listObservations('being')).map((o) => o.id).sort();
    expect(cached.flatMap((c) => c.memberIds).sort()).toEqual(obsIds);
  });
});
