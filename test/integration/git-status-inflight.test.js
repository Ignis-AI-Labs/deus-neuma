// Observe real Git trace output during real status IO; no process/clock doubles.
import { test, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { watch, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { readGitStatus, invalidateGitStatusCache } from '../../backend/services/git-status.js';

const exec = promisify(execFile);
const starts = (text) => text.split('\n').filter(Boolean).flatMap(line => {
  try { return [JSON.parse(line)]; } catch { return []; }
}).filter(row => row.event === 'start' && row.argv?.includes('status'));

test('watcher invalidation retires the cache ownership of an actual pending Git process', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'neuma-git-cache-race-'));
  const trace = path.join(root, '.trace');
  const oldTrace = process.env.GIT_TRACE2_EVENT;
  let listener, pending;
  try {
    await exec('git', ['-c', 'init.templateDir=', 'init', '-q'], {
      cwd: root, env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
    // Enough real directory work to observe the process before its result lands.
    for (let i = 0; i < 5000; i += 50) {
      await Promise.all(Array.from({ length: 50 }, (_, n) => writeFile(path.join(root, `source-${i + n}.js`), 'export {};')));
    }
    await writeFile(trace, '');
    process.env.GIT_TRACE2_EVENT = trace;
    invalidateGitStatusCache();
    let settled = false, invalidated = false;
    listener = watch(trace, () => {
      if (!settled && !invalidated && starts(readFileSync(trace, 'utf8')).length) {
        invalidated = true;
        invalidateGitStatusCache();
      }
    });
    pending = readGitStatus(root).finally(() => { settled = true; });
    await pending;
    listener.close(); listener = null;
    expect(invalidated, 'must observe invalidation before the real read resolves').toBe(true);
    await readGitStatus(root);
    expect(starts(await readFile(trace, 'utf8'))).toHaveLength(2);
  } finally {
    listener?.close();
    await pending?.catch(() => {});
    if (oldTrace === undefined) delete process.env.GIT_TRACE2_EVENT;
    else process.env.GIT_TRACE2_EVENT = oldTrace;
    invalidateGitStatusCache();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
