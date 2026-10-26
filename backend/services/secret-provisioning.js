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

// env var → the field it is stored under in the secrets file
const MANAGED = Object.freeze([
  { env: 'DNA_ENCRYPTION_KEY', key: 'dnaEncryptionKey' },
  { env: 'AUTH_SECRET', key: 'authSecret' },
]);

/** Resolve the secrets file path (overridable for packaging/tests). */
export const secretsFilePath = () =>
  process.env.NEUMA_SECRETS_FILE || path.join(os.homedir(), '.neuma', 'secrets.json');

const readSecrets = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

const writeSecrets = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
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
  // A keychain-locked record (electron/key-lock) holds no plain key: minting one
  // here would strand every being encrypted under the locked one.
  if (stored.v === 2 && MANAGED.some(({ env: envKey }) => !env[envKey])) {
    throw new Error(`${file} is locked by the desk's keychain — start Neuma from the app, or set the keys in the environment`);
  }
  const generated = [];
  let dirty = false;

  for (const { env: envKey, key } of MANAGED) {
    if (env[envKey]) continue;                 // explicit env wins — never overwrite
    if (stored[key]) { env[envKey] = stored[key]; continue; } // reuse persisted
    const value = crypto.randomBytes(32).toString('hex');     // 256-bit, generated once
    stored[key] = value;
    env[envKey] = value;
    generated.push(envKey);
    dirty = true;
  }

  if (dirty) writeSecrets(file, stored);
  return { generated, file: dirty ? file : null, folder: closeFolder(path.dirname(file)) };
};
