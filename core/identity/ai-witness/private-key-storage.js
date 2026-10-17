// impure — publish complete owner-only JSON without truncating an existing key file.
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/**
 * Atomically replace a key record with a fresh 0600 file in the same directory.
 * Rewrites tighten that file's mode; untouched files/directories are not migrated.
 * @param {string} target
 * @param {object} value
 */
export const writePrivateKeyJSON = async (target, value) => {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
};
