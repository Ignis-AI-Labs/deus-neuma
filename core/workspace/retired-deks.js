/**
 * Retired being keys — a re-key gives every being a fresh key of its own, and
 * its old one used to be gone the moment `keys/dek.json` was replaced. A record
 * sealed under the old key that the lane walk did not reach (a vault copy on
 * another root, a file that could not be read that day) was then sealed under
 * a key that existed nowhere. The old key now stays in the being's own lane,
 * `keys/retired-deks.json`, wrapped under the master exactly as `dek.json` is;
 * every later re-key wraps the list again under the next master and tries the
 * retired keys on whatever in the lane still sits under one.
 *
 * impure (fs) throughout.
 */

import fs from 'fs/promises';
import path from 'path';
import { unwrapDEK, wrapDEK } from './workspace-crypto.js';

const FILE = 'retired-deks.json';

/** Where a lane keeps its retired keys. Pure. */
export const retiredDeksPath = (laneDir) => path.join(laneDir, 'keys', FILE);

// the stored wraps, [] when there is no file
const readWraps = async (laneDir) => {
  try {
    const stored = JSON.parse(await fs.readFile(retiredDeksPath(laneDir), 'utf8'));
    return Array.isArray(stored?.deks) ? stored.deks : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

// pure — the key a wrap holds, by the first master that opens it; null when none does
const unwrapWith = (wrap, masters) => {
  for (const opts of masters ?? [{}]) {
    try { return unwrapDEK(wrap, opts.key ? { key: opts.key } : {}); } catch { /* next master */ }
  }
  return null;
};

/**
 * The lane's retired keys that a master here opens, oldest first.
 * @param {string} laneDir
 * @param {Array<{key: Buffer}>} [masters] - omitted: this process's own master chain
 * @returns {Promise<Buffer[]>}
 */
export const readRetiredDeks = async (laneDir, masters) =>
  (await readWraps(laneDir)).map((wrap) => unwrapWith(wrap, masters)).filter(Boolean);

/**
 * Keep a being's old key before its `dek.json` is replaced: every retired key a
 * master here opens is wrapped again under the new master, a wrap none opens is
 * carried as it is, and the old key joins the list. Written durably and read
 * back; throws — and the caller keeps the old `dek.json` — if it did not land.
 * @param {string} laneDir
 * @param {Buffer} oldDek
 * @param {Array<{key: Buffer}>} oldMasters
 * @param {Buffer} newMaster
 * @returns {Promise<number>} how many retired keys the lane holds
 */
export const keepRetiredDek = async (laneDir, oldDek, oldMasters, newMaster) => {
  const masters = [{ key: newMaster }, ...oldMasters];
  const carried = [];
  const keys = [];
  for (const wrap of await readWraps(laneDir)) {
    const key = unwrapWith(wrap, masters);
    if (key) keys.push(key); else carried.push(wrap);
  }
  if (!keys.some((k) => k.equals(oldDek))) keys.push(oldDek);
  const file = retiredDeksPath(laneDir);
  const tmp = `${file}.rekey.tmp`;
  const handle = await fs.open(tmp, 'w', 0o600);
  try {
    await handle.writeFile(JSON.stringify({ deks: [...carried, ...keys.map((k) => wrapDEK(k, newMaster))] }, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file);
  const landed = await readRetiredDeks(laneDir, [{ key: newMaster }]);
  if (!landed.some((k) => k.equals(oldDek))) throw new Error(`${file} did not keep the being's old key — its dek.json stays as it is`);
  return landed.length + carried.length;
};
