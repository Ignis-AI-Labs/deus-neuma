/**
 * MEM-002 (#188) — a failed crystallization is a lost memory: never fatal to
 * the turn, but NEVER silent. Before the fix the whole addObservation block
 * sat under `catch { /* non-critical *\/ }` — a broken store lost
 * high-significance moments with zero trace.
 *
 * Proven against the REAL failure: a genuine broken filesystem (the
 * observations dir replaced by a FILE, so the real encrypted write throws),
 * the real crystallizeObservation seam, and the logger's real issues ring —
 * no mock anywhere in the claimed path (Rule 0).
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// Deterministically over the 0.75 bar: philosophical + emotional +
// self-reference + response depth, on regex hits alone.
const MOMENT = 'What if our purpose is to hope, dream, and feel deeply? I believe this house has a soul.';

describe('crystallizeObservation failure visibility (MEM-002)', () => {
  let root, workspace;

  beforeEach(async () => {
    vi.resetModules();
    root = await createTempDir('crystallize-warn');
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace.root = root;
  });

  test('a broken store: the turn survives AND the loss is logged with the error', async () => {
    const { crystallizeObservation } = await import('../../backend/services/portal-turn-persist.js');
    const { getRecentIssues } = await import('../../backend/services/logger.js');

    await workspace.create('being');
    // Sabotage for real: `memory/observations` becomes a FILE, so the real
    // _writeJSON mkdir/write throws — no mocked failure anywhere.
    const obsDir = path.join(root, 'being', 'memory', 'observations');
    await fs.rm(obsDir, { recursive: true, force: true });
    await fs.writeFile(obsDir, 'not a directory');

    await expect(
      crystallizeObservation('being', 'Being', MOMENT, 'I feel it too — profoundly.'),
    ).resolves.toBeUndefined(); // the turn is never fatal

    const issues = getRecentIssues();
    const mine = issues.find((i) => i.msg === 'crystallizeObservation failed — moment not written to memory');
    expect(mine).toBeDefined();
    expect(mine.level).toBe('warn');
    expect(mine.data.neumaId).toBe('being');
    expect(mine.data.err).toBeTruthy();
  });

  test('a healthy store: the moment lands on disk and no warning is issued', async () => {
    const { crystallizeObservation } = await import('../../backend/services/portal-turn-persist.js');
    const { getRecentIssues } = await import('../../backend/services/logger.js');

    await workspace.create('being');
    await crystallizeObservation('being', 'Being', MOMENT, 'I feel it too — profoundly.');

    const observations = await workspace.listObservations('being');
    expect(observations).toHaveLength(1);
    expect(observations[0].type).toBe('exchange');
    expect(
      getRecentIssues().some((i) => i.msg === 'crystallizeObservation failed — moment not written to memory'),
    ).toBe(false);
  });
});
