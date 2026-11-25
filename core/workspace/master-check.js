/**
 * The master check — does this install already hold data a master key sealed,
 * and is the key in hand the one that sealed it?
 *
 * A missing secrets file used to mean "fresh install": two new keys were made.
 * On an install that already held sealed data that is a silent lockout — the
 * data stays under a key nobody has. `holdsSealedData` is what key
 * provisioning asks before it makes a key; the check file is a tiny envelope
 * the start writes under the current master, so every install carries a mark
 * that says […] from its first start.
 *
 * impure (fs) throughout.
 */

import fs from 'fs';
import path from 'path';
import { decryptEnvelope, deriveKeyFromSecret, encryptEnvelope } from './workspace-crypto.js';

const FILE = 'master-check.json';
// Files that only exist once a master has sealed something in this data root.
const SEALED_MARKS = Object.freeze([FILE, 'retired-masters.json', path.join('settings', 'provider-credentials.json')]);

/** Where an install's master check stands. Pure. */
export const masterCheckPath = (dataRoot) => path.join(dataRoot, FILE);

/** Has a master key already sealed data in this data root? */
export const holdsSealedData = (dataRoot) => SEALED_MARKS.some((mark) => fs.existsSync(path.join(dataRoot, mark)));

/**
 * @param {string} file
 * @param {string[]} secrets - the master in hand, then any it may fall back to
 * @returns {'absent'|'opens'|'foreign'} foreign: the check is there and no key in hand opens it
 */
export const masterCheckState = (file, secrets) => {
  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return err.code === 'ENOENT' ? 'absent' : 'foreign';
  }
  for (const secret of secrets.filter(Boolean)) {
    try { decryptEnvelope(envelope, { key: deriveKeyFromSecret(secret) }); return 'opens'; } catch { /* not this key */ }
  }
  return 'foreign';
};

/** Write the check under this master. Never replaces one that is there. */
export const writeMasterCheck = (file, secret) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify(encryptEnvelope({ check: 'neuma-master' }, { key: deriveKeyFromSecret(secret) })), { mode: 0o600, flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
};
