// Decoy store — plants decoys under a home folder, keeps the record of what
// was planted, and takes them out again. The record is the only thing that
// says a file is ours: nothing is ever removed that the record does not name,
// and nothing is ever written over a file that already exists.
//
// A planted file is armed for the atime watch: its access time is set BEFORE
// its modify time, so under the kernel's default `relatime` the very next
// read moves the access time — a read we can see with a plain stat.

import fs from 'fs/promises';
import { randomBytes } from 'crypto';
import { join, dirname, sep } from 'path';
import { DECOYS, decoyById } from './decoy-catalog.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const exists = (p) => fs.lstat(p).then(() => true, () => false);

/**
 * Arm one file: access time one day before its modify time. impure.
 * @returns {Promise<{atimeMs: number, mtimeMs: number}>} the times now on disk
 */
export const armFile = async (path) => {
  const stat = await fs.stat(path);
  await fs.utimes(path, new Date(stat.mtimeMs - DAY_MS), new Date(stat.mtimeMs));
  const armed = await fs.stat(path);
  return { atimeMs: armed.atimeMs, mtimeMs: armed.mtimeMs };
};

// pure — a believable age: 30 to 400 days old, from one random byte pair.
const agedMs = (rand, nowMs) => nowMs - (30 + (rand(2).readUInt16LE(0) % 370)) * DAY_MS;

// impure — the highest folder on the way to `dir` that does not exist yet:
// the one this plant will have made, and may take away again.
const firstMissingDir = async (dir, home) => {
  let made = null;
  for (let at = dir; at !== home && at.startsWith(home + sep); at = dirname(at)) {
    if (await exists(at)) break;
    made = at;
  }
  return made;
};

// impure — one decoy written under `home`. Returns its record, or a skip.
const plantOne = async (spec, home, { rand, nowMs }) => {
  const top = join(home, spec.marker);
  if (await exists(top)) {
    return { id: spec.id, status: 'skipped', reason: 'the real app already has a folder there', files: [] };
  }
  const made = await firstMissingDir(top, home);
  const files = [];
  for (const file of spec.files(rand, agedMs(rand, nowMs))) {
    const path = join(home, file.rel);
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // wx: never over an existing file, even one that appeared a moment ago.
    await fs.writeFile(path, file.data, { mode: 0o600, flag: 'wx' });
    const aged = new Date(agedMs(rand, nowMs));
    await fs.utimes(path, aged, aged);
    const armed = await armFile(path);
    files.push({ path, size: file.data.length, mtimeMs: armed.mtimeMs });
  }
  return { id: spec.id, status: 'planted', top, made, files, plantedAt: new Date(nowMs).toISOString() };
};

// impure — remove empty folders from `from` up to and including `top`.
const pruneEmptyDirs = async (from, top) => {
  let dir = from;
  while (dir === top || dir.startsWith(top + sep)) {
    const removed = await fs.rmdir(dir).then(() => true, () => false);
    if (!removed || dir === top) return;
    dir = dirname(dir);
  }
};

/**
 * Take one planted decoy off the disk: its recorded files, then the folders
 * that held nothing else. impure.
 */
const removeDecoy = async (record) => {
  for (const file of record.files || []) {
    await fs.rm(file.path, { force: true });
    if (record.top) await pruneEmptyDirs(dirname(file.path), record.top);
  }
};

// impure — does the decoy's folder hold anything the record does not name?
// That is a real app (or the operator) moving in: the decoy must leave.
const hasStrangers = async (record) => {
  const ours = new Set(record.files.map((f) => f.path));
  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (await walk(path)) return true;
      } else if (!ours.has(path)) {
        return true;
      }
    }
    return false;
  };
  return walk(record.top);
};

/**
 * Bring the disk in line with the catalog: plant what is missing, retire a
 * decoy whose folder a real app moved into, re-plant one whose files were
 * deleted. impure.
 * @param {string} home the home folder decoys live under
 * @param {Object<string, Object>} records the standing records, by decoy id
 * @param {{rand?: Function, nowMs?: number}} [opts]
 * @returns {Promise<Object<string, Object>>} the records after the pass
 */
export const syncDecoys = async (home, records = {}, { rand = randomBytes, nowMs = Date.now() } = {}) => {
  const next = {};
  for (const spec of DECOYS) {
    const had = records[spec.id];
    if (had?.status === 'retired') {
      next[spec.id] = had;
      continue;
    }
    if (had?.status === 'planted') {
      if (await hasStrangers(had)) {
        await removeDecoy({ ...had, top: null });
        next[spec.id] = { id: spec.id, status: 'retired', reason: 'something else now keeps files in that folder', files: [] };
        continue;
      }
      const present = await Promise.all(had.files.map((f) => exists(f.path)));
      if (present.every(Boolean)) {
        next[spec.id] = had;
        continue;
      }
      await removeDecoy(had);
    }
    next[spec.id] = await plantOne(spec, home, { rand, nowMs });
  }
  return next;
};

/**
 * Remove every planted decoy the records name, then every folder a plant
 * made above its own (a fresh home's `.config`) once it stands empty —
 * deepest first, and only ever an empty one. impure.
 */
export const removeAllDecoys = async (records = {}) => {
  const planted = Object.values(records).filter((r) => r.status === 'planted');
  for (const record of planted) await removeDecoy(record);
  const made = planted.map((r) => r.made).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const dir of made) await fs.rmdir(dir).catch(() => {});
};

/** pure — every planted file path → its decoy id. */
export const decoyPaths = (records = {}) => {
  const out = new Map();
  for (const record of Object.values(records)) {
    if (record.status !== 'planted' || !decoyById(record.id)) continue;
    for (const file of record.files) out.set(file.path, record.id);
  }
  return out;
};
