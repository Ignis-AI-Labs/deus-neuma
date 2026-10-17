/** Encrypted credential persistence with private, file-identity-scoped read snapshots. */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { encryptEnvelope, parseAndDecrypt } from '../../core/workspace/workspace-crypto.js';
import { getSettingsDir } from './data-root.js';

const SETTINGS_DIR = getSettingsDir();
let cached = null;

/** impure — resolve the operator store or an explicitly isolated runtime override. */
export const credentialsPath = () =>
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH || join(SETTINGS_DIR, 'provider-credentials.json');

// impure — include crypto context without retaining another plaintext key copy.
const cacheIdentity = (target, stat) => createHash('sha256').update(JSON.stringify([
  target,
  ...['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode'].map((field) => String(stat[field])),
  process.env.DNA_ENCRYPTION_KEY || '', process.env.DNA_ENCRYPTION_KEY_PREVIOUS || '',
])).digest('hex');

// impure — decryption errors and invalid store shapes must remain visible.
const parseStore = (raw) => {
  const parsed = parseAndDecrypt(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('provider-credentials: decrypted store is not an object');
  }
  return parsed;
};

/** impure — opening on every read preserves filesystem authority even on a cache hit. */
export const loadCredentials = async () => {
  const target = resolve(credentialsPath());
  let file;
  try {
    file = await fs.open(target, 'r');
    const identity = cacheIdentity(target, await file.stat({ bigint: true }));
    if (cached?.identity === identity) return structuredClone(cached.value);
    const parsed = parseStore(await file.readFile('utf8'));
    if (cacheIdentity(target, await file.stat({ bigint: true })) === identity) {
      cached = { identity, value: parsed };
    }
    return structuredClone(parsed);
  } catch (err) {
    cached = null;
    if (err.code === 'ENOENT') return {};
    throw err;
  } finally {
    await file?.close();
  }
};

/** impure — atomic encrypted replacement; successful saves revoke the cached snapshot. */
export const saveCredentials = async (store) => {
  const target = credentialsPath();
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const envelope = encryptEnvelope(store);
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(envelope, null, 2), { mode: 0o600 });
  await fs.rename(tmp, target);
  cached = null;
  // Creation modes do not tighten pre-existing directories or restored files.
  await fs.chmod(dirname(target), 0o700);
  await fs.chmod(target, 0o600);
};
