/**
 * WalletDiscovery — EIP-6963 multi-wallet discovery service.
 * Discovers all injected browser wallets via the EIP-6963 announce/request protocol,
 * falls back to window.ethereum, and surfaces the embedded Neuma wallet when stored.
 * @module WalletDiscovery
 */

import { isWalletStored, getEmbeddedProvider } from './EmbeddedWallet.js';

const STORAGE_KEY = 'preferred-wallet-rdns';

/**
 * Singleton service for discovering available wallet providers.
 * Listens for EIP-6963 events and maintains a map of discovered providers.
 */
class WalletDiscoveryService {
  constructor() {
    this.providers = new Map();
    this._listening = false;
  }

  /** Start listening for EIP-6963 announceProvider events. */
  init() {
    if (this._listening) return;
    this._listening = true;

    window.addEventListener('eip6963:announceProvider', (event) => {
      const { info, provider } = event.detail;
      if (info && provider) {
        this.providers.set(info.rdns, { info, provider });
      }
    });

    // Request providers from wallets that are already loaded
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  }

  /**
   * Get all discovered wallet providers. Falls back to window.ethereum if no EIP-6963
   * providers found. Includes the embedded Neuma wallet when one is stored.
   * @returns {Array<{info: {uuid: string, name: string, icon: string, rdns: string}, provider: object, isEmbedded?: boolean}>}
   */
  getProviders() {
    const discovered = Array.from(this.providers.values());

    // Fall back to window.ethereum if no EIP-6963 providers found
    if (discovered.length === 0 && window.ethereum) {
      discovered.push({
        info: {
          uuid: 'legacy-injected',
          name: 'Browser Wallet',
          icon: '',
          rdns: 'legacy.injected',
        },
        provider: window.ethereum,
      });
    }

    // Add embedded Neuma wallet if one exists
    if (isWalletStored()) {
      const provider = getEmbeddedProvider();
      if (provider) {
        discovered.push({
          info: {
            uuid: 'neuma-embedded',
            name: 'Neuma Wallet',
            icon: '',
            rdns: 'neuma.embedded',
          },
          provider,
          isEmbedded: true,
        });
      }
    }

    return discovered;
  }

  /**
   * Get the user's preferred provider (from localStorage), or the first available.
   * @returns {{info: object, provider: object}|null} Provider entry, or null if none available
   */
  getPreferredProvider() {
    const preferred = localStorage.getItem(STORAGE_KEY);
    const all = this.getProviders();

    if (preferred) {
      // the pre-rename embedded rdns still means the embedded wallet
      const wanted = preferred === 'kenorie.embedded' ? 'neuma.embedded' : preferred;
      const match = all.find(p => p.info.rdns === wanted);
      if (match) return match;
    }

    return all[0] || null;
  }

  /**
   * Save the user's wallet preference to localStorage.
   * @param {string} rdns - Reverse DNS name of the preferred wallet (e.g. 'io.metamask')
   */
  setPreferred(rdns) {
    localStorage.setItem(STORAGE_KEY, rdns);
  }
}

// Singleton — init once, use everywhere
export const walletDiscovery = new WalletDiscoveryService();
walletDiscovery.init();
