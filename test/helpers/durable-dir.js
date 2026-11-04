// durable-dir — a scratch folder OUTSIDE the OS temp dir, for the tests that
// prove a guard refuses (or never moves) what lives under it. The checkout is
// the natural place, but a clone can itself sit under the temp dir (a worktree
// in /tmp, a CI cache): there the checkout is temp too and the guard would be
// right to treat it as throwaway, so the home folder stands in. impure (mkdir)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isTempPath } from '../../backend/services/workspace-settings.js';

/** The first of the checkout and the home folder that is not under the OS temp dir, or null. */
export const durableParent = () => [process.cwd(), os.homedir()].find((dir) => dir && !isTempPath(dir)) ?? null;

/**
 * A fresh folder under durableParent(); the caller removes it (fs.rmSync … recursive).
 * @param {string} prefix
 * @returns {string}
 */
export const makeDurableDir = (prefix) => {
  const parent = durableParent();
  if (!parent) throw new Error('no folder outside the OS temp dir to stand in for a durable one');
  return fs.mkdtempSync(path.join(parent, `.${prefix}-`));
};
