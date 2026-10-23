/**
 * Which of the house's accounts on a platform a being-side READ uses
 * (campaign plan §2.4). Reading is everyone's by doctrine, so a read may name
 * any account of the lane's own house; unnamed, it is the one account the
 * lane holds there, or the house's first. A name that is not that platform's
 * account is refused in words. impure — the house's bindings.
 */
import { channelBindings } from '../social/channel-bindings.js';
import { channelOfAccountId, firstAccountId, heldAccounts } from '../social/account-shape.js';

/**
 * @param {?string} house
 * @param {?string} neumaId
 * @param {unknown} asked - the `account` the being named, if any
 * @param {{id: string, name: string}} channel
 * @returns {Promise<{ok: true, accountId: string}|{ok: false, error: string}>}
 */
export const readAccountFor = async (house, neumaId, asked, channel) => {
  if (asked !== undefined && asked !== null && asked !== '') {
    return channelOfAccountId(asked) === channel.id
      ? { ok: true, accountId: String(asked) }
      : { ok: false, error: `${asked} is not a ${channel.name} account — accounts are named ${channel.id}-1, ${channel.id}-2…` };
  }
  const held = heldAccounts(house ? await channelBindings.load(house).catch(() => ({})) : {}, channel.id, neumaId);
  return { ok: true, accountId: held.length === 1 ? held[0] : firstAccountId(channel.id) };
};
