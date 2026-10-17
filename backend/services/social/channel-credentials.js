// Channel credentials — the witness's social platform keys, encrypted at rest.
//
// Same posture as provider-credentials: these are the OPERATOR'S outward-facing
// account secrets (one X account per box), not neuma-sovereign data, so the
// whole store is one AES-256-GCM envelope via workspace-crypto, written 0600
// under data/settings. Field resolution is store > env (> catalog fallback),
// so Settings is the primary surface while .env keeps the bootstrap working.
//
// A raw credential never leaves this module except through
// resolveChannelCredential — everything the API sees is masked in the registry.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { encryptEnvelope, parseAndDecrypt } from '../../../core/workspace/workspace-crypto.js';
import { getChannel, resolveChannelCredentials } from './channel-registry.js';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';

const SETTINGS_DIR = getSettingsDir();

// Overridable per call (not at import) so tests exercising the REAL persist +
// encrypt path never touch the operator's live store.
export const channelCredentialsPath = () =>
  process.env.NEUMA_SOCIAL_CREDENTIALS_PATH || join(SETTINGS_DIR, 'social-channel-credentials.json');

// Serialize read-modify-write so two concurrent mutations can't interleave
// across their read+write awaits and clobber one channel with a stale store.
// A failed mutation never poisons the chain.
const serialize = createWriteChain();

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

// impure — reads + decrypts the store. Missing file = "no credentials yet";
// a file that fails to decrypt is surfaced, never swallowed, so a rotated
// master key can't silently wipe every stored account on the next save.
export const loadChannelCredentials = async () => {
  let raw;
  try {
    raw = await fs.readFile(channelCredentialsPath(), 'utf8');
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

// impure — encrypts + persists the whole store. Dir 0700, file 0600; write to
// a temp file then rename so a concurrent reader never sees a torn envelope;
// re-tighten modes every save (mkdir/writeFile only apply mode on creation).
export const saveChannelCredentials = async (store) => {
  const target = channelCredentialsPath();
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const envelope = encryptEnvelope(store);
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(envelope, null, 2), { mode: 0o600 });
  await fs.rename(tmp, target);
  await fs.chmod(dirname(target), 0o700);
  await fs.chmod(target, 0o600);
};

/**
 * Set (or clear fields of) a channel's credential and persist. Rejects unknown
 * channel ids so a typo can't seed an unroutable secret.
 * @param {string} channelId
 * @param {Record<string, string>} patch
 */
// impure
export const setChannelCredential = async (channelId, patch) => {
  const channel = getChannel(channelId);
  if (!channel) throw new Error(`Unknown channel: ${channelId}`); // reject before queuing
  return serialize(async () => {
    const store = await loadChannelCredentials();
    const merged = mergeChannelCredential(channel, store[channelId], patch || {});
    if (merged) store[channelId] = merged;
    else delete store[channelId];
    await saveChannelCredentials(store);
    return store[channelId] || null;
  });
};

// impure
export const removeChannelCredential = async (channelId) => serialize(async () => {
  const store = await loadChannelCredentials();
  if (store[channelId] === undefined) return false;
  delete store[channelId];
  await saveChannelCredentials(store);
  return true;
});

/**
 * Resolve the actual credentials for a channel call, applying the store > env
 * (> fallback) precedence per field. This is the ONLY path that exposes raw
 * values — callers pass them straight into the platform request, never to a
 * client. Null unless the full set is present.
 * @param {string} channelId
 * @param {Object} [store] pre-loaded store (avoids a second disk read)
 * @returns {Promise<Readonly<Record<string, string>>|null>}
 */
// impure — reads env (and disk when no store given)
export const resolveChannelCredential = async (channelId, store) => {
  const channel = getChannel(channelId);
  if (!channel) return null;
  const s = store || await loadChannelCredentials();
  return resolveChannelCredentials(channel, s[channelId], process.env);
};
