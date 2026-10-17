/** Prepare the advertised inbox inside an existing lane, never a new lane. */
import fs from 'node:fs/promises';
import path from 'node:path';
import workspace from '../../../core/workspace/neuma-workspace.js';
import { SOVEREIGN_DIR_MODE } from '../../../core/workspace/sovereign-directory-modes.js';

/** impure - create the inbox without following a substituted lane/inbox symlink. */
export const ensureIntentDirectory = async (laneId) => {
  const root = workspace.pathFor(laneId);
  if (!(await fs.lstat(root)).isDirectory()) throw new Error('Intent lane must be an existing directory');
  const directory = path.join(root, 'intents');
  try {
    await fs.mkdir(directory, { mode: SOVEREIGN_DIR_MODE });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  if (!(await fs.lstat(directory)).isDirectory()) throw new Error('Intent inbox must be a directory, not a file or symlink');
  return directory;
};
