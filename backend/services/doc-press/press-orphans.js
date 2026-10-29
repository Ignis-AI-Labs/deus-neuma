/**
 * Press orphans — a press whose owner died never closes its Chromium. // impure
 *
 * The press closes its browser in a `finally`. A process killed mid-press
 * (a test run's SIGKILL, a backend restart) never reaches it: the browser is
 * reparented to systemd, its profile stays in tmp, and minutes later its
 * on-device-model helper opens the GPU. Five such browsers, one a day old,
 * held NVIDIA handles while the desktop's new GPU channels failed
 * (NV_ERR_STATE_IN_USE, 2026-10-21).
 *
 * Each press records its owner and its browser's pid in its work dir. Every
 * new press first sweeps the work dirs whose owner is gone: it kills the
 * browser's process group, but only while that pid still runs a command
 * naming the dir (a recycled pid is never touched), then removes the dir.
 */

import fs from 'fs/promises';
import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';

export const PRESS_DIR_PREFIX = 'doc-press-';
export const PRESS_OWNER_FILE = 'owner.json';

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

const procCmdline = (pid) => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
  } catch {
    return '';
  }
};

const killGroup = (pid) => {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // the group is already gone
  }
};

/** Record this process as the press's owner, beside its browser's pid. */
export const recordPressOwner = (workDir, browserPid) =>
  fs.writeFile(path.join(workDir, PRESS_OWNER_FILE), JSON.stringify({ owner: process.pid, browser: browserPid }));

/**
 * Sweep presses whose owner is gone. Work dirs without an owner record (an
 * older press, or one mid-launch) are left alone. Returns the dirs swept.
 */
export const sweepOrphanedPresses = async ({
  tmp = os.tmpdir(),
  isAlive = pidAlive,
  cmdline = procCmdline,
  kill = killGroup,
} = {}) => {
  let names;
  try {
    names = (await fs.readdir(tmp)).filter((name) => name.startsWith(PRESS_DIR_PREFIX));
  } catch {
    return [];
  }
  const swept = [];
  for (const name of names) {
    const dir = path.join(tmp, name);
    let record;
    try {
      record = JSON.parse(await fs.readFile(path.join(dir, PRESS_OWNER_FILE), 'utf8'));
    } catch {
      continue;
    }
    if (!Number.isInteger(record.owner) || isAlive(record.owner)) continue;
    if (Number.isInteger(record.browser) && cmdline(record.browser).includes(dir)) kill(record.browser);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }).catch(() => {});
    swept.push(dir);
  }
  return swept;
};
