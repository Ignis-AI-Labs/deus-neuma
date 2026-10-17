// Wallet networks — the chains this wallet can point at, and the persisted
// selection. ETHEREUM MAINNET is the wallet's home and the default since
// 2026-10-04 (Founder: Ethereum is […]); Ethereum SEPOLIA is its testnet walk; Base and Base Sepolia stay
// selectable so the seals and houses anchored there remain reachable
// (testnet-first doctrine, 2026-07-11). The selection is NOT a secret (unlike the custom RPC URL) —
// a plain JSON file in the wallet dir is the honest storage.
//
// Every consumer resolves through the store's resolve(): the selected network
// carries the chainId answered to eth_chainId, the chainId PINNED into every
// outgoing transaction (a wrong-chain or lying RPC then fails safe — the
// signature binds our chain, not the RPC's claim), and the public RPC used
// when no custom RPC is set.

const fs = require('node:fs');
const path = require('node:path');

const NETWORKS = Object.freeze({
  'ethereum': Object.freeze({
    key: 'ethereum',
    chainId: 1,
    label: 'Ethereum',
    publicRpc: 'https://ethereum-rpc.publicnode.com',
    testnet: false,
  }),
  'ethereum-sepolia': Object.freeze({
    key: 'ethereum-sepolia',
    chainId: 11155111,
    label: 'Ethereum Sepolia (testnet)',
    publicRpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    testnet: true,
  }),
  'base': Object.freeze({
    key: 'base',
    chainId: 8453,
    label: 'Base',
    publicRpc: 'https://mainnet.base.org',
    testnet: false,
  }),
  'base-sepolia': Object.freeze({
    key: 'base-sepolia',
    chainId: 84532,
    label: 'Base Sepolia (testnet)',
    publicRpc: 'https://sepolia.base.org',
    testnet: true,
  }),
});

const DEFAULT_NETWORK_KEY = 'ethereum';

/**
 * Persisted network selection. Plain JSON (`network.json` beside the vault) —
 * the value is one of the NETWORKS keys, never a URL or secret. Unknown or
 * corrupt content resolves to the default (mainnet): a wallet must never boot
 * onto a testnet by accident.
 * @param {{walletDir: string}} deps
 */
// impure — every store method touches network.json on disk.
const createNetworkStore = ({ walletDir }) => {
  const file = path.join(walletDir, 'network.json');

  // impure (fs read)
  const get = () => {
    try {
      const { network } = JSON.parse(fs.readFileSync(file, 'utf8'));
      return NETWORKS[network] ? network : DEFAULT_NETWORK_KEY;
    } catch {
      return DEFAULT_NETWORK_KEY;
    }
  };

  // impure (fs write)
  const set = (key) => {
    if (!NETWORKS[key]) return { ok: false, error: `Unknown network '${key}'` };
    fs.mkdirSync(walletDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ network: key }, null, 2));
    return { ok: true, network: key };
  };

  /** The full network object for the current selection. impure (via get). */
  const resolve = () => NETWORKS[get()];

  return { get, set, resolve };
};

module.exports = { NETWORKS, DEFAULT_NETWORK_KEY, createNetworkStore };
