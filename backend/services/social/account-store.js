// account-store — a house's social APPS and ACCOUNTS on disk (campaign plan
// §2.4–2.5), in the house's one encrypted credential store: AES-256-GCM via
// workspace-crypto, 0600 in a 0700 dir, in its operator's realm dir
// (house-positions.js). There is no second secret store: apps and accounts are
// entries in this one.
//
// THE MIGRATION. A store written before accounts is v1 (`{[channelId]:
// fields}`). The first read of a v1 store in a process migrates it, under the
// store's write lock:
//   1. the v1 file is copied, byte for byte (it is already sealed), to
//      `social-channel-credentials.v1.json` beside it, 0400 — read-only, kept
//      until the operator clears it. A backup already there with other
//      content is never overwritten; the new copy takes a dated name;
//   2. the v2 store is computed (account-migrate.js, pure);
//   3. it is written to a temp file and renamed over the v1 file.
// A crash before (3) leaves the v1 file in place, and the next read migrates
// again; a v2 store is never migrated. What moved is logged by FIELD NAME —
// never a value (Rule 8).
//
// THE MACHINE'S .env KEYS belong to no house on record, so they serve a house
// only while no OTHER house on this machine holds the channel. App fields from
// .env serve every account on the house's own app; account fields from .env
// serve only `<channel>-1`, the account every pre-accounts caller meant.
//
// A raw credential leaves this module only through resolveAccountCredential.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { encryptEnvelope, parseAndDecrypt } from '../../../core/workspace/workspace-crypto.js';
import { CHANNEL_CATALOG, getChannel, resolveChannelCredentials, maskChannelCredentials } from './channel-registry.js';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';
import { houseKey } from '../staff/cos-designation.js';
import { housePositionFile } from './house-positions.js';
import { channelBindings } from './channel-bindings.js';
import { createLogger } from '../logger.js';
import {
  isV2, emptyStore, channelOfAccountId, firstAccountId, storedFieldsOf, appIdOf, nextAccountId,
  patchAccount, withAccountMeta, withoutAccount, accountMetaRefusal,
} from './account-shape.js';
import { migrateV1 } from './account-migrate.js';

const log = createLogger('SocialChannels.Accounts');

const FILE = 'social-channel-credentials.json';
const BACKUP = 'social-channel-credentials.v1.json';

// The machine-wide store from before the houses. Overridable per call (not at
// import) so tests never read the operator's.
const legacyCredentialsPath = () =>
  process.env.NEUMA_SOCIAL_CREDENTIALS_PATH || join(getSettingsDir(), FILE);

/** A house's credential store file. Throws without a house. */
export const channelCredentialsPath = (wallet) => housePositionFile(wallet, FILE);

/** The v1 store's kept copy, beside the store. Throws without a house. */
export const v1BackupPath = (wallet) => housePositionFile(wallet, BACKUP);

// One write chain for every house's store: a migration, a CONNECT and a token
// refresh can never interleave their read+write and clobber each other.
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

// impure — the sealed file and what it decrypts to; {raw: null} when absent. A
// file that fails to decrypt is surfaced, never swallowed, so a rotated master
// key can't silently wipe every stored account on the next save.
const readSealed = async (wallet) => {
  let raw;
  try {
    raw = await fs.readFile(channelCredentialsPath(wallet), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { raw: null, store: null };
    throw err;
  }
  const store = parseAndDecrypt(raw);
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('channel-credentials: decrypted store is not an object');
  }
  return { raw, store };
};

/**
 * Encrypt and persist a house's whole store object, as given. Dir 0700, file
 * 0600; written to a temp file then renamed so a concurrent reader never sees
 * a torn envelope; modes re-tightened every save (mkdir/writeFile only apply
 * a mode on creation). impure.
 */
export const writeCredentialStore = async (wallet, store) => {
  const target = channelCredentialsPath(wallet);
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(encryptEnvelope(store), null, 2), { mode: 0o600 });
  await fs.rename(tmp, target);
  await fs.chmod(dirname(target), 0o700);
  await fs.chmod(target, 0o600);
};

// impure — keep the v1 file's exact bytes beside the store, read-only.
const keepV1Copy = async (wallet, raw) => {
  const backup = v1BackupPath(wallet);
  const prior = await fs.readFile(backup, 'utf8').catch(() => null);
  if (prior === raw) return backup;
  const target = prior === null ? backup : `${backup.replace(/\.json$/, '')}.${Date.now()}.json`;
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, raw, { mode: 0o600 });
  await fs.rename(tmp, target);
  await fs.chmod(target, 0o400);
  return target;
};

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

// impure — the env one account may resolve against: app fields for an account
// on the house's own app, account fields for `<channel>-1` only.
const accountEnvFor = async (wallet, channel, accountId, account) => {
  const env = await houseEnvFor(wallet, channel);
  const onHouseApp = appIdOf(account, accountId) === channel.id;
  const first = accountId === firstAccountId(channel.id);
  const out = {};
  for (const f of channel.fields) {
    if ((f.app && onHouseApp) || (!f.app && first)) out[f.env] = env[f.env];
  }
  return out;
};

// impure — the channels the .env keys serve this house with, for the migration.
const envServedChannels = async (wallet, v1) => {
  const out = [];
  for (const { id } of CHANNEL_CATALOG) {
    const channel = getChannel(id);
    if (!channel || v1[id]) continue;
    if (resolveChannelCredentials(channel, undefined, await houseEnvFor(wallet, channel))) out.push(id);
  }
  return out;
};

// impure — v1 → v2 for one house, inside the write chain.
const migrate = async (wallet, raw, v1) => {
  const { houseDefaultCompany } = await import('../marketing/companies.js');
  const company = await houseDefaultCompany(wallet).catch((err) => ({ companyId: null, why: `the company could not be read (${err.message})` }));
  const backup = await keepV1Copy(wallet, raw);
  const { store, moved, unplaced } = migrateV1(v1, {
    defaultCompanyId: company.companyId,
    envChannels: await envServedChannels(wallet, v1),
  });
  await writeCredentialStore(wallet, store);
  log.info('the house\'s social keys now stand as accounts (v1 → v2)', {
    house: houseKey(wallet),
    company: company.companyId ?? 'UNSORTED',
    companyWhy: company.why,
    moved: moved.map((m) => `${m.channelId} → ${m.accountId} (${m.source}; app: ${m.appFields.join(',') || '—'}; account: ${m.accountFields.join(',') || '—'})`),
    ...(unplaced.length ? { unplaced } : {}),
    backup,
  });
  return store;
};

// impure — the v2 store; migrates a v1 store. Call inside the write chain.
const loadUnlocked = async (wallet) => {
  const { raw, store } = await readSealed(wallet);
  if (raw === null) return emptyStore();
  if (isV2(store)) return store;
  return migrate(wallet, raw, store);
};

/**
 * A house's v2 store (apps + accounts). A caller with no house holds none;
 * a v1 store is migrated on this read. impure.
 * @param {string} wallet
 */
export const loadAccountStore = async (wallet) => {
  if (!houseKey(wallet)) return emptyStore();
  await nameUnplacedLegacy();
  const { raw, store } = await readSealed(wallet);
  if (raw === null) return emptyStore();
  if (isV2(store)) return store;
  return serialize(() => loadUnlocked(wallet));
};

/**
 * Change a house's store under the write chain: `fn(store)` returns the next
 * store, or the same object to write nothing. impure.
 * @returns {Promise<object>} the store as written
 */
export const mutateAccountStore = async (wallet, fn) => {
  channelCredentialsPath(wallet);
  return serialize(async () => {
    const store = await loadUnlocked(wallet);
    const next = fn(store);
    if (next !== store) await writeCredentialStore(wallet, next);
    return next;
  });
};

/**
 * Resolve one account's credentials for a platform call: app fields beneath
 * the account's, store > env (> fallback) per field. The ONLY path that
 * exposes raw values — callers pass them straight into the platform request,
 * never to a client. Null unless the full set is present, and null for a
 * caller with no house. impure.
 * @param {string} wallet - the house
 * @param {string} accountId - `<channel>-<n>`
 * @param {object} [store] - the house's pre-loaded v2 store
 * @returns {Promise<Readonly<Record<string, string>>|null>}
 */
export const resolveAccountCredential = async (wallet, accountId, store) => {
  const channel = getChannel(channelOfAccountId(accountId));
  if (!channel || !houseKey(wallet)) return null;
  const s = store || await loadAccountStore(wallet);
  const account = s.accounts?.[accountId];
  if (!account && accountId !== firstAccountId(channel.id)) return null;
  return resolveChannelCredentials(channel, storedFieldsOf(s, accountId), await accountEnvFor(wallet, channel, accountId, account));
};

/**
 * Every account of the house, masked: facts and which fields are set and
 * from where, never a value. `<channel>-1` stands even with no record while
 * the .env keys serve the house on that platform. impure.
 * @param {string} wallet
 * @param {object} [store]
 */
export const listAccounts = async (wallet, store) => {
  const s = store || await loadAccountStore(wallet);
  const ids = new Set(Object.keys(s.accounts || {}).filter(channelOfAccountId));
  for (const { id } of CHANNEL_CATALOG) {
    const first = firstAccountId(id);
    if (!ids.has(first) && await resolveAccountCredential(wallet, first, s)) ids.add(first);
  }
  const out = [];
  for (const accountId of ids) {
    const channel = getChannel(channelOfAccountId(accountId));
    const account = s.accounts?.[accountId] || null;
    const env = await accountEnvFor(wallet, channel, accountId, account);
    const masked = maskChannelCredentials(channel, storedFieldsOf(s, accountId), env);
    out.push(Object.freeze({
      id: accountId,
      channelId: channel.id,
      channelName: channel.name,
      companyId: account?.companyId ?? null,
      label: account?.label || '',
      expectedHandle: account?.expectedHandle ?? null,
      platformUserId: account?.platformUserId ?? null,
      appId: appIdOf(account, accountId),
      recorded: Boolean(account),
      configured: masked.configured,
      fields: masked.fields,
    }));
  }
  return out.sort((a, b) => a.channelId.localeCompare(b.channelId) || a.id.localeCompare(b.id, undefined, { numeric: true }));
};

/** Open a new account on a platform: the next never-used id. impure. */
export const addAccount = async (wallet, channelId, meta = {}, companies = []) => {
  if (!getChannel(channelId)) return { ok: false, error: `Unknown channel: ${channelId}` };
  const refusal = accountMetaRefusal(meta, companies);
  if (refusal) return { ok: false, error: refusal };
  let accountId;
  await mutateAccountStore(wallet, (store) => {
    accountId = nextAccountId(store, channelId);
    return patchAccount(store, accountId, {}, { meta });
  });
  return { ok: true, accountId };
};

/** Set (or clear) an account's credential fields; app fields go to its app. impure. */
export const setAccountFields = async (wallet, accountId, patch) => {
  if (!channelOfAccountId(accountId)) throw new Error(`not an account id: ${accountId}`);
  await mutateAccountStore(wallet, (store) => patchAccount(store, accountId, patch || {}));
};

/** Change an account's facts (company, label, expected handle). impure. */
export const setAccountMeta = async (wallet, accountId, patch, companies) => {
  const refusal = accountMetaRefusal(patch, companies);
  if (refusal) return { ok: false, error: refusal };
  let found = false;
  await mutateAccountStore(wallet, (store) => {
    const recorded = Boolean(store.accounts?.[accountId]);
    // `<channel>-1` served by .env alone has no record yet: its first fact makes one.
    if (!recorded && accountId !== firstAccountId(channelOfAccountId(accountId))) return store;
    found = true;
    return withAccountMeta(recorded ? store : patchAccount(store, accountId, {}), accountId, patch);
  });
  return found ? { ok: true } : { ok: false, error: `there is no account ${accountId} in this house` };
};

/** Remove an account (and its app when no account still uses it). impure. */
export const removeAccount = async (wallet, accountId) => {
  let removed = false;
  await mutateAccountStore(wallet, (store) => {
    if (!store.accounts?.[accountId]) return store;
    removed = true;
    return withoutAccount(store, accountId);
  });
  return removed;
};
