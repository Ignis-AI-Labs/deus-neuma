// email-credentials.js — the witness's email account secrets, encrypted at
// rest. Same posture as social/channel-credentials: these are the OPERATOR'S
// outward-facing account secrets (one email account per box), not
// neuma-sovereign data, so the store is one AES-256-GCM envelope via
// workspace-crypto, written 0600 under data/settings. Resolution is
// store > env > catalog fallback, so Settings is the primary surface while
// .env keeps the bootstrap working.
//
// A raw credential never leaves this module except through
// resolveEmailCredential — everything the API sees is masked.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { encryptEnvelope, parseAndDecrypt } from '../../../core/workspace/workspace-crypto.js';
import { resolveChannelCredentials } from '../social/channel-registry.js';
import { mergeChannelCredential } from '../social/channel-credentials.js';
import { EMAIL_ACCOUNT } from './email-registry.js';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';

const SETTINGS_DIR = getSettingsDir();

// Overridable per call (not at import) so tests exercising the REAL persist +
// encrypt path never touch the operator's live store.
export const emailCredentialsPath = () =>
  process.env.NEUMA_EMAIL_CREDENTIALS_PATH || join(SETTINGS_DIR, 'email-credentials.json');

// Serialize read-modify-write so two concurrent mutations can't interleave
// across their read+write awaits. A failed mutation never poisons the chain.
const serialize = createWriteChain();

// impure — reads + decrypts the store. Missing file = "no credentials yet";
// a file that fails to decrypt is surfaced, never swallowed.
export const loadEmailCredentials = async () => {
  let raw;
  try {
    raw = await fs.readFile(emailCredentialsPath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  const parsed = parseAndDecrypt(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('email-credentials: decrypted store is not an object');
  }
  return parsed;
};

// impure — encrypts + persists. Dir 0700, file 0600; temp-file + rename so a
// concurrent reader never sees a torn envelope; modes re-tightened each save.
const saveEmailCredentials = async (store) => {
  const target = emailCredentialsPath();
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const envelope = encryptEnvelope(store);
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(envelope, null, 2), { mode: 0o600 });
  await fs.rename(tmp, target);
  await fs.chmod(dirname(target), 0o700);
  await fs.chmod(target, 0o600);
};

/**
 * Set (or clear fields of) the account credential and persist. Reuses the
 * social layer's pure merge (empty string clears a field).
 * @param {Record<string, string>} patch
 */
// impure
export const setEmailCredential = async (patch) => serialize(async () => {
  const store = await loadEmailCredentials();
  const merged = mergeChannelCredential(EMAIL_ACCOUNT, store[EMAIL_ACCOUNT.id], patch || {});
  if (merged) store[EMAIL_ACCOUNT.id] = merged;
  else delete store[EMAIL_ACCOUNT.id];
  await saveEmailCredentials(store);
  return store[EMAIL_ACCOUNT.id] || null;
});

// impure
export const removeEmailCredential = async () => serialize(async () => {
  const store = await loadEmailCredentials();
  if (store[EMAIL_ACCOUNT.id] === undefined) return false;
  delete store[EMAIL_ACCOUNT.id];
  await saveEmailCredentials(store);
  return true;
});

/**
 * Resolve the actual account credentials for a protocol call, applying the
 * store > env > fallback precedence per field. This is the ONLY path that
 * exposes raw values — callers pass them straight into the TLS session,
 * never to a client. Null unless the full set is present.
 * @param {Object} [store] pre-loaded store (avoids a second disk read)
 * @returns {Promise<Readonly<Record<string, string>>|null>}
 */
// impure — reads env (and disk when no store given)
export const resolveEmailCredential = async (store) => {
  const s = store || await loadEmailCredentials();
  return resolveChannelCredentials(EMAIL_ACCOUNT, s[EMAIL_ACCOUNT.id], process.env);
};
