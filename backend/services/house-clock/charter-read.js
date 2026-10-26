/**
 * The charter's READ — one charter per house, `<realm>/<wallet>/house-charter.json`
 * (charter-store.js holds the write law and re-exports this). A leaf on
 * purpose: it imports nothing but the realm's path, so any reader of the
 * record can take it without the store's write-path imports.
 *
 * impure — realm disk.
 */
import fs from 'fs/promises';
import path from 'path';
import { walletDir } from '../user-realm.js';

/** The charter file of a house. */
export const charterFileOf = (wallet) => path.join(walletDir(wallet), 'house-charter.json');

/**
 * The house's charter, or null when none was ever written. impure. A corrupt
 * file THROWS — read as "no charter" it would silently stop every wake, and
 * that is the operator's switch to throw, not a parse error's.
 * @param {string} wallet
 * @returns {Promise<?Object>}
 */
export const readCharter = async (wallet) => {
  let raw;
  try {
    raw = await fs.readFile(charterFileOf(wallet), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const record = JSON.parse(raw);
  if (!record || typeof record !== 'object' || !Number.isInteger(record.version)) {
    throw new Error('house-charter: the stored charter is not a charter record');
  }
  return record;
};

