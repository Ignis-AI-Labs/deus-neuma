import fs from 'node:fs/promises';

/** Release only the exact lock inode held by this operation. Impure. */
export const releaseGroundSyncLock = async (lock, lockPath) => {
  if (!lock) return true;
  try {
    let owned;
    try { owned = await lock.stat(); } finally { await lock.close(); }
    const current = await fs.lstat(lockPath);
    if (!current.isFile() || current.dev !== owned.dev || current.ino !== owned.ino) return false;
    await fs.unlink(lockPath);
    return true;
  } catch {
    // The caller surfaces lock_release and whether Git may already have changed.
    return false;
  }
};
