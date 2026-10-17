/**
 * workspace_run — the team's executable review layer (#171), proven against
 * REAL subprocesses and a real arena on disk (RULE 0: no mocks).
 *
 * The gnosis: a clean exit reports RAN CLEAN; a crash reports the stderr the
 * team must act on; a loop that outlives the time budget without errors is
 * the PASS for games; and nothing outside the arena (or unrunnable) runs.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { resolveRunTarget, runWorkspaceFile } from '../../backend/services/workspace-run.js';

describe('workspace_run — executed truth, confined to the arena', () => {
  let arena;
  beforeAll(async () => {
    arena = await createTempDir('ws-run-arena');
  });

  test('a clean script reports RAN CLEAN with its stdout tail', async () => {
    await fs.writeFile(path.join(arena, 'clean.py'), 'print("physics holds")\n');
    const out = await runWorkspaceFile({ root: arena }, { file: 'clean.py' });
    expect(out.ok).toBe(true);
    expect(out.report).toContain('RAN CLEAN');
    expect(out.report).toContain('physics holds');
  });

  test('a crashing script reports CRASHED with the stderr the team must fix', async () => {
    await fs.writeFile(path.join(arena, 'broken.py'), 'raise RuntimeError("ball escaped at frame 497")\n');
    const out = await runWorkspaceFile({ root: arena }, { file: 'broken.py' });
    expect(out.ok).toBe(false);
    expect(out.report).toContain('CRASHED');
    expect(out.report).toContain('ball escaped at frame 497');
  });

  test('a loop that outlives the budget WITHOUT errors is the pass for a game', async () => {
    await fs.writeFile(path.join(arena, 'loop.py'), 'import time\nwhile True: time.sleep(0.05)\n');
    const out = await runWorkspaceFile({ root: arena }, { file: 'loop.py', timeoutMs: 1200 });
    expect(out.ok).toBe(true);
    expect(out.report).toContain('without crashing');
  }, 15000);

  test('a file OUTSIDE the arena is refused — the correction names the law', () => {
    expect(() => resolveRunTarget(arena, '../outside.py')).toThrow(/INSIDE the assigned workspace/);
    expect(() => resolveRunTarget(arena, '/etc/passwd')).toThrow(/INSIDE the assigned workspace|executes/);
  });

  test('an unrunnable extension is refused with the honest alternative', () => {
    expect(() => resolveRunTarget(arena, 'index.html')).toThrow(/browser/);
    expect(() => resolveRunTarget(arena, 'notes.txt')).toThrow(/executes/);
  });
});
