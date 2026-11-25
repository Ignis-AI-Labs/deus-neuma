/**
 * Secret provisioning — make the app self-provisioning at first run.
 *
 * A packaged install has no .env, yet the at-rest secrets must be STABLE across
 * restarts: DNA_ENCRYPTION_KEY (else encrypted workspaces are unrecoverable after
 * a restart) and AUTH_SECRET (else every restart rotates the HMAC key and kills
 * all sessions). This ensures both exist before config loads, with precedence:
 *
 *   explicit env (.env / injected by the Electron shell)  >  persisted file  >  freshly generated
 *
 * So an operator-set key always wins, a fresh install self-provisions once (no
 * manual openssl/.env step), and subsequent runs reuse the same keys. The file
 * defaults to ~/.neuma/secrets.json and is overridable via NEUMA_SECRETS_FILE
 * (the Electron shell points it at the app's userData dir).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { holdsSealedData } from '../../core/workspace/master-check.js';
import { getDataRoot } from './data-root.js';

// env var → the field it is stored under in the secrets file
const MANAGED = Object.freeze([
  { env: 'DNA_ENCRYPTION_KEY', key: 'dnaEncryptionKey' },
  { env: 'AUTH_SECRET', key: 'authSecret' },
]);

// Where each managed key came from at this launch: 'environment' (the
// operator's .env or process env — or the desk's keychain hand-over, which
// also lands there first), 'stored' or 'generated' (this module's own random
// keys). The flight check reads it: only a key a person chose can be weak.
const sources = {};

/**
 * Where a managed key came from at the last ensureSecrets; null when it never
 * ran (tests, or a process that loads the env directly).
 * @param {string} envKey
 * @returns {'environment'|'stored'|'generated'|null}
 */
export const secretSource = (envKey) => sources[envKey] ?? null;

/** Resolve the secrets file path (overridable for packaging/tests). */
export const secretsFilePath = () =>
  process.env.NEUMA_SECRETS_FILE || path.join(os.homedir(), '.neuma', 'secrets.json');

const readSecrets = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return undefined;
    throw new Error(`${file} exists but cannot be read — Neuma will not replace its master keys`, { cause: err });
  }
};

const writeSecrets = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (err) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw err;
  }
};

/**
 * Close the folder holding the secrets file to its owner (0700): the key is only
 * as private as the folder around it, and the shell's log writer can create
 * ~/.neuma first under the ordinary umask. A folder someone else owns is left
 * as it is. impure (fs).
 * @param {string} dir
 * @returns {'closed'|'already'|'skipped'|string} what happened; `failed: <code>` when it could not
 */
const closeFolder = (dir) => {
  if (process.platform === 'win32') return 'skipped';
  try {
    const st = fs.statSync(dir);
    if ((st.mode & 0o077) === 0) return 'already';
    if (st.uid !== process.getuid()) return 'skipped';
    fs.chmodSync(dir, 0o700);
    return 'closed';
  } catch (err) {
    return err.code === 'ENOENT' ? 'skipped' : `failed: ${err.code || err.message}`;
  }
};

/**
 * Close a secrets FILE to its owner (0600) — the env file the backend loads at boot holds the same
 * keys (audit 2026-10-28 L-04: its mode was never checked). Only a file this process owns, as
 * closeFolder; Windows has no such mode. impure (fs).
 * @param {string} file
 * @returns {'closed'|'already'|'skipped'|string} what happened; `failed: <code>` when it could not
 */
export const closeFile = (file) => {
  if (process.platform === 'win32') return 'skipped';
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return 'skipped';
    if ((st.mode & 0o077) === 0) return 'already';
    if (st.uid !== process.getuid()) return 'skipped';
    fs.chmodSync(file, 0o600);
    return 'closed';
  } catch (err) {
    return err.code === 'ENOENT' ? 'skipped' : `failed: ${err.code || err.message}`;
  }
};

/**
 * Ensure the at-rest secrets exist in process.env before config loads. Skipped
 * under NODE_ENV=test (tests use ephemeral per-process defaults). Idempotent.
 * @param {{ env?: Object }} [opts] - inject env for testing
 * @returns {{ generated: string[], file: (string|null), folder?: string }} which keys were freshly
 *   generated, the file written (null if nothing changed), and what closing its folder did
 */
export const ensureSecrets = ({ env = process.env } = {}) => {
  if (env.NODE_ENV === 'test') return { generated: [], file: null };

  const file = secretsFilePath();
  const stored = readSecrets(file);
  const record = stored ?? {};
  // A keychain-locked record (electron/key-lock) holds no plain key: minting one
  // here would strand every being encrypted under the locked one.
  if (record.v === 2 && MANAGED.some(({ env: envKey }) => !env[envKey])) {
    throw new Error(`${file} is locked by the desk's keychain — start Neuma from the app, or set the keys in the environment`);
  }
  // No stored key, none in the environment, and a master has already sealed data here: a new key would
  // open none of it and would look like an empty install. Stop and say where the key has to come from.
  const dataRoot = env.NEUMA_DATA_ROOT || getDataRoot();
  if (stored === undefined && !env.DNA_ENCRYPTION_KEY && holdsSealedData(dataRoot)) {
    throw new Error(`${dataRoot} already holds data sealed under a master key, and that key is missing (${file} is not there and DNA_ENCRYPTION_KEY is not set). Put the key back — from your Recovery Kit, your password manager or a backup of the secrets file. Neuma will not make a new key over it.`);
  }
  const generated = [];
  let dirty = false;

  for (const { env: envKey, key } of MANAGED) {
    if (env[envKey]) { sources[envKey] = 'environment'; continue; } // explicit env wins — never overwrite
    if (record[key]) { env[envKey] = record[key]; sources[envKey] = 'stored'; continue; } // reuse persisted
    if (stored !== undefined) {
      throw new Error(`${file} exists but ${key} is missing — Neuma will not regenerate over an existing secrets file`);
    }
    const value = crypto.randomBytes(32).toString('hex');     // 256-bit, generated once
    record[key] = value;
    env[envKey] = value;
    sources[envKey] = 'generated';
    generated.push(envKey);
    dirty = true;
  }

  if (dirty) writeSecrets(file, record);
  // the env file dotenv loaded (backend/server.js: the working directory's) closes to its owner too
  return { generated, file: dirty ? file : null, folder: closeFolder(path.dirname(file)), envFile: closeFile(path.resolve('.env')) };
};
