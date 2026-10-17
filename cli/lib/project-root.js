// Resolve the PROJECT ROOT by walking up from cwd looking for a .git
// directory. Falls back to the start path if no .git is found anywhere up
// the tree (operating in a non-git tree). Shared by every command that
// needs a project-scoped path — edit (snapshots under .neuma/edit-undo/),
// active-being (.neuma/active), and any future C-07 session-affinity work.
//
// Centralizing this prevents the […] footgun: every operation in a project resolves to the
// same .neuma/ directory regardless of cwd at invocation.
//
// impure (fs stat via existsSync)

import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

/**
 * @param {string} start - the directory to start walking up from (typically cwd)
 * @returns {string} the absolute path of the project root
 */
export const findProjectRoot = (start) => {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
};
