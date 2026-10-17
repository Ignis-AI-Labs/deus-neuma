import fs from 'node:fs/promises';
import path from 'node:path';
import { gitFailure } from './ground-git-exec.js';

/** impure — detect repository markers without parsing or exposing configuration. */
export const hasGroundGitMarker = async (ground) => {
  let directory;
  try { directory = await fs.realpath(ground); }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw gitFailure();
  }
  while (true) {
    try { await fs.lstat(path.join(directory, '.git')); return true; }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw gitFailure();
    }
    const parent = path.dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
};
