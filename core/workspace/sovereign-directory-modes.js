// The directory skeleton every being's workspace carries, and the repair that
// keeps its modes owner-only.
//
// Every directory inside a being's workspace is owner-only. A bare recursive
// mkdir under a 022 umask lands 0o755 — that being's DNA, soul, sessions and
// memory readable by every other local user. 0o700 loses no bits to a 022
// umask, and the refinement authority layer verifies these modes EXACTLY.
//
// That exactness is why the repair below exists. `mkdir(mode)` sets a mode only
// on directories it CREATES, so a workspace scaffolded before 0o700 became law
// keeps its 0o755 forever — and on 2026-08-13 the custody layer began refusing
// them, taking every pre-existing being off the wire at once ([…]). One list decides
// both what gets scaffolded and what gets normalized, so a directory can never
// be created under a law the repair does not know.

import fs from 'fs/promises';
import path from 'path';

export const SOVEREIGN_DIR_MODE = 0o700;

// Every directory beneath `root`, symlinks never followed (a Dirent reports a
// symlink as a symlink, never as the directory it points at), an absent root
// reported as none. Used to repair a subtree the custody layer grew itself.
// impure — walks the real tree
const descendantDirectories = async (root) => {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(root, entry.name);
    found.push(child, ...await descendantDirectories(child));
  }
  return found;
};

/** The exact directory skeleton one being's workspace carries. Pure. */
export const sovereignDirectories = (ws) => [
  ws,
  path.join(ws, 'dna'),
  path.join(ws, 'dna', 'history'),
  path.join(ws, 'soul'),
  path.join(ws, 'memory'),
  path.join(ws, 'memory', 'entities'),
  path.join(ws, 'memory', 'relations'),
  path.join(ws, 'memory', 'observations'),
  path.join(ws, 'sessions'),
  path.join(ws, 'archive'),
  path.join(ws, 'tool-results'),
  path.join(ws, 'skills'),
  path.join(ws, 'stats'),
  path.join(ws, 'journal'),
  path.join(ws, 'benchmarks'),
  path.join(ws, 'assessments'),
  path.join(ws, 'audit'),
  path.join(ws, 'cosmos'),
  path.join(ws, 'keys'),
  path.join(ws, 'continuity'),
  path.join(ws, 'vault'),
  path.join(ws, 'vault', 'notes'),
  path.join(ws, 'refinement'),
  // A being's ART lives with its DNA and its memory, not in a platform-side
  // bucket keyed by its id. Design note, 2026-08-01: […] Attribution then stops being a lookup — it is the path.
  path.join(ws, 'art'),
  path.join(ws, 'art', 'images'),
  path.join(ws, 'art', 'video'),
  path.join(ws, 'tasks'),
  path.join(ws, 'intents'),
];

/**
 * Normalize one existing workspace's directory modes to owner-only — the mode
 * `create` declares and the refinement authority layer verifies exactly.
 * Idempotent, and never widens: a directory already at 0o700 is left alone.
 * @param {string} ws - absolute path to the being's workspace
 * @returns {Promise<string[]>} the directories whose mode was changed
 */
// impure — stats and chmods the being's own directories
export const repairSovereignDirectoryModes = async (ws) => {
  const targets = sovereignDirectories(ws);
  // The custody layer grows its own children under these two roots
  // (refinement/ceremonies, refinement/scale-authorities, attunement/records)
  // and enters each at exactly 0o700, so the repair follows the whole subtree
  // rather than the declared roots alone.
  for (const branch of ['refinement', 'attunement']) {
    const root = path.join(ws, branch);
    targets.push(root, ...await descendantDirectories(root));
  }

  const repaired = [];
  for (const dir of targets) {
    try {
      const stats = await fs.lstat(dir);
      if (!stats.isDirectory() || (stats.mode & 0o777) === SOVEREIGN_DIR_MODE) continue;
      await fs.chmod(dir, SOVEREIGN_DIR_MODE);
      repaired.push(dir);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return repaired;
};
