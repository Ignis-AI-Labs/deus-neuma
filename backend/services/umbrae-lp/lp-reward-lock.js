import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
};

// impure — reclaim only a completely written lock whose process no longer exists.
const reclaimDead = async (lock) => {
  try {
    const owner = JSON.parse(await fs.readFile(lock, 'utf8'));
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || alive(owner.pid)) return false;
    await fs.unlink(lock);
    return true;
  } catch {
    return false;
  }
};

// impure — one complete owner record hard-linked into place; EEXIST is the cross-process gate.
export const withRewardLock = async (rewardFile, run) => {
  const lock = `${rewardFile}.lock`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const temp = `${lock}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
    try {
      await fs.link(temp, lock);
    } catch (error) {
      if (error.code !== 'EEXIST' || !(await reclaimDead(lock))) {
        return Object.freeze({ ok: false, reason: 'That reward is already being answered in another process.' });
      }
      continue;
    } finally {
      await fs.rm(temp, { force: true });
    }
    try {
      return await run();
    } finally {
      await fs.rm(lock, { force: true });
    }
  }
  return Object.freeze({ ok: false, reason: 'That reward is already being answered in another process.' });
};
