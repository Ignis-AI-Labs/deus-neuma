/** Real process death after a persisted task and failed result write. */
import fs from 'node:fs/promises';
import { URL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test, expect } from 'vitest';

const helper = fileURLToPath(new URL('../helpers/intent-crash-process.mjs', import.meta.url));
const start = (root, phase) => {
  const child = fork(helper, [root, phase], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, NEUMA_DATA_ROOT: path.join(root, 'data'), NEUMA_CMO_PATH: path.join(root, 'cmo.json') },
  });
  let stderr = '';
  child.stderr.on('data', (bytes) => { stderr = (stderr + bytes).slice(-4000); });
  const exited = once(child, 'exit');
  const message = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`worker timed out: ${stderr}`)), 15000);
    child.once('message', (data) => { clearTimeout(timer); resolve(data); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer); reject(new Error(`worker exited ${code}/${signal}: ${stderr}`));
    });
  });
  return { child, exited, message };
};

test('SIGKILL after a real task effect cannot repeat it on restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-intent-crash-'));
  const workers = [];
  try {
    const first = start(root, 'first'); workers.push(first);
    const before = await first.message;
    expect(before.taskIds).toHaveLength(1);
    expect(before.marker).toBe(true);
    expect(before.receipts).toEqual([]);
    first.child.kill('SIGKILL');
    expect((await first.exited)[1]).toBe('SIGKILL');
    await fs.rmdir(path.join(root, 'lanes', 'crash-recovery-fixture', 'intents', 'task.result.json'));
    const restarted = start(root, 'restart'); workers.push(restarted);
    const after = await restarted.message;
    expect(after.taskIds).toEqual(before.taskIds);
    expect(after.result.status).toBe('uncertain');
    expect(after.marker).toBe(false);
    expect(after.receipts).toHaveLength(1);
    expect((await restarted.exited)[0]).toBe(0);
  } finally {
    for (const worker of workers) {
      if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL');
      await worker.exited;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 40000);
