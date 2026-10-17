import { createBoundedBrowserRpc } from './bounded-browser-rpc.js';
import { getBrowserRpc } from './wallet-browser-rpc.js';

// The selectable networks — mirrors electron/wallet/networks.cjs exactly, so
// the browser (dev) path and the desktop main process agree on chain ids and
// public endpoints. Ethereum mainnet is home (2026-10-04); Sepolia exists for
// testnet-first walks and is never the default; Base stays reachable.
export const WALLET_NETWORKS = Object.freeze([
  Object.freeze({ key: 'ethereum', chainId: 1, label: 'Ethereum', publicRpc: 'https://ethereum-rpc.publicnode.com', testnet: false }),
  Object.freeze({ key: 'ethereum-sepolia', chainId: 11155111, label: 'Ethereum Sepolia (testnet)', publicRpc: 'https://ethereum-sepolia-rpc.publicnode.com', testnet: true }),
  Object.freeze({ key: 'base', chainId: 8453, label: 'Base', publicRpc: 'https://mainnet.base.org', testnet: false }),
  Object.freeze({ key: 'base-sepolia', chainId: 84532, label: 'Base Sepolia (testnet)', publicRpc: 'https://sepolia.base.org', testnet: true }),
]);

export const NETWORK_KEY = 'wallet-network';
export const browserNetwork = () => {
  try {
    const k = localStorage.getItem(NETWORK_KEY);
    return WALLET_NETWORKS.find((n) => n.key === k) || WALLET_NETWORKS[0];
  } catch { return WALLET_NETWORKS[0]; }
};

// impure — cache follows the selected endpoint, including custom-RPC changes.
let provider = null;
let providerTarget = null;
/** Return the provider for the browser's current custom/public RPC choice. */
export const getBrowserNetworkProvider = () => {
  const target = getBrowserRpc() || browserNetwork().publicRpc;
  if (!provider || provider.destroyed || providerTarget !== target) {
    provider?.destroy();
    provider = createBoundedBrowserRpc(target);
    providerTarget = target;
  }
  return provider;
};
