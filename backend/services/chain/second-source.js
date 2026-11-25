/**
 * second-source — a second, independent node for a chain, so that […] is never one node's word (audit P6-43). The node the operator saved
 * is the first voice; this is the other: a public node run by someone else,
 * or the address named in NEUMA_<CHAIN>_RECEIPT_RPC_URL (https only; a
 * loopback address is honored under NODE_ENV=test, which is how the suite
 * stays off the real network).
 *
 * A second source is never the node it is checking: a candidate at the
 * primary's own address is passed over, and with none left the answer is
 * null — the caller then confirms nothing rather than trusting one voice.
 *
 * impure (constructs a provider; the caller destroys it).
 */

import { ethers } from 'ethers';
import { chainEntry } from './chain-registry.js';
import { testEndpoint } from '../test-endpoint-door.js';

const PUBLIC_NODES = Object.freeze({
  ethereum: Object.freeze(['https://ethereum-rpc.publicnode.com']),
  base: Object.freeze(['https://base-rpc.publicnode.com', 'https://mainnet.base.org']),
});

/** The env name that repoints a chain's second source. Pure. */
export const secondSourceEnvName = (key) => `NEUMA_${String(key).toUpperCase().replace(/-/g, '_')}_RECEIPT_RPC_URL`;

// pure — the operator's own second node: https, or (tests only) loopback; '' when unset or unfit.
const configured = (key, env) => {
  const name = secondSourceEnvName(key);
  const raw = String(env[name] ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).protocol === 'https:' ? raw : testEndpoint(env, name, '');
  } catch {
    return '';
  }
};

const sameNode = (a, b) => String(a).replace(/\/+$/, '').toLowerCase() === String(b).replace(/\/+$/, '').toLowerCase();

/**
 * A provider for the chain's second source, or null when there is none apart
 * from the primary itself. impure.
 * @param {string} key - chain-registry key
 * @param {ethers.JsonRpcProvider} primary - the node being checked
 * @param {Record<string, string|undefined>} [env]
 * @returns {ethers.JsonRpcProvider|null}
 */
export const secondSourceFor = (key, primary, env = process.env) => {
  const chain = chainEntry(key);
  if (!chain) return null;
  const primaryUrl = primary._getConnection().url;
  const own = configured(key, env);
  const url = [...(own ? [own] : []), ...(PUBLIC_NODES[key] ?? [])].find((candidate) => !sameNode(candidate, primaryUrl));
  return url ? new ethers.JsonRpcProvider(url, ethers.Network.from(chain.chainId), { staticNetwork: true }) : null;
};
