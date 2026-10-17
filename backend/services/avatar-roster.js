// avatar-roster.js — list the avatars (VRM forms) available to this installation.
//
// Scans the model directory root plus the gitignored test fleet subdirectory
// (docs/architecture/avatars/test-fleet.md). Names are the paths the stage feeds to
// `/model/<name>` — `test/` avatars keep their prefix.

import { promises as fs } from 'fs';
import { join } from 'path';

/** Display label keeping lineage so a root avatar and a fleet avatar with the
 *  same base name stay distinguishable in a picker. Pure. */
const toDisplayName = (name) => {
  const parts = name.split('/');
  const base = parts.pop().replace(/\.vrm$/, '').replace(/_/g, ' ');
  return parts.length ? `${parts.join('/')} · ${base}` : base;
};

// impure (reads the model directory)
const listVrmFiles = async (dir, prefix) => {
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith('.vrm')).sort().map((f) => `${prefix}${f}`);
  } catch (err) {
    // Missing directory = no avatars there; anything else is a real IO
    // failure and must surface (the route logs it), never read as "none held".
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
    throw err;
  }
};

/** A Git LFS pointer stub: what a clone without git-lfs — and every CI
 *  checkout without `lfs: true` — holds in place of the model. The spec caps
 *  a pointer at 1024 bytes and opens it with the version line. Pure. */
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1';
const isLfsPointer = (bytes) =>
  bytes.length < 1024 && bytes.toString('utf8').startsWith(LFS_POINTER_PREFIX);

// impure — a held model is megabytes; only a pointer-sized file is read.
// A file that vanished between readdir and here reads as not held.
const isLfsPointerFile = async (filePath) => {
  try {
    const { size } = await fs.stat(filePath);
    if (size >= 1024) return false;
    return isLfsPointer(await fs.readFile(filePath));
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
};

/**
 * All avatars servable under /model, test fleet included. LFS pointer stubs
 * are not avatars — counting them presented seven unloadable models and made
 * the stage's honest NONE HELD state unreachable (#261).
 * @param {string} modelPath - absolute path of the model directory
 * @returns {Promise<Array<{name: string, displayName: string}>>}
 */
// impure
export const listAvatars = async (modelPath) => {
  const names = [
    ...(await listVrmFiles(modelPath, '')),
    ...(await listVrmFiles(join(modelPath, 'test'), 'test/')),
  ];
  const checked = await Promise.all(
    names.map(async (name) => ({ name, pointer: await isLfsPointerFile(join(modelPath, name)) })),
  );
  return checked
    .filter(({ pointer }) => !pointer)
    .map(({ name }) => ({ name, displayName: toDisplayName(name) }));
};
