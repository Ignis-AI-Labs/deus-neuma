/**
 * wallet-providers — the EIP-1193 provider factories of EmbeddedWallet
 * (browser signer + desktop IPC) and the lazy, cached RPC provider they share.
 *
 * Split out of EmbeddedWallet.js (SIZE-028) — every body byte-identical.
 * Imports getStoredAddress from wallet-session.js (CQ-036, #395) — this used
 * to reach back into EmbeddedWallet.js and close the trio's three-way import
 * cycle. Every edge points one way now, ending at the keystore.
 *
 * @module wallet-providers
 */

import { ethers } from 'ethers';
import { browserNetwork, getBrowserNetworkProvider } from './wallet-browser-network.js';
import { readReg, getBrowserWallet } from './wallet-browser-keystore.js';
import { requestConfirmation, ensureUnlocked } from './wallet-confirm-modal.js';
import { getStoredAddress } from './wallet-session.js';

// Methods that require the wallet's key — these must be unlocked before they run.
const SIGN_METHODS = new Set(['personal_sign', 'eth_sendTransaction', 'eth_signTypedData', 'eth_signTypedData_v4']);

export const browserProvider = () => {
  const reg = readReg();
  const active = reg.wallets.find((w) => w.id === reg.activeId) || reg.wallets[0];
  if (!active) return null;

  const listeners = new Map();

  return {
    isEmbedded: true,
    _storedAddress: active.address,

    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [active.address];

        case 'eth_chainId':
          return '0x' + browserNetwork().chainId.toString(16);

        case 'personal_sign': {
          await ensureUnlocked();
          const message = params[0];
          const approved = await requestConfirmation('sign', { message });
          if (!approved) throw new Error('User rejected signature request');
          return getBrowserWallet().signMessage(
            typeof message === 'string' && message.startsWith('0x') ? ethers.getBytes(message) : message
          );
        }

        case 'eth_sendTransaction': {
          await ensureUnlocked();
          const txParams = params[0];
          const approved = await requestConfirmation('transaction', {
            to: txParams.to,
            value: txParams.value,
            data: txParams.data,
          });
          if (!approved) throw new Error('User rejected transaction');
          const rpc = getBrowserNetworkProvider();
          if (!rpc) throw new Error('No RPC provider available');
          const signer = getBrowserWallet().connect(rpc);
          const tx = await signer.sendTransaction(txParams);
          return tx.hash;
        }

        case 'eth_call':
        case 'eth_getBalance':
        case 'eth_estimateGas':
        case 'eth_getTransactionReceipt':
        case 'eth_blockNumber': {
          const rpc = getBrowserNetworkProvider();
          if (!rpc) throw new Error('No RPC provider available');
          return rpc.send(method, params || []);
        }

        default:
          throw new Error(`Unsupported method: ${method}`);
      }
    },

    on: (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    },

    removeListener: (event, handler) => {
      listeners.get(event)?.delete(handler);
    },
  };
};

// On desktop the request crosses IPC to main, where signing is natively
// confirmed and the key never leaves the trusted process.
export const desktopProvider = () => ({
  isEmbedded: true,
  _storedAddress: getStoredAddress(),
  request: async ({ method, params }) => {
    if (!SIGN_METHODS.has(method)) return window.neuma.wallet.request({ method, params });
    // Unlock first (the signer in main starts locked on launch and auto-locks
    // after idle), then the native confirm in main authorizes the signature.
    await ensureUnlocked();
    try {
      return await window.neuma.wallet.request({ method, params });
    } catch (e) {
      // The 15-min idle lock can fire between unlock and the native confirm —
      // re-prompt once (force, since the advisory cache may still read unlocked).
      if (/locked/i.test(e.message || '')) {
        await ensureUnlocked({ force: true });
        return window.neuma.wallet.request({ method, params });
      }
      throw e;
    }
  },
  on: () => {},
  removeListener: () => {},
});
