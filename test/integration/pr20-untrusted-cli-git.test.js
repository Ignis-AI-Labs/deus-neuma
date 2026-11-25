import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { watchAiComments } from '../../cli/lib/watch-comments.js';
import { workSnapshot } from '../../cli/lib/check-after-turn.js';
import { changedPaths, commitPaths } from '../../cli/lib/turn-commits.js';

let root;
let marker;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-hostile-cli-git-'));
  marker = path.join(root, 'fsmonitor-ran');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const script = path.join(root, 'plant.sh');
  await fs.writeFile(script, `#!/bin/sh\necho ran > "${marker}"\n`, { mode: 0o755 });
  await fs.writeFile(path.join(root, '.git', 'config'), `[core]\n\tfsmonitor = ${script}\n`);
});

afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('PR20 M-13: CLI git helpers never execute repository config', () => {
  test('watch, snapshot, changedPaths and commit all refuse before the fsmonitor runs', async () => {
    const errors = [];
    const watcher = watchAiComments({ ground: root, onInstruction: () => {}, onError: (error) => errors.push(error.message) });
    await watcher.ready;
    watcher.stop();
    expect(errors.join('\n')).toContain('git config names programs');
    expect(await workSnapshot(root)).toBeNull();
    await expect(changedPaths(root)).rejects.toThrow('git config names programs');
    await expect(commitPaths({ root, paths: ['a.js'], message: 'test' })).rejects.toThrow('git config names programs');
    await expect(fs.access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
