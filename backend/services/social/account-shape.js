// account-shape — the pure law of a house's social APPS and ACCOUNTS
// (campaign plan §2.4, decided 2026-10-23).
//
// A house markets several companies, each with several accounts per platform
// (two TikTok accounts, three X accounts…). Every platform lets ONE developer
// app serve many authorized accounts, so the house's credential store holds:
//
//   { v: 2,
//     apps:     { [appId]: { [field]: value } }      the developer app; appId is the
//                                                     channel id (one app per platform
//                                                     per house) unless an account names
//                                                     another
//     accounts: { [accountId]: { channelId, companyId, label, expectedHandle,
//                                platformUserId, appId, fields, addedAt } }
//     serial:   { [channelId]: n } }                 the last number issued — ids are
//                                                     never reused
//
// An account id is `<channel>-<n>` (`x-1`, `tiktok-2`). The account every
// pre-accounts caller meant by "the house's X" is `<channel>-1`.
//
// Pure throughout; disk is account-store.js.

import { getChannel } from './channel-registry.js';

export const STORE_VERSION = 2;

const ACCOUNT_ID = /^([a-z]+)-([1-9][0-9]{0,4})$/;

/** A v2 store, whatever was read (pure). */
export const isV2 = (store) => Boolean(store) && typeof store === 'object' && store.v === STORE_VERSION;

/** An empty v2 store (pure). */
export const emptyStore = () => ({ v: STORE_VERSION, apps: {}, accounts: {}, serial: {} });

/** The id of a channel's nth account (pure). */
const accountIdFor = (channelId, n) => `${channelId}-${n}`;

/** The account a pre-accounts caller means by "the house's <channel>" (pure). */
export const firstAccountId = (channelId) => accountIdFor(channelId, 1);

/**
 * The channel an account id belongs to, or null when the id is not one (pure).
 * @param {unknown} accountId
 * @returns {?string}
 */
export const channelOfAccountId = (accountId) => {
  const m = ACCOUNT_ID.exec(String(accountId ?? ''));
  return m && getChannel(m[1]) ? m[1] : null;
};

/** The channel's fields the APP holds, and the ones each ACCOUNT holds (pure). */
const appFieldsOf = (channel) => channel.fields.filter((f) => f.app);
const accountFieldsOf = (channel) => channel.fields.filter((f) => !f.app);

/**
 * Merge a credential patch onto existing fields, keeping only the declared
 * fields (pure). An empty-string value clears that field so the UI can wipe a
 * stored secret. Returns null when nothing worth persisting remains.
 * @param {{fields: ReadonlyArray<{key: string}>}} channel - or any field subset
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

/** The next never-used account id on a channel (pure). */
export const nextAccountId = (store, channelId) => {
  const used = Object.keys(store.accounts || {})
    .filter((id) => channelOfAccountId(id) === channelId)
    .map((id) => Number(ACCOUNT_ID.exec(id)[2]));
  const n = Math.max(Number(store.serial?.[channelId]) || 0, ...used, 0) + 1;
  return accountIdFor(channelId, n);
};

/** The app an account posts through: its own `appId`, else its platform's (pure). */
export const appIdOf = (account, accountId) => account?.appId || account?.channelId || channelOfAccountId(accountId);

/**
 * One account's stored fields with its app's beneath them — the whole record
 * the platform call needs, before env (pure).
 * @param {object} store - v2
 * @param {string} accountId
 * @returns {Record<string, string>}
 */
export const storedFieldsOf = (store, accountId) => {
  const account = store.accounts?.[accountId];
  const app = store.apps?.[appIdOf(account, accountId)] || {};
  return { ...app, ...(account?.fields || {}) };
};

/**
 * The v1 view `{[channelId]: fields}` — app fields plus the first account's —
 * for the callers that still speak of "the house's <channel>" (pure).
 * @param {object} store - v2
 * @returns {Record<string, Record<string, string>>}
 */
export const firstAccountView = (store) => {
  const out = {};
  const channels = new Set([
    ...Object.keys(store.apps || {}).filter((id) => getChannel(id)),
    ...Object.keys(store.accounts || {}).map(channelOfAccountId).filter(Boolean),
  ]);
  for (const channelId of channels) {
    const fields = storedFieldsOf(store, firstAccountId(channelId));
    if (Object.keys(fields).length) out[channelId] = fields;
  }
  return out;
};

/**
 * Put a credential patch on one account (and its app's fields on its app)
 * (pure). Creates the account record when absent, with `meta` for a new one.
 * The record stays even when its fields empty: its company and label are
 * facts too, and the id is never issued again.
 * @param {object} store - v2
 * @param {string} accountId
 * @param {Record<string, string>} patch
 * @param {{meta?: object, at?: string}} [opts]
 */
export const patchAccount = (store, accountId, patch, { meta = {}, at = new Date().toISOString() } = {}) => {
  const channelId = channelOfAccountId(accountId);
  const channel = getChannel(channelId);
  if (!channel) throw new Error(`not an account id: ${accountId}`);
  const prior = store.accounts?.[accountId];
  const appId = appIdOf(prior || meta, accountId);
  const appNext = mergeChannelCredential({ fields: appFieldsOf(channel) }, store.apps?.[appId], patch || {});
  const fieldsNext = mergeChannelCredential({ fields: accountFieldsOf(channel) }, prior?.fields, patch || {});
  const apps = { ...store.apps };
  if (appFieldsOf(channel).some((f) => patch?.[f.key] !== undefined)) {
    if (appNext) apps[appId] = appNext;
    else delete apps[appId];
  }
  const n = Number(ACCOUNT_ID.exec(accountId)[2]);
  return {
    ...store,
    apps,
    accounts: {
      ...store.accounts,
      [accountId]: {
        channelId,
        companyId: null,
        label: '',
        expectedHandle: null,
        platformUserId: null,
        addedAt: at,
        ...(prior || {}),
        ...(prior ? {} : meta),
        fields: fieldsNext || {},
      },
    },
    serial: { ...store.serial, [channelId]: Math.max(Number(store.serial?.[channelId]) || 0, n) },
  };
};

/** The account facts an operator may change by hand (pure). */
const ACCOUNT_META_KEYS = Object.freeze(['companyId', 'label', 'expectedHandle', 'platformUserId']);

/**
 * What is wrong with an account metadata patch, or null (pure).
 * @param {object} patch
 * @param {ReadonlyArray<string>} companies - the house's company ids
 */
export const accountMetaRefusal = (patch, companies) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'an account change must be an object';
  for (const key of Object.keys(patch)) {
    if (!ACCOUNT_META_KEYS.includes(key)) return `"${key}" is not something an account carries (${ACCOUNT_META_KEYS.join(', ')})`;
  }
  if (patch.companyId !== undefined && patch.companyId !== null && !companies.includes(patch.companyId)) {
    return `there is no "${patch.companyId}" company in this house — its brand kit must exist first`;
  }
  for (const key of ['label', 'expectedHandle', 'platformUserId']) {
    const v = patch[key];
    if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > 120)) return `${key} must be short text`;
  }
  return null;
};

/** One account's facts with the patch applied (pure). */
export const withAccountMeta = (store, accountId, patch) => ({
  ...store,
  accounts: {
    ...store.accounts,
    [accountId]: { ...store.accounts[accountId], ...patch },
  },
});

/**
 * The store with one account gone, and its app too when no account of the
 * platform still names it (pure). The account number is never issued again.
 */
export const withoutAccount = (store, accountId) => {
  const account = store.accounts?.[accountId];
  if (!account) return store;
  const appId = appIdOf(account, accountId);
  const accounts = { ...store.accounts };
  delete accounts[accountId];
  const apps = { ...store.apps };
  if (!Object.entries(accounts).some(([id, a]) => appIdOf(a, id) === appId)) delete apps[appId];
  return { ...store, apps, accounts };
};
