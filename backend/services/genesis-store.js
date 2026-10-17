// genesis-store.js — the install's GENESIS record. // impure (fs)
//
// Design note, 2026-09-29: […] GENESIS plays once per install — skippable, recorded, NEVER
// replayable. Its record is minted the moment it begins: that instant and a
// hash of it (the hash seeds the construct's resting turn, so every later
// ignition wakes this install's construct and no other's —
// frontend/app/Genesis/genesis-record.js). Written once (O_EXCL): whoever
// mints first is the genesis, and every later claim reads it back.
//
//   <data root>/settings/genesis.json  { schema, at, hash }

import fs from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { getSettingsDir } from './data-root.js';

export const GENESIS_SCHEMA = 'genesis/v1';

const genesisPath = () => join(getSettingsDir(), 'genesis.json');

/** The install's genesis record, or null before its genesis. */
export const readGenesis = async () => {
  try {
    const record = JSON.parse(await fs.readFile(genesisPath(), 'utf8'));
    return record?.schema === GENESIS_SCHEMA ? record : null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

/**
 * Claim the install's genesis: mint it now if none exists, else return the
 * one that stands. Never rewrites.
 * @returns {Promise<{ record: { schema: string, at: string, hash: string }, minted: boolean }>}
 */
export const claimGenesis = async () => {
  const at = new Date().toISOString();
  const hash = createHash('sha256').update(at).update(randomBytes(32)).digest('hex');
  const record = { schema: GENESIS_SCHEMA, at, hash };
  const file = genesisPath();
  await fs.mkdir(dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, JSON.stringify(record, null, 2), { flag: 'wx' });
    return { record, minted: true };
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const standing = await readGenesis();
    if (!standing) throw new Error('a genesis record stands but cannot be read', { cause: err });
    return { record: standing, minted: false };
  }
};
