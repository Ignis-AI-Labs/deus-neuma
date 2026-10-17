/**
 * User recents — the witness's most-recently-opened folders, per wallet.
 *
 * A small MRU list backing the folder picker's RECENT section, so the witness
 * can jump back to a workspace without retyping its path. Lives in the user
 * realm beside chats/ and projects.json, reusing the SAME per-wallet traversal
 * guard (walletDir from user-realm.js) rather than reimplementing it. IO
 * isolated and marked.
 */
import fs from 'fs/promises';
import path from 'path';
import { walletDir, writeJsonAtomic } from './user-realm.js';

const MAX_RECENTS = 12;

const recentsPath = (wallet) => path.join(walletDir(wallet), 'recents.json');

// impure — read the store; a missing file is an empty list, not an error.
const readStore = async (wallet) => {
  try {
    const parsed = JSON.parse(await fs.readFile(recentsPath(wallet), 'utf8'));
    return Array.isArray(parsed.folders) ? parsed.folders : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

/**
 * Record a folder as most-recently-used: newest first, de-duplicated by
 * resolved path, capped at MAX_RECENTS. A non-absolute folder is ignored.
 * @param {string} wallet
 * @param {string} folder - absolute path
 */
// impure
export const recordRecent = async (wallet, folder) => {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) return;
  const resolved = path.resolve(folder);
  const prior = (await readStore(wallet)).filter((f) => f.path !== resolved);
  const next = [{ path: resolved, lastUsed: new Date().toISOString() }, ...prior].slice(0, MAX_RECENTS);
  await writeJsonAtomic(recentsPath(wallet), { folders: next });
};

/**
 * List recent folders, newest first, filtered to those that still exist as
 * directories (a deleted or renamed folder silently drops off — no ghosts).
 * @param {string} wallet
 * @returns {Promise<string[]>} absolute paths
 */
// impure
export const listRecents = async (wallet) => {
  const folders = await readStore(wallet);
  const out = [];
  for (const f of folders) {
    const st = await fs.stat(f.path).catch(() => null);
    if (st && st.isDirectory()) out.push(f.path);
  }
  return out;
};
