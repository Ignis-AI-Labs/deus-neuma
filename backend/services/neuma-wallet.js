/**
 * Neuma Wallet Service — balance/history reads and domain-bound message
 * signing, plus the public barrel for the wallet surface.
 *
 * The transactional spine (rate limit, provider resolution, operator-approval
 * spine, sendTransaction, and the neuma-initiated spend flow) was extracted
 * VERBATIM to neuma-wallet-spend.js (size-law breakdown Part 2, 2026-08-26).
 * Readers — neuma-wallet-routes, portal-stream, intents/wallet-send, tests —
 * keep importing everything from THIS path via the barrel below.
 */

import { ethers } from 'ethers';
import { getCachedKey } from '../routes/neuma-auth-routes.js';
import { getProvider, getAddress } from './neuma-wallet-spend.js';

// Barrel — the moved public surface; the arrow is origin → spend, never back.
export {
  resolveWalletRpc, walletNetworkKey, getAddress, getBalance, sendTransaction,
  requestSpend, listPendingSpends, getWalletView,
  approvePendingSpend, approvePendingSpendWithPassword, rejectPendingSpend,
  pendingApprovalMessage,
} from './neuma-wallet-spend.js';

/**
 * Read the ETH balance of a bare ADDRESS — no lane, no keypair, no custody.
 *
 * A sealed AI witness holds its own wallet in its sealed DNA, not as a
 * workspace keypair, so the lane-keyed reads above return nothing for it. This
 * is the honest read for that case: an address and a public chain query.
 *
 * impure (network)
 * @param {string} address
 * @param {{network?: string}} [opts]
 * @returns {Promise<string|null>} Balance in ETH, or null when the RPC did not
 *   answer — never a misleading zero.
 */
export const balanceOfAddress = async (address, { network } = {}) => {
  if (!address) return null;
  try {
    const provider = getProvider(network);
    return ethers.formatEther(await provider.getBalance(address));
  } catch {
    return null;
  }
};

/**
 * Direct signTransaction is disabled (W3-005). Callers must use sendTransaction
 * so allowlist / threshold / value cap always run.
 */
export const signTransaction = async () => {
  throw new Error(
    'signTransaction is not available — use sendTransaction (spend policy enforced)',
  );
};

/**
 * Get recent transaction history for a neuma.
 * Queries the provider for recent transactions.
 *
 * @param {string} neumaId
 * @param {number} limit - Max transactions to return
 * @returns {Promise<Array<Object>>} Transaction summaries
 */
export const getTransactionHistory = async (neumaId, limit = 20) => {
  const address = await getAddress(neumaId);
  if (!address) return [];

  const provider = getProvider();

  // Get recent blocks and filter for neuma's transactions
  try {
    const blockNumber = await provider.getBlockNumber();
    const transactions = [];

    // Scan last 100 blocks (reasonable for local/test chains)
    const startBlock = Math.max(0, blockNumber - 100);
    for (let i = blockNumber; i >= startBlock && transactions.length < limit; i--) {
      const block = await provider.getBlock(i, true);
      if (!block?.prefetchedTransactions) continue;

      for (const tx of block.prefetchedTransactions) {
        if (tx.from?.toLowerCase() === address.toLowerCase() ||
            tx.to?.toLowerCase() === address.toLowerCase()) {
          transactions.push({
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: ethers.formatEther(tx.value),
            blockNumber: tx.blockNumber,
            direction: tx.from.toLowerCase() === address.toLowerCase() ? 'out' : 'in',
          });
        }
        if (transactions.length >= limit) break;
      }
    }

    return transactions;
  } catch {
    return [];
  }
};

/**
 * Domain-separated message prefixes allowed for free-form sign-message
 * (SEC-AUDIT-008 / #167). Arbitrary EIP-191 strings are rejected so spend
 * allowlist cannot be bypassed via off-chain signature protocols. neuma: is
 * the only prefix — new signatures never carry the pre-rename domain.
 */
export const SIGN_MESSAGE_ALLOWED_PREFIXES = Object.freeze([
  'neuma:',
]);

/**
 * @param {string} message
 * @returns {boolean}
 */
export const isAllowedSignMessage = (message) => {
  if (typeof message !== 'string' || message.length === 0 || message.length > 8192) {
    return false;
  }
  return SIGN_MESSAGE_ALLOWED_PREFIXES.some((p) => message.startsWith(p));
};

/**
 * Sign a domain-allowed message with the neuma's keypair.
 *
 * @param {string} neumaId
 * @param {string} message
 * @returns {Promise<string>} Signature hex
 */
export const signMessage = async (neumaId, message) => {
  if (!isAllowedSignMessage(message)) {
    throw new Error(
      'Message not allowed — must start with the neuma: domain prefix',
    );
  }
  const keypair = getCachedKey(neumaId);
  if (!keypair) throw new Error('Keypair not unlocked — use /api/neuma-auth/unlock first');

  const wallet = new ethers.Wallet(keypair.privateKey);
  return wallet.signMessage(message);
};
