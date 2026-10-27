// channel-board — the channel board one house reads (GET /social-channels):
// every channel's masked credential state and its holder, and — where the
// lane can prove it — the ACCOUNT it speaks as (Design note, 2026-07-28: […]). The account read
// is cached and only attempted when the channel is configured; null means
// unproven, never invented.
//
// A locked keys file (account-store.js ACCOUNTS_LOCKED) still lists every
// platform, each LOCKED, never the env keys in its place (the store may name
// other accounts than the env does): a broken store never hides the way to
// fix it.
//
// impure — the house's stores, and X's account read.

import { CHANNEL_CATALOG, maskChannelCredentials } from './channel-registry.js';
import { loadChannelCredentials, maskHouseCredentials } from './channel-credentials.js';
import { isAccountsLocked } from './account-store.js';
import { channelBindings } from './channel-bindings.js';
import { firstAccountId } from './account-shape.js';
import { readXAccount } from './x-reader.js';

/**
 * @param {string} wallet - the house
 * @returns {Promise<{channels: object[], locked?: {why: string}}>}
 */
export const readChannelBoard = async (wallet) => {
  try {
    const [store, bindings] = await Promise.all([loadChannelCredentials(wallet), channelBindings.load(wallet)]);
    const channels = await Promise.all(CHANNEL_CATALOG.map(async (channel) => ({
      ...(await maskHouseCredentials(wallet, channel, store)),
      binding: bindings[firstAccountId(channel.id)] || null,
    })));
    // Only X has an account-proving reader today; new platforms join here as their readers land.
    const x = channels.find((c) => c.id === 'x');
    if (x?.configured) x.account = await readXAccount({ wallet }).catch(() => null);
    return { channels };
  } catch (error) {
    if (!isAccountsLocked(error)) throw error;
    const bindings = await channelBindings.load(wallet).catch(() => ({}));
    return {
      channels: CHANNEL_CATALOG.map((channel) => ({
        ...maskChannelCredentials(channel, undefined, {}), locked: true, binding: bindings[firstAccountId(channel.id)] || null,
      })),
      locked: { why: error.message },
    };
  }
};
