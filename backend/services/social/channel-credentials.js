// Channel credentials — each house's social platform keys, encrypted at rest.
//
// Same posture as provider-credentials: these are the OPERATOR'S outward-facing
// account secrets, not neuma-sovereign data, so a house's store is one
// AES-256-GCM envelope via workspace-crypto, written 0600 in its operator's
// realm dir (house-positions.js) — one account per channel per HOUSE. Field
// resolution is store > env (> catalog fallback), so Settings is the primary
// surface while .env keeps the bootstrap working.
//
// THE MACHINE'S .env KEYS belong to no house on record, so they serve a house
// only while no OTHER house on this machine holds the channel: the second
// house to bind a channel brings its own keys. The machine-wide store written
// before 2026-10-19 records no owner at all, so it serves no house; it is
// named loudly once and left for the operator to place.
//
// A raw credential never leaves this module except through
// resolveChannelCredential — everything the API sees is masked in the registry.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { encryptEnvelope, parseAndDecrypt } from '../../../core/workspace/workspace-crypto.js';
import { getChannel, resolveChannelCredentials, maskChannelCredentials } from './channel-registry.js';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';
import { houseKey } from '../staff/cos-designation.js';
import { housePositionFile } from './house-positions.js';
import { channelBindings } from './channel-bindings.js';
import { createLogger } from '../logger.js';

const log = createLogger('SocialChannels.Credentials');

const SETTINGS_DIR = getSettingsDir();
const FILE = 'social-channel-credentials.json';

// The machine-wide store from before the houses. Overridable per call (not at
// import) so tests never read the operator's.
const legacyCredentialsPath = () =>
  process.env.NEUMA_SOCIAL_CREDENTIALS_PATH || join(SETTINGS_DIR, FILE);

/** A house's credential store file. Throws without a house. */
export const channelCredentialsPath = (wallet) => housePositionFile(wallet, FILE);

// Serialize read-modify-write so two concurrent mutations can't interleave
// across their read+write awaits and clobber one channel with a stale store.
// A failed mutation never poisons the chain.
const serialize = createWriteChain();

// impure — say once per process that a machine-wide store stands unplaced.
let legacyNamed = false;
const nameUnplacedLegacy = async () => {
  if (legacyNamed) return;
  legacyNamed = true;
  const raw = await fs.readFile(legacyCredentialsPath(), 'utf8').catch(() => null);
  if (raw === null) return;
  log.error('the machine-wide social credential store names no house — it serves no house until the operator stores the keys again in their own house', {
    file: legacyCredentialsPath(),
  });
};

/**
 * What is wrong with a pasted key, in the person's words, or null (pure). A
 * developer page shows a secret as a row of dots until it is revealed, and
 * copying it then copies the dots (2026-10-23: a TikTok secret saved as 17 •).
 * @param {string} value - already trimmed
 * @returns {string|null}
 */
export const pastedKeyProblem = (value) => (/^[•●·∙*]+$/.test(value)
  ? 'that is the hidden placeholder (dots), not the key — reveal it on the developer page (the eye or arrow beside it), then copy it'
  : null);

/**
 * Merge a credential patch onto an existing entry, keeping only the channel's
 * declared fields (pure). An empty-string value clears that field so the UI
 * can wipe a stored secret. Returns null when nothing worth persisting remains.
 * @param {import('./channel-registry.js').ChannelEntry} channel
 * @param {Record<string, string>|undefined} existing
 * @param {Record<string, string>} patch
 * @returns {Record<string, string>|null}
 */
export const mergeChannelCredential = (channel, existing, patch) => {
  const next = {};
  for (const f of channel.fields) {
    const patched = patch[f.key];
    if (patched !== undefined) {
      if (typeof patched === 'string' && patched.length > 0) next[f.key] = patched;
      // empty string (or non-string) = clear — the field is simply not carried
    } else if (typeof existing?.[f.key] === 'string' && existing[f.key].length > 0) {
      next[f.key] = existing[f.key];
    }
  }
  return Object.keys(next).length > 0 ? next : null;
};

// impure — reads + decrypts a house's store. No house, or a missing file =
// "no credentials yet"; a file that fails to decrypt is surfaced, never
// swallowed, so a rotated master key can't silently wipe every stored account
// on the next save.
export const loadChannelCredentials = async (wallet) => {
  if (!houseKey(wallet)) return {};
  await nameUnplacedLegacy();
  let raw;
  try {
    raw = await fs.readFile(channelCredentialsPath(wallet), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  const parsed = parseAndDecrypt(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('channel-credentials: decrypted store is not an object');
  }
  return parsed;
};

// impure — encrypts + persists a house's whole store. Dir 0700, file 0600;
// write to a temp file then rename so a concurrent reader never sees a torn
// envelope; re-tighten modes every save (mkdir/writeFile only apply mode on
// creation).
export const saveChannelCredentials = async (wallet, store) => {
  const target = channelCredentialsPath(wallet);
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const envelope = encryptEnvelope(store);
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(envelope, null, 2), { mode: 0o600 });
  await fs.rename(tmp, target);
  await fs.chmod(dirname(target), 0o700);
  await fs.chmod(target, 0o600);
};

/**
 * Set (or clear fields of) a channel's credential in a house and persist.
 * Rejects unknown channel ids so a typo can't seed an unroutable secret, and
 * a caller with no house.
 * @param {string} wallet - the house
 * @param {string} channelId
 * @param {Record<string, string>} patch
 */
// impure
export const setChannelCredential = async (wallet, channelId, patch) => {
  const channel = getChannel(channelId);
  if (!channel) throw new Error(`Unknown channel: ${channelId}`); // reject before queuing
  channelCredentialsPath(wallet);
  return serialize(async () => {
    const store = await loadChannelCredentials(wallet);
    const merged = mergeChannelCredential(channel, store[channelId], patch || {});
    if (merged) store[channelId] = merged;
    else delete store[channelId];
    await saveChannelCredentials(wallet, store);
    return store[channelId] || null;
  });
};

// impure
export const removeChannelCredential = async (wallet, channelId) => serialize(async () => {
  const store = await loadChannelCredentials(wallet);
  if (store[channelId] === undefined) return false;
  delete store[channelId];
  await saveChannelCredentials(wallet, store);
  return true;
});

/**
 * The env snapshot a house may resolve a channel against: the machine's .env
 * keys, unless another house on this machine holds the channel. impure.
 * @param {string} wallet
 * @param {{id: string, fields: Array<{env: string}>}} channel
 * @param {{holdersBesides: Function}} [bindings] - the position store holding the channel
 */
export const houseEnvFor = async (wallet, channel, bindings = channelBindings) => {
  if (!channel.fields.some((f) => process.env[f.env])) return {};
  return (await bindings.holdersBesides(wallet, channel.id)).length ? {} : process.env;
};

/**
 * One channel's masked credential state as this house sees it — its own
 * store, and the .env keys only where houseEnvFor lets them serve. impure.
 * @param {string} wallet
 * @param {Object} channel - a channel (or the email account) catalog entry
 * @param {Object} store - the house's loaded store
 * @param {{holdersBesides: Function}} [bindings] - the position store holding the channel
 */
export const maskHouseCredentials = async (wallet, channel, store, bindings = channelBindings) =>
  maskChannelCredentials(channel, store[channel.id], await houseEnvFor(wallet, channel, bindings));

/**
 * Resolve the actual credentials for a house's channel call, applying the
 * store > env (> fallback) precedence per field. This is the ONLY path that
 * exposes raw values — callers pass them straight into the platform request,
 * never to a client. Null unless the full set is present, and null for a
 * caller with no house.
 * @param {string} wallet - the house
 * @param {string} channelId
 * @param {Object} [store] the house's pre-loaded store (avoids a second disk read)
 * @returns {Promise<Readonly<Record<string, string>>|null>}
 */
// impure — reads env (and disk when no store given)
export const resolveChannelCredential = async (wallet, channelId, store) => {
  const channel = getChannel(channelId);
  if (!channel || !houseKey(wallet)) return null;
  const s = store || await loadChannelCredentials(wallet);
  return resolveChannelCredentials(channel, s[channelId], await houseEnvFor(wallet, channel));
};
