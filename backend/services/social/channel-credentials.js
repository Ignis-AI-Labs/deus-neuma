// Channel credentials — each house's social platform keys, encrypted at rest.
//
// Same posture as provider-credentials: these are the OPERATOR'S outward-facing
// account secrets, not neuma-sovereign data, so a house's store is one
// AES-256-GCM envelope via workspace-crypto, written 0600 in its operator's
// realm dir (house-positions.js). Since 2026-10-23 the store holds the house's
// developer APPS and its ACCOUNTS — several per platform, each under a company
// (account-store.js, account-shape.js). Field resolution is store > env (>
// catalog fallback), so Settings is the primary surface while .env keeps the
// bootstrap working.
//
// THIS MODULE is the channel-shaped door every pre-accounts caller speaks:
// "the house's X" is account `x-1`, the account a v1 store's one entry became.
// New code names an account (resolveAccountCredential).
//
// A raw credential never leaves these modules except through
// resolveChannelCredential / resolveAccountCredential — everything the API
// sees is masked in the registry.

import { getChannel, maskChannelCredentials, resolveChannelCredentials } from './channel-registry.js';
import { channelBindings } from './channel-bindings.js';
import { houseKey } from '../staff/cos-designation.js';
import { firstAccountId, firstAccountView, isV2, patchAccount, withoutAccount } from './account-shape.js';
import {
  loadAccountStore, mutateAccountStore, writeCredentialStore, resolveAccountCredential, houseEnvFor,
} from './account-store.js';

export { channelCredentialsPath, houseEnvFor } from './account-store.js';
export { mergeChannelCredential } from './account-shape.js';

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
 * A house's keys as `{[channelId]: fields}` — each platform's app fields with
 * its first account's. No house, or no file = "no credentials yet". impure.
 * @param {string} wallet
 */
export const loadChannelCredentials = async (wallet) => firstAccountView(await loadAccountStore(wallet));

/**
 * Encrypt and persist a house's whole store object, as given — the writer
 * every version of the store has used. impure.
 */
export const saveChannelCredentials = writeCredentialStore;

/**
 * Set (or clear fields of) a channel's credential in a house — its first
 * account, and the platform's app — and persist. Rejects unknown channel ids
 * so a typo can't seed an unroutable secret, and a caller with no house.
 * @param {string} wallet - the house
 * @param {string} channelId
 * @param {Record<string, string>} patch
 */
// impure
export const setChannelCredential = async (wallet, channelId, patch) => {
  if (!getChannel(channelId)) throw new Error(`Unknown channel: ${channelId}`); // reject before queuing
  const next = await mutateAccountStore(wallet, (store) => patchAccount(store, firstAccountId(channelId), patch || {}));
  return firstAccountView(next)[channelId] || null;
};

// impure — the channel's first account goes (its app too, once no account uses it)
export const removeChannelCredential = async (wallet, channelId) => {
  let removed = false;
  await mutateAccountStore(wallet, (store) => {
    const id = firstAccountId(channelId);
    if (!store.accounts?.[id] && !store.apps?.[channelId]) return store;
    removed = true;
    const next = withoutAccount(store, id);
    if (!Object.values(next.accounts).some((a) => a.channelId === channelId)) {
      const apps = { ...next.apps };
      delete apps[channelId];
      return { ...next, apps };
    }
    return next;
  });
  return removed;
};

/**
 * One channel's masked credential state as this house sees it — its own
 * store, and the .env keys only where houseEnvFor lets them serve. impure.
 * @param {string} wallet
 * @param {Object} channel - a channel (or the email account) catalog entry
 * @param {Object} store - the house's loaded store, `{[id]: fields}`
 * @param {{holdersBesides: Function}} [bindings] - the position store holding the channel
 */
export const maskHouseCredentials = async (wallet, channel, store, bindings = channelBindings) =>
  maskChannelCredentials(channel, store[channel.id], await houseEnvFor(wallet, channel, bindings));

/**
 * Resolve the actual credentials for a house's channel call — its first
 * account. Null unless the full set is present, and null for a caller with no
 * house. A pre-loaded store may be the v2 store or the channel view
 * (loadChannelCredentials).
 * @param {string} wallet - the house
 * @param {string} channelId
 * @param {Object} [store] the house's pre-loaded store (avoids a second disk read)
 * @returns {Promise<Readonly<Record<string, string>>|null>}
 */
// impure — reads env (and disk when no store given)
export const resolveChannelCredential = async (wallet, channelId, store) => {
  const channel = getChannel(channelId);
  if (!channel || !houseKey(wallet)) return null;
  if (store && !isV2(store)) {
    return resolveChannelCredentials(channel, store[channelId], await houseEnvFor(wallet, channel));
  }
  return resolveAccountCredential(wallet, firstAccountId(channelId), store);
};
