/** Two real processes, one filed intent, one execution and at most one card. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, test } from 'vitest';

const helper = fileURLToPath(new URL('../helpers/intent-concurrency-process.mjs', import.meta.url));

const nextMessage = (child, stderr) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => finish(reject, new Error(`worker timed out: ${stderr()}`)), 15000);
  const finish = (done, value) => {
    clearTimeout(timer);
    child.off('message', onMessage);
    child.off('error', onError);
    child.off('exit', onExit);
    done(value);
  };
  const onMessage = (data) => finish(resolve, data);
  const onError = (error) => finish(reject, error);
  const onExit = (code, signal) => finish(reject, new Error(`worker exited ${code}/${signal}: ${stderr()}`));
  child.once('message', onMessage);
  child.once('error', onError);
  child.once('exit', onExit);
});

const start = (root, mode) => {
  const child = fork(helper, [root, mode], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AUTH_SECRET: 'intent-concurrency-proof-secret',
      DNA_ENCRYPTION_KEY: 'intent-concurrency-proof-key-material',
      NEUMA_DATA_ROOT: path.join(root, 'data'),
      NEUMA_CMO_PATH: path.join(root, 'cmo.json'),
    },
  });
  let output = '';
  child.stderr.on('data', (bytes) => { output = (output + bytes).slice(-4000); });
  return { child, exited: once(child, 'exit'), message: () => nextMessage(child, () => output) };
};

describe('exclusive intent ownership across real sittings', () => {
  test.each([
    { mode: 'auto', cards: 0 },
    { mode: 'ask', cards: 1 },
  ])('$mode: two processes settle one filing once', async ({ mode, cards }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `neuma-intent-${mode}-`));
    const workers = [];
    try {
      const prepared = start(root, 'prepare');
      workers.push(prepared);
      expect((await prepared.message()).prepared).toBe(true);
      expect((await prepared.exited)[0]).toBe(0);

      const first = start(root, mode);
      const second = start(root, mode);
      workers.push(first, second);
      expect((await first.message()).ready).toBe(true);
      expect((await second.message()).ready).toBe(true);
      const firstDone = first.message();
      const secondDone = second.message();
      first.child.send({ go: true });
      second.child.send({ go: true });
      const settled = await Promise.all([firstDone, secondDone]);
      expect((await first.exited)[0]).toBe(0);
      expect((await second.exited)[0]).toBe(0);

      expect(settled.reduce((sum, worker) => sum + worker.cards, 0)).toBe(cards);
      expect(settled.flatMap((worker) => worker.receipts).filter((receipt) => receipt.status === 'ok')).toHaveLength(1);
      const inspector = start(root, 'inspect');
      workers.push(inspector);
      const stored = await inspector.message();
      expect((await inspector.exited)[0]).toBe(0);
      expect(stored.taskIds).toHaveLength(1);
      expect(stored.titles).toEqual(['Persist exactly one prepare task']);

      const dir = path.join(root, 'lanes', 'intent-concurrency-fixture', 'intents');
      expect((await fs.readdir(dir)).filter((name) => name.endsWith('.claim.json'))).toEqual([]);
      expect(JSON.parse(await fs.readFile(path.join(dir, 'exclusive.result.json'), 'utf8')).status).toBe('done');
    } finally {
      for (const worker of workers) {
        if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL');
        await worker.exited;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 40000);
});
