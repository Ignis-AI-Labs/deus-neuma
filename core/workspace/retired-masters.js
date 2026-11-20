/**
 * Retired masters — the keyring a re-key leaves behind.
 *
 * Twice (2026-10-26, 2026-11-17) a re-key sealed everything it walked under a
 * new master, deleted the old one, and left a store it never walked — the
 * house's channel keys — sealed under a key that no longer existed anywhere.
 * Adding the missed folder to the walk fixes one folder; this fixes the class:
 * a re-key never destroys a master. The old one moves into
 * `<data root>/retired-masters.json`, one envelope sealed under the NEW
 * master, and the backend admits it at start into the decrypt fallback chain
 * (`DNA_ENCRYPTION_KEY_PREVIOUS`, in memory only). A store a re-key missed
 * keeps opening.
 *
 * What this does not weaken: whoever holds the current master already opens
 * everything here; whoever holds only a leaked old master opens neither this
 * file nor anything re-sealed. The keyring lives in the data root, so the next
 * re-key re-seals it with every other install store.
 *
 * A keyring that cannot be opened is never written over and never read as
 * empty: every function here throws on it.
 *
 * impure (fs) throughout.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { decryptEnvelope, deriveKeyFromSecret, encryptEnvelope, resetWorkspaceCryptoKey } from './workspace-crypto.js';

const FILE = 'retired-masters.json';

/** A master's fingerprint — what a command may print in place of the key. Pure. */
export const masterFingerprint = (secret) => crypto.createHash('sha256').update(`rekey-fp:${secret}`).digest('hex').slice(0, 12);

/** Where an install's keyring stands. Pure. */
export const retiredMastersPath = (dataRoot) => path.join(dataRoot, FILE);

// pure — a comma-separated env value as its secrets
const listed = (value) => (value || '').split(',').map((s) => s.trim()).filter(Boolean);

// the keyring's records as stored, [] when there is no file; throws when no given secret opens it
const readRecords = (file, secrets) => {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  let envelope;
  try { envelope = JSON.parse(raw); } catch (err) {
    throw new Error(`${file} is damaged — it is left exactly as it is`, { cause: err });
  }
  for (const secret of secrets.filter(Boolean)) {
    try {
      const opened = decryptEnvelope(envelope, { key: deriveKeyFromSecret(secret) });
      if (Array.isArray(opened?.masters)) return opened.masters.filter((m) => typeof m?.secret === 'string' && m.secret);
    } catch { /* not this key */ }
  }
  throw new Error(`${file} does not open with any key this desk holds — it is left exactly as it is`);
};

/**
 * The retired master secrets, oldest first. No file = none.
 * @param {string} file
 * @param {string[]} secrets - the masters that may have sealed the keyring, current first
 * @returns {string[]}
 */
export const readRetiredMasters = (file, secrets) => readRecords(file, secrets).map((m) => m.secret);

/**
 * Move masters into the keyring, sealed under the current one. The write is
 * atomic and read back before this returns: every retiring master must be in
 * what is on disk, or this throws and the caller keeps the old master.
 * @param {string} file
 * @param {string[]} retiring - the masters leaving the env file
 * @param {string} currentSecret - the master the keyring is sealed under
 * @param {{now?: Date}} [opts]
 * @returns {number} how many retired masters the keyring holds
 */
export const retireMasters = (file, retiring, currentSecret, { now = new Date() } = {}) => {
  if (!currentSecret) throw new Error('retired-masters: no current master to seal the keyring under');
  const leaving = [...new Set(retiring.filter(Boolean))].filter((s) => s !== currentSecret);
  const kept = readRecords(file, [currentSecret, ...leaving]).filter((m) => m.secret !== currentSecret);
  const known = new Set(kept.map((m) => m.secret));
  const masters = [...kept, ...leaving.filter((s) => !known.has(s)).map((secret) => ({ secret, retiredAt: now.toISOString() }))];

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(encryptEnvelope({ masters }, { key: deriveKeyFromSecret(currentSecret) })), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (err) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  const landed = new Set(readRetiredMasters(file, [currentSecret]));
  if (!leaving.every((s) => landed.has(s))) throw new Error(`${file} did not keep every retiring master — the old master must stay where it is`);
  return landed.size;
};

/**
 * Admit the retired masters into this process's decrypt fallback chain
 * (`DNA_ENCRYPTION_KEY_PREVIOUS`, in memory — the env file is not touched).
 * @param {string} file
 * @param {Record<string, string|undefined>} [env]
 * @returns {number} how many retired masters now stand in the chain
 */
export const admitRetiredMasters = (file, env = process.env) => {
  const current = env.DNA_ENCRYPTION_KEY;
  const previous = listed(env.DNA_ENCRYPTION_KEY_PREVIOUS);
  const retired = readRetiredMasters(file, [current, ...previous]);
  if (!retired.length) return 0;
  env.DNA_ENCRYPTION_KEY_PREVIOUS = [...new Set([...previous, ...retired])].filter((s) => s !== current).join(',');
  resetWorkspaceCryptoKey();
  return retired.length;
};
