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
const secretsFilePath = () =>
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
 * Ensure the at-rest secrets exist in process.env before config loads. Skipped
 * under NODE_ENV=test (tests use ephemeral per-process defaults). Idempotent.
 * @param {{ env?: Object }} [opts] - inject env for testing
 * @returns {{ generated: string[], file: (string|null) }} which keys were freshly
 *   generated, and the file written (null if nothing changed)
 */
export const ensureSecrets = ({ env = process.env } = {}) => {
  if (env.NODE_ENV === 'test') return { generated: [], file: null };

  const file = secretsFilePath();
  const stored = readSecrets(file);
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
  return { generated, file: dirty ? file : null };
};
