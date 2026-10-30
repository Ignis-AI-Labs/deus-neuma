import { deskOwnerClaim, ownerClaimHeaders } from './owner-claim.js';

/**
 * Wallet service for Web3 connections via any EIP-1193 provider.
 * Handles connection, auth challenge-sign-verify, and session token management.
 */
export class WalletService {
  /** Create a new WalletService instance (no provider set yet). */
  constructor() {
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.chainId = null;
  }

  /** Set the EIP-1193 provider (from WalletDiscovery or WalletPicker). */
  setProvider(provider) {
    this.provider = provider;
    this._attachListeners();
  }

  /**
   * Connect to the wallet — requests accounts and reads chain ID.
   * Stores address and connection state in localStorage.
   * @returns {Promise<{address: string, chainId: number}>} Connected wallet info
   * @throws {Error} If no provider set or no accounts found
   */
  async connect() {
    if (!this.provider) {
      throw new Error('No wallet provider set. Select a wallet.');
    }

    try {
      const accounts = await this.provider.request({
        method: 'eth_requestAccounts'
      });

      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }

      this.address = accounts[0];

      const chainId = await this.provider.request({
        method: 'eth_chainId'
      });
      this.chainId = parseInt(chainId, 16);

      localStorage.setItem('walletConnected', 'true');
      localStorage.setItem('walletAddress', this.address);

      return {
        address: this.address,
        chainId: this.chainId
      };

    } catch (error) {
      console.error('Failed to connect wallet:', error);
      throw error;
    }
  }

  /** Disconnect the wallet — clears provider, address, and all localStorage tokens. */
  async disconnect() {
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.chainId = null;

    localStorage.removeItem('walletConnected');
    localStorage.removeItem('walletAddress');
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('llm-apikey');
  }

  isConnected() {
    return localStorage.getItem('walletConnected') === 'true';
  }

  /**
   * Get the connected wallet address (from memory or localStorage).
   * @returns {string|null} Wallet address, or null if not connected
   */
  getAddress() {
    return this.address || localStorage.getItem('walletAddress');
  }

  /**
   * Sign a message with the connected wallet (personal_sign).
   * @param {string} message - Message to sign
   * @returns {Promise<string>} Hex-encoded signature
   * @throws {Error} If no provider or wallet not connected
   */
  async signMessage(message) {
    if (!this.provider) {
      throw new Error('No wallet provider set. Select a wallet.');
    }

    const address = this.getAddress();
    if (!address) {
      throw new Error('Wallet not connected');
    }

    const signature = await this.provider.request({
      method: 'personal_sign',
      params: [message, address],
    });

    return signature;
  }

  /**
   * Authenticate with the Neuma backend.
   * Requests a challenge, signs it, and stores the session token.
   */
  async authenticate() {
    const address = this.getAddress();
    if (!address) {
      throw new Error('Wallet not connected');
    }

    const challengeRes = await fetch(`/api/v1/auth/challenge?address=${address}`);
    if (!challengeRes.ok) throw new Error('Failed to get auth challenge');
    const { challenge } = await challengeRes.json();

    const signature = await this.signMessage(challenge);

    const verifyRes = await fetch('/api/v1/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ownerClaimHeaders(await deskOwnerClaim()) },
      body: JSON.stringify({ address, signature, challenge }),
    });
    if (!verifyRes.ok) throw new Error('Authentication failed');
    const { token } = await verifyRes.json();

    sessionStorage.setItem('authToken', token);
    return token;
  }

  /**
   * Get the stored auth session token.
   * @returns {string|null} Token from localStorage, or null
   */
  getAuthToken() {
    return sessionStorage.getItem('authToken');
  }

  /** Attach accountsChanged / chainChanged listeners to the current provider. */
  _attachListeners() {
    if (!this.provider || !this.provider.on) return;

    this.provider.on('accountsChanged', (accounts) => {
      if (accounts.length === 0) {
        this.disconnect();
      } else {
        this.address = accounts[0];
        localStorage.setItem('walletAddress', this.address);
      }
    });

    this.provider.on('chainChanged', () => {
      window.location.reload();
    });
  }
}
