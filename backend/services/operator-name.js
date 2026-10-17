/**
 * The operator's NAME, per wallet, in the user realm — the synced operator
 * profile witness-name.js (the desk's localStorage copy) always named as its
 * follow-on. What is stored here is server truth: every portal turn reads it
 * so the being addresses the operator by name, not by role (Design note, 2026-08-28:
 * […]). Kept
 * beside preset.json on the same walletDir traversal guard. IO isolated and
 * marked.
 */
import fs from 'fs/promises';
import path from 'path';
import { walletDir, writeJsonAtomic } from './user-realm.js';

const namePath = (wallet) => path.join(walletDir(wallet), 'operator-name.json');

// Control characters (C0 + DEL), built by code point so the range survives
// every editor, diff, and harness verbatim (the escape-mangling lesson).
const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, 'g');

/** One line the prompt can carry verbatim: control chars out, whitespace
 *  collapsed, capped at the ACCOUNT field's own 64. Pure. */
export const cleanOperatorName = (name) =>
  String(name ?? '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);

// impure — the wallet's stored name; '' when never set or unreadable garbage.
export const getOperatorName = async (wallet) => {
  try {
    const parsed = JSON.parse(await fs.readFile(namePath(wallet), 'utf8'));
    return cleanOperatorName(parsed?.name);
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
};

/**
 * Store the wallet's name (cleaned; an empty name clears the record).
 * @param {string} wallet
 * @param {string} name
 * @returns {Promise<string>} the stored name, '' when cleared
 */
// impure
export const setOperatorName = async (wallet, name) => {
  const clean = cleanOperatorName(name);
  if (!clean) {
    await fs.rm(namePath(wallet), { force: true });
    return '';
  }
  await writeJsonAtomic(namePath(wallet), { name: clean });
  return clean;
};
