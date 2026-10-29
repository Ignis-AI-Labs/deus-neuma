/**
 * PRESS ORPHANS (2026-10-21): a press whose owner died left its Chromium
 * running for a day, holding the GPU. Every press now sweeps those first.
 * Real processes and real dirs (RULE 0); only the recorded pids are touched.
 */
import { afterEach, expect, test } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { PRESS_DIR_PREFIX, PRESS_OWNER_FILE, sweepOrphanedPresses } from '../../backend/services/doc-press/press-orphans.js';

const roots = [];
const children = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
  }
  for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

// A stand-in browser: its own group, its command naming the press dir, as Chromium's --user-data-dir does.
const browserFor = (dir) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', `${dir}/profile`], { detached: true, stdio: 'ignore' });
  children.push(child);
  return child;
};
const deadPid = async () => {
  const gone = spawn(process.execPath, ['-e', '']);
  await new Promise((resolve) => gone.once('exit', resolve));
  return gone.pid;
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pressDir = async (tmp, record) => {
  const dir = await fs.mkdtemp(path.join(tmp, PRESS_DIR_PREFIX));
  if (record) await fs.writeFile(path.join(dir, PRESS_OWNER_FILE), JSON.stringify(record(dir)));
  return dir;
};

test('a press whose owner died is swept: its browser group killed, its dir removed', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'press-orphans-'));
  roots.push(tmp);
  const owner = await deadPid();
  let browser;
  const dir = await pressDir(tmp, (d) => { browser = browserFor(d); return { owner, browser: browser.pid }; });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(await sweepOrphanedPresses({ tmp })).toEqual([dir]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(alive(browser.pid)).toBe(false);
  await expect(fs.access(dir)).rejects.toThrow();
});

test('a live owner\'s press, an unrecorded dir, and a recycled pid are never touched', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'press-orphans-'));
  roots.push(tmp);
  let live;
  const mine = await pressDir(tmp, (d) => { live = browserFor(d); return { owner: process.pid, browser: live.pid }; });
  const unrecorded = await pressDir(tmp, null);
  // The owner is gone, but the recorded browser pid now runs something that does not name the dir.
  const stranger = browserFor('/elsewhere');
  const recycled = await pressDir(tmp, null);
  await fs.writeFile(path.join(recycled, PRESS_OWNER_FILE), JSON.stringify({ owner: await deadPid(), browser: stranger.pid }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(await sweepOrphanedPresses({ tmp })).toEqual([recycled]);
  expect([alive(live.pid), alive(stranger.pid)]).toEqual([true, true]);
  await expect(fs.access(mine)).resolves.toBeUndefined();
  await expect(fs.access(unrecorded)).resolves.toBeUndefined();
});
