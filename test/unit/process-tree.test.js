import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { processRow, descendantsOf, stopPosixTree } = require('../../electron/process-tree.cjs');
const children = [];
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const waitForDeath = async (pid) => {
  const until = Date.now() + 3000;
  while (alive(pid) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20));
  return !alive(pid);
};

afterEach(() => {
  for (const pid of children.splice(0)) {
    if (alive(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
});

describe('utility backend process-tree cleanup', () => {
  it('parses real proc stat shape even when comm contains spaces and parentheses', () => {
    const row = processRow('123 (node (worker)) S 100 123 123 0 -1 4194560');
    expect(row).toEqual({ pid: 123, parentPid: 100 });
    expect(descendantsOf([row, { pid: 124, parentPid: 123 }, { pid: 125, parentPid: 124 }, { pid: 999, parentPid: 1 }], 100))
      .toEqual([123, 124, 125]);
  });

  it.runIf(process.platform === 'linux')('SIGKILL reaches a real child and grandchild without a child-led process group', async () => {
    const root = spawn(process.execPath, ['-e', `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      process.stdout.write(String(child.pid) + '\\n');
      setInterval(() => {}, 1000);
    `], { stdio: ['ignore', 'pipe', 'inherit'] });
    children.push(root.pid);
    const grandchildPid = await new Promise((resolve, reject) => {
      root.once('error', reject);
      root.stdout.once('data', (bytes) => resolve(Number(String(bytes).trim())));
    });
    children.push(grandchildPid);
    expect(alive(root.pid)).toBe(true);
    expect(alive(grandchildPid)).toBe(true);
    stopPosixTree(root.pid, true);
    expect(await waitForDeath(root.pid)).toBe(true);
    expect(await waitForDeath(grandchildPid)).toBe(true);
  });
});
