/**
 * A team run whose backend died reads as LOST — never "running" forever
 * (2026-10-12). Real disk, real processes: one record is held by THIS live
 * process, the other by a real child process that has exited. Nothing is
 * swept: two backends on one machine share the run folder, so liveness is
 * read per record from the process that runs it.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

const WALLET = '0x6666666666666666666666666666666666666666';
let saved;
let store;

beforeAll(async () => {
  saved = process.env.NEUMA_TEAM_RUN_PATH;
  process.env.NEUMA_TEAM_RUN_PATH = path.join(await createTempDir('team-run-lost'), 'runs');
  store = await import('../../backend/services/team-run-store.js');
});

afterAll(() => {
  if (saved === undefined) delete process.env.NEUMA_TEAM_RUN_PATH;
  else process.env.NEUMA_TEAM_RUN_PATH = saved;
});

const deadPid = () => new Promise((resolve) => {
  const child = spawn(process.execPath, ['-e', '']);
  child.on('exit', () => resolve(child.pid));
});

describe('a run whose backend died reads as lost', () => {
  test('held by a live process: running; held by an exited one: LOST, with the reason', async () => {
    const plan = { by: WALLET, goal: 'g', steps: [{ id: 'a', neumaId: 'x', task: 't', needs: [] }], status: 'running' };
    const liveId = await store.createRun({ ...plan, runAt: '2026-10-12T00:00:00.000Z' });
    const lostId = await store.createRun({ ...plan, runAt: '2026-10-12T00:00:01.000Z' });
    // The second record names a process that really ran and really exited.
    const file = path.join(process.env.NEUMA_TEAM_RUN_PATH, `${lostId}.json`);
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...raw, host: { pid: await deadPid() } }));

    expect((await store.readRun(liveId, WALLET)).status).toBe('running');
    const lost = await store.readRun(lostId, WALLET);
    expect(lost.status).toBe('lost');
    expect(lost.failure).toContain('backend running this team stopped');
    const listed = await store.listRuns(WALLET);
    expect(listed.find((r) => r.id === lostId).status).toBe('lost');
    expect(listed.find((r) => r.id === liveId).status).toBe('running');
    // The host stamp survives a snapshot (the SSE lane updates as it runs).
    await store.updateRun(liveId, WALLET, { ...plan, completed: { a: 'x' } });
    expect((await store.readRun(liveId, WALLET)).host.pid).toBe(process.pid);
  });

  test('a host that started before this machine booted is gone, whatever its pid names now', async () => {
    const plan = { by: WALLET, goal: 'g', steps: [{ id: 'a', neumaId: 'x', task: 't', needs: [] }], status: 'running' };
    const id = await store.createRun({ ...plan, runAt: '2026-10-12T00:00:02.000Z' });
    const file = path.join(process.env.NEUMA_TEAM_RUN_PATH, `${id}.json`);
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    // Our own stamp reads alive: started after the boot, pid answering.
    expect(raw.host).toEqual(store.hostStamp());
    expect((await store.readRun(id, WALLET)).status).toBe('running');
    // After a reboot a pid is soon some other living process: here, this
    // very (alive) pid, stamped as starting before the machine came up.
    await fs.writeFile(file, JSON.stringify({ ...raw, host: { pid: process.pid, startedAt: '2000-01-01T00:00:00.000Z' } }));
    expect((await store.readRun(id, WALLET)).status).toBe('lost');
  });
});
