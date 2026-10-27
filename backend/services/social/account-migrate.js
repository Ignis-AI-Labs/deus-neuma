// account-migrate — a house's v1 credential store (`{[channelId]: fields}`,
// one account per platform) becomes the v2 apps + accounts store (campaign
// plan §2.5). Pure: the disk half (backup, write-then-rename, the log) is
// account-store.js.
//
// NO DATA LOSS. Each v1 entry becomes account `<channel>-1`: the app's fields
// (consumer key, OAuth client) move to `apps[<channel>]`, every other key —
// declared or not — stays on the account. An entry for a platform this build
// no longer knows is carried verbatim under `unplaced`, never dropped. A
// platform the house posts to only through the machine's .env keys gets an
// account record with no fields, so it has a company like every other.
//
// The result names what moved by FIELD NAME only — never a value — so the
// caller can log it (Rule 8).

import { getChannel } from './channel-registry.js';
import { STORE_VERSION } from './account-shape.js';

/**
 * @param {Record<string, Record<string, string>>} v1
 * @param {{defaultCompanyId?: ?string, envChannels?: string[], at?: string}} [opts]
 *   defaultCompanyId — the company today's accounts belong to (null = UNSORTED)
 *   envChannels — platforms the house's .env keys serve with no stored entry
 * @returns {{store: object, moved: Array<{channelId: string, accountId: string, source: 'store'|'env',
 *   appFields: string[], accountFields: string[]}>, unplaced: string[]}}
 */
export const migrateV1 = (v1, { defaultCompanyId = null, envChannels = [], at = new Date().toISOString() } = {}) => {
  const store = { v: STORE_VERSION, apps: {}, accounts: {}, serial: {}, migratedAt: at };
  const moved = [];
  const unplaced = {};
  const source = v1 && typeof v1 === 'object' && !Array.isArray(v1) ? v1 : {};
  const account = (channelId, fields) => ({
    channelId,
    companyId: defaultCompanyId,
    label: '',
    expectedHandle: null,
    platformUserId: null,
    addedAt: at,
    migratedFrom: 'v1',
    fields,
  });

  for (const [channelId, entry] of Object.entries(source)) {
    const channel = getChannel(channelId);
    if (!channel || !entry || typeof entry !== 'object') {
      unplaced[channelId] = entry;
      continue;
    }
    const appKeys = new Set(channel.fields.filter((f) => f.app).map((f) => f.key));
    const appFields = {};
    const accountFields = {};
    for (const [key, value] of Object.entries(entry)) (appKeys.has(key) ? appFields : accountFields)[key] = value;
    const accountId = `${channelId}-1`;
    if (Object.keys(appFields).length) store.apps[channelId] = appFields;
    store.accounts[accountId] = account(channelId, accountFields);
    store.serial[channelId] = 1;
    moved.push({ channelId, accountId, source: 'store', appFields: Object.keys(appFields), accountFields: Object.keys(accountFields) });
  }

  for (const channelId of envChannels) {
    if (!getChannel(channelId) || store.accounts[`${channelId}-1`]) continue;
    store.accounts[`${channelId}-1`] = account(channelId, {});
    store.serial[channelId] = 1;
    moved.push({ channelId, accountId: `${channelId}-1`, source: 'env', appFields: [], accountFields: [] });
  }

  if (Object.keys(unplaced).length) store.unplaced = unplaced;
  return { store, moved, unplaced: Object.keys(unplaced) };
};

/**
 * The company today's accounts belong to (pure), in order: the kit most of
 * the house's campaigns name (the campaign gate checks an exact kit name),
 * else the house's only kit of its own, else none (UNSORTED — shown to the
 * operator as waiting on them; moving an account is one press).
 * @param {{campaignBrands: string[], kits: string[], ownKits: string[]}} house
 * @returns {{companyId: ?string, why: string}}
 */
export const defaultCompanyFor = ({ campaignBrands = [], kits = [], ownKits = [] }) => {
  const known = new Set(kits);
  const tally = new Map();
  for (const brand of campaignBrands) {
    const id = String(brand || '').trim().toLowerCase();
    if (known.has(id)) tally.set(id, (tally.get(id) || 0) + 1);
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) {
    return { companyId: ranked[0][0], why: `${ranked[0][1]} of the house's campaigns name it` };
  }
  if (ownKits.length === 1) return { companyId: ownKits[0], why: 'it is the house\'s only brand kit' };
  return { companyId: null, why: 'no one company is named by most campaigns, and the house holds more or fewer than one kit of its own' };
};
