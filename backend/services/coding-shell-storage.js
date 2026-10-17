// impure: stable per-ground storage with an atomic active-generation pointer.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import workspace from '../../core/workspace/neuma-workspace.js';
import { overlayConflict } from './overlay-freshness.js';

const GENERATION = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const baseFor = (lane, source) => path.join(workspace.pathFor(lane), 'coding', 'sandboxes',
  createHash('sha256').update(path.resolve(source)).digest('hex').slice(0, 12));

/** Legacy upper address. The factory returns the active workspace after recovery. */
export const sandboxPathFor = (lane, source) => path.join(baseFor(lane, source), 'upper');

const plainDirectory = async (directory, create = false) => {
  if (create) await fs.mkdir(directory, { mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw overlayConflict('shell storage is not a plain directory');
};

/** Prepare only platform storage under the bound lane, never follow planted links. */
export const ensureCodingBase = async (lane, source) => {
  const laneRoot = await fs.realpath(workspace.pathFor(lane));
  const relative = path.relative(workspace.pathFor(lane), baseFor(lane, source));
  let directory = laneRoot;
  for (const part of relative.split(path.sep)) {
    directory = path.join(directory, part);
    await plainDirectory(directory, true);
  }
  return directory;
};

/** Read the active generation. No pointer means the preserved legacy directory. */
export const activeCodingDirectory = async (base) => {
  await plainDirectory(base);
  const pointer = path.join(base, 'active.json');
  const stat = await fs.lstat(pointer).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  if (!stat) return { directory: base, generation: null };
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw overlayConflict('invalid shell generation pointer');
  let value;
  try { value = JSON.parse(await fs.readFile(pointer, 'utf8')); }
  catch { throw overlayConflict('unreadable shell generation pointer'); }
  if (value.version !== 1 || !GENERATION.test(value.generation || '')) throw overlayConflict('unknown shell generation');
  const parent = path.join(base, 'generations');
  const directory = path.join(parent, value.generation);
  await plainDirectory(parent);
  await plainDirectory(directory);
  return { directory, generation: value.generation };
};

/** Create a new empty generation, leaving every old file in place. */
export const freshCodingDirectory = async (base) => {
  const parent = path.join(base, 'generations');
  await plainDirectory(parent, true);
  const generation = randomUUID();
  const directory = path.join(parent, generation);
  await fs.mkdir(directory, { mode: 0o700 });
  return { directory, generation };
};

/** Publish only a fully prepared generation under the caller's stable base lock. */
export const publishCodingDirectory = async (base, next, previous, { assertCurrent, onPublished }) => {
  if (!GENERATION.test(next.generation || '') || next.directory !== path.join(base, 'generations', next.generation)) {
    throw overlayConflict('invalid recovery generation');
  }
  const current = await activeCodingDirectory(base);
  if (current.directory !== previous.directory || current.generation !== previous.generation) throw overlayConflict('shell changed while recovery was pending');
  await plainDirectory(next.directory);
  const temporary = path.join(base, `active.json.tmp-${randomUUID()}`);
  try {
    await fs.writeFile(temporary, JSON.stringify({ version: 1, generation: next.generation }), { flag: 'wx', mode: 0o600 });
    // Submission of this rename is the commit boundary. No await may intervene
    // between the origin check and submitting the atomic publication.
    assertCurrent();
    await fs.rename(temporary, path.join(base, 'active.json'));
    onPublished();
  } finally {
    await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
};

/** A stale turn must not run the preserved old upper after recovery publishes. */
export const assertActiveCodingShell = async (sandbox) => {
  // Primitive-only callers may supply their own isolated mount plan. Every
  // production factory result carries anchor; the tool schema cannot supply it.
  if (!sandbox.anchor) return;
  const current = await activeCodingDirectory(sandbox.anchor);
  if (current.directory !== path.dirname(sandbox.workspace)) {
    throw overlayConflict('this shell generation was replaced; call coding/sandbox_status to refresh it');
  }
};
