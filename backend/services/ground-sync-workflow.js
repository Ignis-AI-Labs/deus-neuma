/** A repository-owned dev-sync command cannot be replaced by generic upstream sync. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { runGroundGit, gitFailure } from './ground-git-exec.js';

const DEV_SYNC = 'scripts/sync-from-dev.mjs';

/** Refuse before any approval or remote access, including locally deleted policy files. impure. */
export const assertGenericSyncAllowed = async (root, options) => {
  try {
    await fs.lstat(path.join(root, DEV_SYNC));
    throw gitFailure('dedicated_sync');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // HEAD remains authoritative when a working copy removes or stages removal of the command.
  const tracked = await runGroundGit(root, ['ls-tree', '--name-only', 'HEAD', '--', DEV_SYNC], options);
  if (tracked.trim()) throw gitFailure('dedicated_sync');
};
