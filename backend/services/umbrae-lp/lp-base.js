// lp-base.js — the one Base node every LP read and signature goes through: the
// address the operator saved (chain-registry, which already falls back to
// Base's public node when that address refuses), or Base's public node itself
// when no address was saved at all. A house member on a machine with no Base
// address saved can still trade; the reads say which node answered elsewhere.

import { providerFor } from '../chain/chain-registry.js';
import { floorProvider } from '../chain/public-floor.js';

/**
 * A provider for Base, or null when no node answers for chain 8453. impure.
 * @returns {Promise<import('ethers').JsonRpcProvider|null>}
 */
export const lpBase = async () => (await providerFor('base')) ?? floorProvider('base');
