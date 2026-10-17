/**
 * WalletGate — Contextual wallet-gated access.
 * Provides a single-function gate that shows the wallet picker only when
 * an action requires identity. Manages a shared WalletService singleton.
 * @module WalletGate
 */

import { WalletService } from './WalletService.js';
import { showWalletPicker } from '../components/WalletPicker/WalletPicker.js';

// Shared singleton wallet service
const walletService = new WalletService();

/**
 * Ensure the user has a connected + authenticated wallet.
 * If not connected, shows a contextual prompt + wallet picker.
 *
 * @param {string} [contextMessage] — Why the wallet is needed
 * @returns {Promise<string|null>} — Authenticated address, or null if user cancelled
 */
export const requireWallet = async (contextMessage) => {
  // Already connected and authenticated — fast path
  const existing = walletService.getAddress();
  const token = walletService.getAuthToken();

  if (existing && token) {
    return existing;
  }

  // Need to connect — show wallet picker with context
  const chosen = await showWalletPicker(contextMessage);
  if (!chosen) return null;

  // System-browser bridge (WEB-001): the picker already opened the user's real
  // browser, connected their extension wallet, and stored the minted token.
  // There is no in-process provider to connect — just return the address.
  if (chosen.bridged) return chosen.address || walletService.getAddress();

  // Set the provider and connect
  walletService.setProvider(chosen.provider);
  try {
    await walletService.connect();
  } catch {
    return null;
  }

  // Authenticate (challenge-sign-verify)
  try {
    await walletService.authenticate();
  } catch {
    return null;
  }

  return walletService.getAddress();
};

/**
 * Get the shared WalletService singleton instance.
 * Use this to access disconnect, getAddress, and other wallet methods
 * without creating a new service instance.
 * @returns {WalletService} The singleton wallet service
 */
export const getWalletService = () => walletService;
