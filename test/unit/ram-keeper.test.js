// THE RAM KEEPER's judgments (backend/services/ram-keeper/) — the pure decisions on real inputs, and
// the readers on this machine's real /proc. RULE 0: nothing stands in for anything.
import fs from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, test } from 'vitest';
import { holdKeeperLock, memoryShort, readMemory, KEEPER } from '../../backend/services/ram-keeper/ram-keeper.js';
import { decideEngineRest, isComfyProcess, listeningPorts, newestTimestamp, processStartMs } from '../../backend/services/ram-keeper/idle-engines.js';

const GB = 1024 ** 3;
const HOUR = 60 * 60 * 1000;
const cleanups = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()(); });

describe('when an engine rests', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  test('idle past its time from its last finished job: stop', () => {
    expect(decideEngineRest({ queueBusy: false, lastJobAt: now - 3 * HOUR, startedAt: now - 13 * 24 * HOUR, now, idleMs: 2 * HOUR }))
      .toEqual({ stop: true, idleMs: 3 * HOUR });
  });
  test('a job in its queue, or idle within its time, or just started: it keeps running', () => {
    expect(decideEngineRest({ queueBusy: true, lastJobAt: now - 9 * HOUR, startedAt: 0, now, idleMs: 2 * HOUR }).stop).toBe(false);
    expect(decideEngineRest({ queueBusy: false, lastJobAt: now - HOUR, startedAt: 0, now, idleMs: 2 * HOUR }).stop).toBe(false);
    expect(decideEngineRest({ queueBusy: false, lastJobAt: null, startedAt: now - 10 * 60 * 1000, now, idleMs: 2 * HOUR }).stop).toBe(false);
  });
  test('the last job is read from ComfyUI\'s own history (timestamps in ms, anywhere in the entry)', () => {
    const history = { 'ba88bb6a': { status: { completed: true, messages: [
      ['execution_start', { prompt_id: 'ba88bb6a', timestamp: 1762275000000 }],
      ['execution_success', { prompt_id: 'ba88bb6a', timestamp: 1762275012345 }],
    ] } } };
    expect(newestTimestamp(history)).toBe(1762275012345);
    expect(newestTimestamp({})).toBeNull();
  });
});

describe('when memory is short', () => {
  test('below the larger of 12% and the floor in bytes', () => {
    expect(memoryShort({ total: 125 * GB, available: 7 * GB })).toBe(true);
    expect(memoryShort({ total: 125 * GB, available: 32 * GB })).toBe(false);
    expect(memoryShort({ total: 16 * GB, available: 6 * GB })).toBe(true);
    expect(KEEPER.floorFraction).toBe(0.12);
  });
  test('this machine\'s real meminfo reads as bytes', async () => {
    const mem = await readMemory();
    expect(mem.total).toBeGreaterThan(GB);
    expect(mem.available).toBeGreaterThan(0);
    expect(mem.available).toBeLessThanOrEqual(mem.total);
  });
});

describe('the machine-wide lock: one keeper acts', () => {
  const lockFile = async () => {
    const dir = await fs.mkdtemp('/var/tmp/keeper-lock-');
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    return join(dir, 'ram-keeper.lock');
  };
  test('free → ours; renewed while ours', async () => {
    const path = await lockFile();
    expect(await holdKeeperLock(Date.now(), path)).toBe(true);
    expect(await holdKeeperLock(Date.now(), path)).toBe(true);
    expect(JSON.parse(await fs.readFile(path, 'utf8')).pid).toBe(process.pid);
  });
  test('another LIVE keeper with a fresh beat holds it; a stale beat or a dead pid frees it', async () => {
    const path = await lockFile();
    const other = spawn('sleep', ['30'], { stdio: 'ignore' });
    cleanups.push(async () => other.kill('SIGKILL'));
    const now = Date.now();
    await fs.writeFile(path, JSON.stringify({ pid: other.pid, beat: now }));
    expect(await holdKeeperLock(now, path)).toBe(false);
    await fs.writeFile(path, JSON.stringify({ pid: other.pid, beat: now - KEEPER.lockStaleMs - 1 }));
    expect(await holdKeeperLock(now, path)).toBe(true);
    other.kill('SIGKILL');
    await new Promise((r) => other.once('exit', r));
    await fs.writeFile(path, JSON.stringify({ pid: other.pid, beat: now }));
    expect(await holdKeeperLock(now, path)).toBe(true);
  });
});

describe('what a process is, read from /proc', () => {
  test('a real listener\'s port is found from its sockets; a non-ComfyUI process is never one', async () => {
    const server = net.createServer().listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    cleanups.push(() => new Promise((r) => server.close(r)));
    expect(await listeningPorts(process.pid)).toContain(server.address().port);
    expect(await isComfyProcess(process.pid)).toBe(false);
    expect(await processStartMs(process.pid)).toBeLessThanOrEqual(Date.now());
  });
  test('main.py standing in a folder that holds comfy/ and comfy_extras/ is ComfyUI; main.py elsewhere is not', async () => {
    const dir = await fs.mkdtemp('/var/tmp/comfy-shape-');
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(join(dir, 'main.py'), 'import time\ntime.sleep(30)\n');
    const plain = spawn('python3', ['main.py'], { cwd: dir, stdio: 'ignore' });
    cleanups.push(async () => plain.kill('SIGKILL'));
    await delay(200);
    expect(await isComfyProcess(plain.pid)).toBe(false);
    await fs.mkdir(join(dir, 'comfy'));
    await fs.mkdir(join(dir, 'comfy_extras'));
    expect(await isComfyProcess(plain.pid)).toBe(true);
  });
});
