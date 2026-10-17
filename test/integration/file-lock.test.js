/**
 * file-lock — mutual exclusion across REAL processes.
 *
 * The whole point of this module is behaviour that a single process cannot
 * exhibit, so a single-process test would prove nothing. Every case here
 * spawns actual `node` children against actual files on actual disk (RULE 0);
 * there is no seam to mock and none is used.
 *
 * The centrepiece is the lost-update test: N processes each read-increment-write
 * one counter file. Without mutual exclusion the final count is far below N.
 * With it, it is exactly N — the property the campaign queue depends on to
 * publish a post once instead of twice.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { acquireFileLock, releaseFileLock, withFileLock, LOCK_TIMEOUT } from '../../backend/services/file-lock.js';

const run = promisify(execFile);
const LOCK_MODULE = path.resolve('backend/services/file-lock.js');

/** Spawn `count` real node processes running `body`, all at once. */
const spawnAll = (count, body, env = {}) => Promise.all(
  Array.from({ length: count }, (_, i) => run('node', ['--input-type=module', '-e', body], {
    env: { ...process.env, ...env, WORKER_INDEX: String(i) },
  }).catch((err) => ({ stdout: err.stdout || '', stderr: err.stderr || String(err) }))),
);

describe('mutual exclusion across processes', () => {
  it('loses no updates when 12 processes increment one counter', async () => {
    const dir = await createTempDir('file-lock-counter');
    const counter = path.join(dir, 'counter.json');
    const lock = `${counter}.lock`;
    await fs.writeFile(counter, JSON.stringify({ n: 0 }));

    // Each worker does 15 read-modify-writes with a real await between the
    // read and the write — the exact shape that loses updates unguarded.
    const body = `
      const { withFileLock } = await import(${JSON.stringify(LOCK_MODULE)});
      const fs = (await import('fs')).promises;
      for (let i = 0; i < 15; i++) {
        await withFileLock(${JSON.stringify(lock)}, async () => {
          const cur = JSON.parse(await fs.readFile(${JSON.stringify(counter)}, 'utf8'));
          await new Promise((r) => setTimeout(r, 1));
          await fs.writeFile(${JSON.stringify(counter)}, JSON.stringify({ n: cur.n + 1 }));
        }, { timeoutMs: 30000 });
      }
    `;
    await spawnAll(12, body);

    const final = JSON.parse(await fs.readFile(counter, 'utf8'));
    expect(final.n).toBe(12 * 15); // 180 — every single increment survived
  }, 60000);

  it('admits exactly one holder at a time', async () => {
    const dir = await createTempDir('file-lock-exclusive');
    const lock = path.join(dir, 'x.lock');
    const log = path.join(dir, 'log.txt');

    // Each worker appends ENTER, holds briefly, appends EXIT. If exclusion
    // holds, the log is perfectly paired: never two ENTERs in a row.
    const body = `
      const { withFileLock } = await import(${JSON.stringify(LOCK_MODULE)});
      const fs = (await import('fs')).promises;
      await withFileLock(${JSON.stringify(lock)}, async () => {
        await fs.appendFile(${JSON.stringify(log)}, 'ENTER\\n');
        await new Promise((r) => setTimeout(r, 25));
        await fs.appendFile(${JSON.stringify(log)}, 'EXIT\\n');
      }, { timeoutMs: 30000 });
    `;
    await spawnAll(8, body);

    const lines = (await fs.readFile(log, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(16);
    let inside = 0;
    for (const line of lines) {
      if (line === 'ENTER') inside += 1; else inside -= 1;
      expect(inside).toBeLessThanOrEqual(1); // never two at once
      expect(inside).toBeGreaterThanOrEqual(0);
    }
    expect(inside).toBe(0);
  }, 60000);

  it('never leaves the lock file behind', async () => {
    const dir = await createTempDir('file-lock-clean');
    const lock = path.join(dir, 'clean.lock');
    await withFileLock(lock, async () => 'done');
    await expect(fs.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('releases even when the guarded work throws', async () => {
    const dir = await createTempDir('file-lock-throw');
    const lock = path.join(dir, 'throw.lock');
    await expect(withFileLock(lock, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(fs.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(withFileLock(lock, async () => 'after')).resolves.toBe('after');
  });
});

describe('a lock must never wedge the system', () => {
  it('reaps a lock whose holder was killed', async () => {
    const dir = await createTempDir('file-lock-dead');
    const lock = path.join(dir, 'dead.lock');
    // A holder that died without releasing: a real pid that no longer exists.
    const { stdout } = await run('node', ['-e', 'console.log(process.pid)']);
    const deadPid = Number(stdout.trim());
    await fs.writeFile(lock, JSON.stringify({ pid: deadPid, at: Date.now(), token: 'ghost' }));

    // staleMs is long, so this can only succeed via the liveness check.
    const token = await acquireFileLock(lock, { timeoutMs: 5000, staleMs: 600000 });
    expect(typeof token).toBe('string');
    await releaseFileLock(lock, token);
  }, 20000);

  it('reaps a lock older than its TTL even if the pid is alive', async () => {
    const dir = await createTempDir('file-lock-stale');
    const lock = path.join(dir, 'stale.lock');
    await fs.writeFile(lock, JSON.stringify({ pid: process.pid, at: Date.now() - 60000, token: 'old' }));
    const token = await acquireFileLock(lock, { timeoutMs: 5000, staleMs: 1000 });
    expect(typeof token).toBe('string');
    await releaseFileLock(lock, token);
  }, 20000);

  it('does NOT reap an unreadable lock on liveness alone — only on the TTL', async () => {
    const dir = await createTempDir('file-lock-unreadable');
    const lock = path.join(dir, 'unreadable.lock');
    // An empty/garbage lock: owner unknown. Treating "unknown" as "dead" is
    // what broke the mutex once; it must now simply time out.
    await fs.writeFile(lock, '');
    await expect(acquireFileLock(lock, { timeoutMs: 300, staleMs: 600000 }))
      .rejects.toMatchObject({ code: LOCK_TIMEOUT });
    // …but the TTL still frees it, so it can never wedge forever.
    const token = await acquireFileLock(lock, { timeoutMs: 5000, staleMs: 1 });
    expect(typeof token).toBe('string');
    await releaseFileLock(lock, token);
  }, 20000);
});

describe('release is not theft', () => {
  it('a stale token does not free the current holder', async () => {
    const dir = await createTempDir('file-lock-token');
    const lock = path.join(dir, 'token.lock');
    const mine = await acquireFileLock(lock);
    await releaseFileLock(lock, 'not-my-token'); // someone else's release
    await expect(fs.stat(lock)).resolves.toBeTruthy(); // still held
    await releaseFileLock(lock, mine);
    await expect(fs.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('failure is loud', () => {
  it('times out with LOCK_TIMEOUT rather than passing through unguarded', async () => {
    const dir = await createTempDir('file-lock-timeout');
    const lock = path.join(dir, 'busy.lock');
    const held = await acquireFileLock(lock);
    const started = Date.now();
    await expect(acquireFileLock(lock, { timeoutMs: 200, staleMs: 600000 }))
      .rejects.toMatchObject({ code: LOCK_TIMEOUT });
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    await releaseFileLock(lock, held);
  });
});
