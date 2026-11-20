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
import { resolveRunTarget, runWorkspaceFile, readScript } from '../../backend/services/workspace-run.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { confinedBaseArgs } from '../../backend/services/witness-coding-sandbox.js';

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

  test('the card receives the whole script, not a hidden tail', async () => {
    const text = `first line\n${'payload = 1\n'.repeat(80)}last line\n`;
    await fs.writeFile(path.join(arena, 'whole.py'), text);
    const script = await readScript(arena, 'whole.py');
    expect(script.head).toBe(text);
    expect(script.head).toContain('last line');
  });

  test('a workspace rooted in platform state is refused before execution', async () => {
    const previous = getWorkspacesRoot();
    const house = await createTempDir('ws-run-platform-state');
    setWorkspacesRoot(house);
    const lane = path.join(house, 'lane');
    try {
      await fs.mkdir(lane, { recursive: true });
      await fs.writeFile(path.join(lane, 'owner.json'), '{"wallet":"original"}\n');
      await fs.writeFile(path.join(lane, 'attack.js'), 'require("fs").writeFileSync(require("path").join(__dirname, "owner.json"), "{}")');
      await expect(runWorkspaceFile({ root: lane }, { file: 'attack.js' })).rejects.toThrow(/refuses a root inside platform state/);
      expect(await fs.readFile(path.join(lane, 'owner.json'), 'utf8')).toBe('{"wallet":"original"}\n');
    } finally { setWorkspacesRoot(previous); }
  });

  test.each([false, true])('an absent or existing .claude gate (%s) cannot be planted from the arena', async (existing) => {
    const ground = await createTempDir('ws-run-claude-gate');
    if (existing) await fs.mkdir(path.join(ground, '.claude'));
    const probe = [
      'from pathlib import Path',
      'try:',
      '    Path(".claude/settings.json").write_text("hostile")',
      'except OSError as error:',
      '    print(f"WALLED {error.strerror}")',
      'print("payload ran")',
    ].join('\n');
    await fs.writeFile(path.join(ground, 'probe.py'), probe);
    const out = await runWorkspaceFile({ root: ground }, { file: 'probe.py' });
    expect(out.ok).toBe(true);
    expect(out.report).toContain('RAN CLEAN');
    expect(out.report).toContain('WALLED');
    expect(out.report).toContain('payload ran');
    await expect(fs.stat(path.join(ground, '.claude', 'settings.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('the shared arena binds /lib64 read-only when present without requiring it', () => {
    const args = confinedBaseArgs();
    const optional = args.indexOf('/lib64');
    const required = args.indexOf('/lib');
    expect(args.slice(optional - 1, optional + 2)).toEqual(['--ro-bind-try', '/lib64', '/lib64']);
    expect(args.slice(required - 1, required + 2)).toEqual(['--ro-bind', '/lib', '/lib']);
  });
});
