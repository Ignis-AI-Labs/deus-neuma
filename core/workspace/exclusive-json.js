import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { SOVEREIGN_DIR_MODE } from './sovereign-directory-modes.js';

/**
 * Create one encrypted platform record without replacing an existing claim.
 * The final-path envelope keeps its workspace AAD, and exclusive creation
 * happens synchronously at the writer's real commit boundary.
 * impure — filesystem writes.
 */
export const writeExclusiveJson = async (workspace, { directory, name, record }) => {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Exclusive record name is invalid');
  await fs.mkdir(directory, { recursive: true, mode: SOVEREIGN_DIR_MODE });
  const finalPath = path.join(directory, `${name}.json`);
  try {
    await workspace._writeJSON(finalPath, record, {
      beforeCommit: () => {
        const claim = openSync(finalPath, 'wx');
        closeSync(claim);
      },
    });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
};
