// explorer.js — pure links from on-chain facts to their public explorer.
//
// Every surface that shows a transaction shares this one mapping, so a seal
// always links the same place on its own chain and an unknown network
// honestly links nowhere rather than guessing a host.

export const EXPLORER_BY_NETWORK = Object.freeze({
  'ethereum': 'https://etherscan.io',
  'ethereum-sepolia': 'https://sepolia.etherscan.io',
  'base': 'https://basescan.org',
  'base-sepolia': 'https://sepolia.basescan.org',
});

// Own keys only: a network named like an Object builtin is still unknown.
const explorerBase = (network) =>
  (Object.hasOwn(EXPLORER_BY_NETWORK, network) ? EXPLORER_BY_NETWORK[network] : null);

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** Is this a well-formed 32-byte tx hash? Pure. */
export const isTxHash = (hash) => typeof hash === 'string' && TX_HASH_PATTERN.test(hash);

/**
 * The explorer URL for a transaction, or null when the network is unknown
 * or the hash malformed — a caller renders plain text then, never a link
 * to a guessed host. Pure.
 * @param {string} network - seal network key ('ethereum', 'base', and their sepolias)
 * @param {string} txHash
 * @returns {string|null}
 */
export const explorerTxUrl = (network, txHash) => {
  const base = explorerBase(network);
  return base && isTxHash(txHash) ? `${base}/tx/${txHash}` : null;
};

/**
 * The explorer's name for link text, read off the same mapping as the link
 * ('ETHERSCAN', 'BASESCAN'); null for an unknown network. Pure.
 * @param {string} network - seal network key
 * @returns {string|null}
 */
export const explorerName = (network) => {
  const base = explorerBase(network);
  return base ? new URL(base).hostname.split('.').at(-2).toUpperCase() : null;
};

/** Short display form of a tx hash: 0xa9ec7f…e44d89. Pure. */
export const shortTxHash = (hash) =>
  isTxHash(hash) ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : String(hash || '');
