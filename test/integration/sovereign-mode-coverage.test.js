// Real directory modes and the actual read-only repair CLI; no beings are created.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { repairSovereignDirectoryModes, sovereignDirectories } from '../../core/workspace/sovereign-directory-modes.js';

test('check and repair cover vault parents and every declared directory, including intents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mode-coverage-'));
  const ws = path.join(root, 'mode-fixture');
  const targets = [path.join(ws, 'vault'), path.join(ws, 'intents')];
  const check = () => spawnSync(process.execPath, ['scripts/repair-workspace-modes.mjs', '--check', root], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 15000,
  });
  try {
    for (const dir of sovereignDirectories(ws)) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    for (const dir of targets) await fs.chmod(dir, 0o755);
    const before = check();
    expect(before.error).toBeUndefined();
    expect(before.status, before.stderr).toBe(1);
    expect(before.stdout).toContain('mode-fixture/vault');
    expect(before.stdout).toContain('mode-fixture/intents');
    expect(before.stdout).toContain('2 directorie(s) need repair');
    for (const dir of targets) expect((await fs.stat(dir)).mode & 0o777).toBe(0o755);
    expect((await repairSovereignDirectoryModes(ws)).sort()).toEqual(targets.sort());
    for (const dir of sovereignDirectories(ws)) expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
    expect(await repairSovereignDirectoryModes(ws)).toEqual([]);
    const after = check();
    expect(after.status, after.stderr).toBe(0);
    expect(after.stdout).toContain('0 directorie(s) need repair');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
