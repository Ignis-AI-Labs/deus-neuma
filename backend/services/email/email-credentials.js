// email-credentials.js — each house's email account secrets, encrypted at
// rest. Same posture as social/channel-credentials: these are the OPERATOR'S
// outward-facing account secrets (one email account per HOUSE), not
// neuma-sovereign data, so a house's store is one AES-256-GCM envelope via
// workspace-crypto, written 0600 in its operator's realm dir
// (social/house-positions.js). Resolution is store > env > catalog fallback,
// so Settings is the primary surface while .env keeps the bootstrap working —
// and the machine's .env keys serve a house only while no other house holds
// the mailbox. The machine-wide store from before the houses records no
// owner, so it serves no house.
//
// A raw credential never leaves this module except through
// resolveEmailCredential — everything the API sees is masked.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { encryptEnvelope, parseAndDecrypt } from '../../../core/workspace/workspace-crypto.js';
import { resolveChannelCredentials } from '../social/channel-registry.js';
import { mergeChannelCredential, houseEnvFor } from '../social/channel-credentials.js';
import { houseKey } from '../staff/cos-designation.js';
import { housePositionFile } from '../social/house-positions.js';
import { emailBinding } from './email-binding.js';
import { EMAIL_ACCOUNT } from './email-registry.js';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';
import { createLogger } from '../logger.js';

const log = createLogger('Email.Credentials');

const SETTINGS_DIR = getSettingsDir();
const FILE = 'email-credentials.json';

// The machine-wide store from before the houses. Overridable per call (not at
// import) so tests never read the operator's.
const legacyCredentialsPath = () =>
  process.env.NEUMA_EMAIL_CREDENTIALS_PATH || join(SETTINGS_DIR, FILE);

/** A house's email credential file. Throws without a house. */
export const emailCredentialsPath = (wallet) => housePositionFile(wallet, FILE);

// Serialize read-modify-write so two concurrent mutations can't interleave
// across their read+write awaits. A failed mutation never poisons the chain.
const serialize = createWriteChain();

// impure — say once per process that a machine-wide store stands unplaced.
let legacyNamed = false;
const nameUnplacedLegacy = async () => {
  if (legacyNamed) return;
  legacyNamed = true;
  const raw = await fs.readFile(legacyCredentialsPath(), 'utf8').catch(() => null);
  if (raw === null) return;
  log.error('the machine-wide email credential store names no house — it serves no house until the operator stores the keys again in their own house', {
    file: legacyCredentialsPath(),
  });
};

// impure — reads + decrypts a house's store. No house, or a missing file =
// "no credentials yet"; a file that fails to decrypt is surfaced, never
// swallowed.
export const loadEmailCredentials = async (wallet) => {
  if (!houseKey(wallet)) return {};
  await nameUnplacedLegacy();
  let raw;
  try {
    raw = await fs.readFile(emailCredentialsPath(wallet), 'utf8');
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
const saveEmailCredentials = async (wallet, store) => {
  const target = emailCredentialsPath(wallet);
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const envelope = encryptEnvelope(store);
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(envelope, null, 2), { mode: 0o600 });
  await fs.rename(tmp, target);
  await fs.chmod(dirname(target), 0o700);
  await fs.chmod(target, 0o600);
};

/**
 * Set (or clear fields of) a house's account credential and persist. Reuses
 * the social layer's pure merge (empty string clears a field).
 * @param {string} wallet - the house
 * @param {Record<string, string>} patch
 */
// impure
export const setEmailCredential = async (wallet, patch) => {
  emailCredentialsPath(wallet);
  return serialize(async () => {
    const store = await loadEmailCredentials(wallet);
    const merged = mergeChannelCredential(EMAIL_ACCOUNT, store[EMAIL_ACCOUNT.id], patch || {});
    if (merged) store[EMAIL_ACCOUNT.id] = merged;
    else delete store[EMAIL_ACCOUNT.id];
    await saveEmailCredentials(wallet, store);
    return store[EMAIL_ACCOUNT.id] || null;
  });
};

// impure
export const removeEmailCredential = async (wallet) => serialize(async () => {
  const store = await loadEmailCredentials(wallet);
  if (store[EMAIL_ACCOUNT.id] === undefined) return false;
  delete store[EMAIL_ACCOUNT.id];
  await saveEmailCredentials(wallet, store);
  return true;
});

// impure — the env snapshot this house may resolve the mailbox against.
const emailEnvFor = (wallet) => houseEnvFor(wallet, EMAIL_ACCOUNT, emailBinding);

/**
 * Resolve a house's actual account credentials for a protocol call,
 * applying the store > env > fallback precedence per field. This is the ONLY
 * path that exposes raw values — callers pass them straight into the TLS
 * session, never to a client. Null unless the full set is present, and null
 * for a caller with no house.
 * @param {string} wallet - the house
 * @param {Object} [store] the house's pre-loaded store (avoids a second disk read)
 * @returns {Promise<Readonly<Record<string, string>>|null>}
 */
// impure — reads env (and disk when no store given)
export const resolveEmailCredential = async (wallet, store) => {
  if (!houseKey(wallet)) return null;
  const s = store || await loadEmailCredentials(wallet);
  return resolveChannelCredentials(EMAIL_ACCOUNT, s[EMAIL_ACCOUNT.id], await emailEnvFor(wallet));
};
