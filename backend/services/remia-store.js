// Remia store — the witness's OWN attunement records, in the witness's OWN
// realm. A sibling of user-realm.js (same per-wallet directory, same
// traversal guard): plaintext JSON at a filesystem location the witness
// controls and can prove is local. Nothing here is a being's data and
// nothing here ever leaves the machine.
//
// Layout, per wallet:
//   <realm>/<wallet>/remia/records/<recordId>.json   whole-record, atomic write
//
// Whole-record writes are deliberate: a record is one frozen value produced
// by the pure grammar; persisting the value the grammar returned (write
// temp + rename) means a torn write is unrepresentable and the file on disk
// is always a record the grammar built.

import fs from 'fs/promises';
import path from 'path';
import { walletDir } from './user-realm.js';

const RECORD_ID_RE = /^remia-\d+$/;

const recordsDir = (wallet) => path.join(walletDir(wallet), 'remia', 'records');

const recordPath = (wallet, recordId) => {
  if (typeof recordId !== 'string' || !RECORD_ID_RE.test(recordId)) {
    throw new Error('Invalid remia record id');
  }
  const dir = recordsDir(wallet);
  const resolved = path.resolve(dir, `${recordId}.json`);
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error('Path traversal denied');
  }
  return resolved;
};

/** Persist one witness attunement record — atomic (temp + rename). */
// impure
export const writeWitnessRecord = async (wallet, record) => {
  const file = recordPath(wallet, record.id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(record, null, 2));
  await fs.rename(tmp, file);
  return file;
};

/** Read one record; null when absent. */
// impure
export const readWitnessRecord = async (wallet, recordId) => {
  try {
    return JSON.parse(await fs.readFile(recordPath(wallet, recordId), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

/**
 * Every readable record for this wallet, offer-date order. A file that no
 * longer parses is SKIPPED, never fatal — one damaged file must not lock the
 * witness out of every other sitting — and its name is returned in
 * `unreadable` so the absence is stated, not hidden.
 * @returns {Promise<{records: Array<Object>, unreadable: string[]}>}
 */
// impure
export const listWitnessRecords = async (wallet) => {
  const dir = recordsDir(wallet);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return { records: [], unreadable: [] };
    throw err;
  }
  const records = [];
  const unreadable = [];
  for (const f of files.filter((f) => f.endsWith('.json')).sort()) {
    try {
      records.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')));
    } catch {
      unreadable.push(f);
    }
  }
  return { records, unreadable };
};
