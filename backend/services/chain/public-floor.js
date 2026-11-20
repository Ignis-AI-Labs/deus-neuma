/**
 * public-floor — the public node a chain's reads fall back to when the
 * operator's keyed address refuses (Design note, 2026-11-12: the keyed Base app
 * answered 403 […] and every Base read went dark while the
 * public node stood answering).
 *
 * Base mainnet only: mainnet.base.org is the node the wallet already names
 * in the connections list. A fallback answer always says so (`node:
 * 'public'`), so a reader knows the number did not come through the keyed
 * address. BASE_PUBLIC_RPC_URL admits a loopback floor only under NODE_ENV=test;
 * set blank it removes the floor, which is how the test suite stays off the real network.
 *
 * A floor is verified like any endpoint (eth_chainId against the chain) and
 * kept for ten minutes, so a keyed address that comes back is picked up again
 * without a restart.
 *
 * impure (network).
 */

import { ethers } from 'ethers';
import { testEndpoint } from '../test-endpoint-door.js';

const FLOORS = Object.freeze({
  base: Object.freeze({ envName: 'BASE_PUBLIC_RPC_URL', url: 'https://mainnet.base.org', chainId: 8453 }),
});

const PROBE_TIMEOUT_MS = 10_000;
const FLOOR_KEEP_MS = 10 * 60 * 1000;

// pure — the floor address for a chain key, or '' when it has none.
const publicFloor = (key, env = process.env) => {
  const floor = FLOORS[key];
  if (!floor) return '';
  if (env[floor.envName] === '') return '';
  return testEndpoint(env, floor.envName, floor.url, ['http:', 'https:']);
};

const floors = new Map(); // `${key}\n${url}` → { provider, until }

// impure — eth_chainId raced against the clock; the probe provider is destroyed.
const answersFor = async (url, chainId) => {
  const probe = new ethers.JsonRpcProvider(url);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('no answer in time')), PROBE_TIMEOUT_MS);
  });
  try {
    return Number((await Promise.race([probe.getNetwork(), timeout])).chainId) === chainId;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    probe.destroy();
  }
};

/**
 * The verified public provider for a chain, or null: no floor for this chain,
 * the floor is the address that just failed, or the floor did not answer for
 * the right chain. impure.
 *
 * @param {string} key - chain key ('base')
 * @param {{failedUrl?: string, env?: Record<string, string|undefined>, now?: number}} [opts]
 * @returns {Promise<ethers.JsonRpcProvider|null>}
 */
export const floorProvider = async (key, { failedUrl = '', env = process.env, now = Date.now() } = {}) => {
  const url = publicFloor(key, env);
  if (!url || url === failedUrl) return null;
  const cacheKey = `${key}\n${url}`;
  const kept = floors.get(cacheKey);
  if (kept && kept.until > now) return kept.provider;
  if (kept) {
    kept.provider.destroy();
    floors.delete(cacheKey);
  }
  const { chainId } = FLOORS[key];
  if (!await answersFor(url, chainId)) return null;
  const provider = new ethers.JsonRpcProvider(url, ethers.Network.from(chainId), { staticNetwork: true });
  floors.set(cacheKey, { provider, until: now + FLOOR_KEEP_MS });
  return provider;
};

/**
 * An address's native balance through `primary`, then through the public
 * floor when `primary` fails. Never throws: a balance nobody answered is
 * null, never zero. impure.
 *
 * @param {ethers.JsonRpcProvider} primary
 * @param {string} key - chain key the primary serves
 * @param {string} address
 * @param {Record<string, string|undefined>} [env]
 * @returns {Promise<{eth: string|null, node: 'configured'|'public'|null}>}
 */
export const balanceWithFloor = async (primary, key, address, env = process.env) => {
  try {
    return { eth: ethers.formatEther(await primary.getBalance(address)), node: 'configured' };
  } catch {
    const floor = await floorProvider(key, { failedUrl: primary._getConnection().url, env });
    if (!floor) return { eth: null, node: null };
    try {
      return { eth: ethers.formatEther(await floor.getBalance(address)), node: 'public' };
    } catch {
      return { eth: null, node: null };
    }
  }
};

/** Did this answer come through a public floor? Pure over the kept floors. */
export const isFloorProvider = (provider) => [...floors.values()].some((kept) => kept.provider === provider);

/** Drop every kept floor. The test door, beside resetChainProviders. */
export const resetPublicFloors = () => {
  for (const { provider } of floors.values()) provider.destroy();
  floors.clear();
};
