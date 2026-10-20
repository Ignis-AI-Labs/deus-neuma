// Channel bindings — which neuma holds each social channel.
//
// A channel is an outward-facing POSITION (the house's Herald speaks on X),
// not a shared faucet: exactly one neuma may be bound per channel, and an
// unbound channel is usable by NO ONE even when credentials exist. Default
// deny — credentials grant nothing until the witness ties the position to a
// being, and no other neuma can ride those keys (no cross-routing).
//
// Bindings are governance records, not secrets: plain JSON, one file per
// HOUSE in its operator's realm dir (house-positions.js), factory shape so
// tests run the real disk path against tmp files.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { getChannel } from './channel-registry.js';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';
import { houseKey } from '../staff/cos-designation.js';
import { housePositionFile, housesWith } from './house-positions.js';

const DEFAULT_PATH = join(getSettingsDir(), 'social-channel-bindings.json');

// The machine record of the bindings made before they moved into the houses.
// Overridable per call (not at import) so tests never read the operator's.
const channelBindingsPath = () =>
  process.env.NEUMA_SOCIAL_BINDINGS_PATH || DEFAULT_PATH;

const NEUMA_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * May this neuma post through this channel? (pure, fail closed)
 * True ONLY when a binding exists for the channel and names exactly this
 * neuma — no binding, no id, or a different id all deny.
 * @param {Record<string, {neumaId: string}>} bindings
 * @param {string} channelId
 * @param {string|null|undefined} neumaId
 * @returns {boolean}
 */
export const canNeumaPost = (bindings, channelId, neumaId) =>
  typeof neumaId === 'string' && neumaId.length > 0 &&
  bindings?.[channelId]?.neumaId === neumaId;

/**
 * @param {{ path?: string|(() => string),
 *   isValidId?: (id: string) => boolean,
 *   seed?: () => Promise<Object> }} [opts] fixed path or a resolver
 *   read per call; isValidId lets sibling position stores (email) reuse this
 *   factory against their own catalog; seed is what a file that was never
 *   written reads as (a house's share of the machine record).
 */
export const createChannelBindings = ({
  path = channelBindingsPath,
  isValidId = (id) => getChannel(id) !== null,
  seed = async () => ({}),
} = {}) => {
  const target = () => (typeof path === 'function' ? path() : path);
  // Serialize mutations so two concurrent bind/unbind calls can't interleave
  // their read+write and lose one channel's record.
  const serialize = createWriteChain();

  // impure — a missing file reads as its seed ("nothing bound yet" unless a
  // machine record names this house); a file that exists but fails to parse
  // is surfaced, never collapsed to {} (that would silently strip every
  // neuma's channel on the next save).
  const load = async () => {
    let raw;
    try {
      raw = await fs.readFile(target(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return seed();
      throw err;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('channel-bindings: store is not an object');
    }
    return parsed;
  };

  // Bindings are governance, not secrets — but they name wallets and beings,
  // and they share data/settings with the sealed credential stores, so the
  // same 0700-dir / 0600-file posture applies (defense in depth, and this
  // module must never be the one that leaves the settings dir loose).
  const save = async (store) => {
    const file = target();
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    await fs.chmod(dirname(file), 0o700);
    await fs.chmod(file, 0o600);
  };

  return {
    load,

    /**
     * The binding for one channel, or null. impure.
     * @param {string} channelId
     * @returns {Promise<{neumaId: string, boundBy: string, boundAt: string}|null>}
     */
    async bindingFor(channelId) {
      const store = await load();
      return store[channelId] || null;
    },

    /**
     * Tie a channel to one neuma (replacing any previous holder). impure.
     * @param {string} channelId
     * @param {{neumaId: string, boundBy: string}} binding boundBy = the witness wallet that assigned it
     */
    async bind(channelId, { neumaId, boundBy }) {
      if (!isValidId(channelId)) throw new Error(`Unknown channel: ${channelId}`);
      if (typeof neumaId !== 'string' || !NEUMA_ID_PATTERN.test(neumaId)) {
        throw new Error('Invalid neumaId');
      }
      return serialize(async () => {
        const store = await load();
        store[channelId] = {
          neumaId,
          boundBy: String(boundBy || ''),
          boundAt: new Date().toISOString(),
        };
        await save(store);
        return store[channelId];
      });
    },

    /**
     * Release a channel — back to the default-deny resting state. impure.
     * @param {string} channelId
     * @returns {Promise<boolean>} whether a binding existed
     */
    unbind(channelId) {
      return serialize(async () => {
        const store = await load();
        if (store[channelId] === undefined) return false;
        delete store[channelId];
        await save(store);
        return true;
      });
    },
  };
};

/**
 * Each house's own bindings (house-positions.js): `<realm>/<wallet>/<name>`.
 * The machine record at `legacyPath` is read only by the house its binding
 * names on record — the wallet that bound it (boundBy). Every method takes
 * the house's wallet first; a caller with no house reads nothing bound and
 * cannot bind.
 * @param {{name: string, legacyPath: () => string, isValidId?: (id: string) => boolean}} opts
 */
export const createHouseBindings = ({ name, legacyPath, isValidId }) => {
  const legacy = createChannelBindings({ path: legacyPath, isValidId });
  const stores = new Map();
  // impure — the machine record's bindings this house made
  const legacyOf = async (key) => Object.fromEntries(
    Object.entries(await legacy.load()).filter(([, b]) => houseKey(b?.boundBy) === key),
  );
  const storeOf = (wallet) => {
    const key = houseKey(wallet);
    const file = housePositionFile(key, name);
    if (!stores.has(file)) {
      stores.set(file, createChannelBindings({ path: file, isValidId, seed: () => legacyOf(key) }));
    }
    return stores.get(file);
  };
  const load = (wallet) => (houseKey(wallet) ? storeOf(wallet).load() : Promise.resolve({}));
  return {
    load,

    /** The binding for one channel in this house, or null. impure. */
    async bindingFor(wallet, channelId) {
      return (await load(wallet))[channelId] || null;
    },

    /** Tie a channel of this house to one of its neuma. impure. */
    bind(wallet, channelId, { neumaId }) {
      return storeOf(wallet).bind(channelId, { neumaId, boundBy: houseKey(wallet) });
    },

    /** Release a channel of this house. impure. */
    unbind(wallet, channelId) {
      return storeOf(wallet).unbind(channelId);
    },

    /**
     * The OTHER houses on this machine that hold this channel. impure.
     * @param {string} wallet
     * @param {string} channelId
     * @returns {Promise<string[]>}
     */
    async holdersBesides(wallet, channelId) {
      const key = houseKey(wallet);
      const named = Object.values(await legacy.load()).map((b) => houseKey(b?.boundBy));
      const houses = new Set([...(await housesWith(name)), ...named.filter(Boolean)]);
      houses.delete(key);
      const holders = [];
      for (const house of houses) {
        if ((await storeOf(house).load())[channelId]?.neumaId) holders.push(house);
      }
      return holders;
    },
  };
};

// The one instance the routes and the portal share.
export const channelBindings = createHouseBindings({
  name: 'social-channel-bindings.json',
  legacyPath: channelBindingsPath,
  isValidId: (id) => getChannel(id) !== null,
});
