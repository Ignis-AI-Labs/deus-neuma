// The legal office's disk posture, once: every office store is one JSON
// document under data/settings, written atomically (tmp + rename) with the
// 0600 file / 0700 directory re-tighten its sibling office stores keep.
//
// Reading law: a MISSING file is the store's empty value; a CORRUPT one
// throws — a ledger that silently reads empty would mark every known matter
// "new" again, and a seat that reads null would silently unseat the Praetor.

import fs from 'fs/promises';
import { dirname } from 'path';

/**
 * impure — the parsed document, or `empty` when the file does not exist.
 * @param {string} file
 * @param {*} empty
 */
export const readDoc = async (file, empty) => {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return empty;
    throw err;
  }
  return JSON.parse(raw);
};

/**
 * impure — atomic tmp+rename write, private to the operator.
 * @param {string} file
 * @param {*} value
 */
export const saveDoc = async (file, value) => {
  await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
  await fs.chmod(dirname(file), 0o700);
  await fs.chmod(file, 0o600);
};
