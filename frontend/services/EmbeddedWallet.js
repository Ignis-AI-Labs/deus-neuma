/**
 * EmbeddedWallet — the witness's local Ethereum wallet(s).
 *
 * The witness may hold up to MAX_WALLETS sovereign wallets, each its own
 * encrypted vault. A small non-secret registry (id + address) tracks them and
 * which one is active. One API, two backends:
 *  - DESKTOP (Electron): the keys live in the main process; these functions
 *    marshal to IPC (`window.neuma.wallet`) and keep a non-secret cache of the
 *    registry for the sync queries the picker uses.
 *  - BROWSER (dev / Playwright e2e): a renderer-side registry — PBKDF2-600k +
 *    AES-256-GCM per wallet, storing the recovery phrase so it can be revealed.
 *
 * Module family (SIZE-028, then CQ-036 #395): the browser vault crypto +
 * keystore CRUD live in wallet-browser-keystore.js, the registry VIEW +
 * lock-state session in wallet-session.js, the confirmation/unlock prompts +
 * ensureUnlocked in wallet-confirm-modal.js, and the EIP-1193 providers in
 * wallet-providers.js. This file keeps the wallet LIFECYCLE (create, import,
 * select, reveal, delete) and the public API — re-exporting every moved name
 * so importers see zero change. The session split ended the trio's three-way
 * import cycle: every edge now points one way, ending at the keystore.
 *
 * @module EmbeddedWallet
 */

import { ethers } from 'ethers';
import {
  MAX_WALLETS,
  createBrowser,
  commitBrowser,
} from './wallet-browser-keystore.js';
import { desktop, regView, refreshDesktopCache, noteUnlocked } from './wallet-session.js';
import { browserProvider, desktopProvider } from './wallet-providers.js';

export { MAX_WALLETS };
export { ensureUnlocked } from './wallet-confirm-modal.js';
export {
  listWallets,
  unlockEmbeddedWallet,
  tryRememberedUnlock,
  lockEmbeddedWallet,
  isWalletStored,
  isWalletUnlocked,
  getStoredAddress,
  getActiveWalletId,
} from './wallet-session.js';

// ===================== Public API (dispatched) =====================

/** @returns {boolean} whether the witness is below the wallet cap (sync). */
export const canCreateWallet = () => regView().wallets.length < MAX_WALLETS;

/**
 * Summon a NEW wallet (counts toward the cap). Returns its id, address, and
 * 24-word recovery phrase (shown once).
 * @param {string} password
 * @returns {Promise<{id: string, address: string, mnemonic: string}>}
 */
export const createEmbeddedWallet = async (password) => {
  if (desktop()) {
    const res = await window.neuma.wallet.create(password);
    await refreshDesktopCache();
    noteUnlocked(true);
    return res;
  }
  return createBrowser(password);
};

/**
 * A KEY MADE FOR THE OPERATOR (Design note, 2026-10-14: for people who want no wallet
 * of their own. Desktop only, and only where the OS keychain can keep it — the
 * password is generated and kept in the main process, never here.
 * @returns {Promise<boolean>}
 */
export const canMakeKeyForMe = async () => {
  if (!desktop() || typeof window.neuma.wallet.canKeepMadeKey !== 'function') return false;
  try { return Boolean(await window.neuma.wallet.canKeepMadeKey()); } catch { return false; }
};

/**
 * Make, keep and unlock a key for the operator in one step.
 * @returns {Promise<{id: string, address: string, mnemonic: string}>}
 */
export const createWalletForMe = async () => {
  const res = await window.neuma.wallet.createForMe();
  await refreshDesktopCache();
  noteUnlocked(true);
  return res;
};

/**
 * Import a wallet from a raw private key (no recovery phrase afterward).
 * @param {string} privateKey
 * @param {string} password
 * @returns {Promise<{id: string, address: string}>}
 */
export const importEmbeddedWallet = async (privateKey, password) => {
  if (desktop()) {
    const res = await window.neuma.wallet.importPrivateKey(privateKey, password);
    await refreshDesktopCache();
    noteUnlocked(true);
    return res;
  }
  const w = new ethers.Wallet(String(privateKey).trim());
  return commitBrowser('privateKey', w.privateKey, w.address, password);
};

/**
 * Restore a wallet from a BIP-39 recovery phrase (checksum-validated).
 * @param {string} phrase
 * @param {string} password
 * @returns {Promise<{id: string, address: string}>}
 */
export const importEmbeddedMnemonic = async (phrase, password) => {
  if (desktop()) {
    const res = await window.neuma.wallet.importMnemonic(phrase, password);
    await refreshDesktopCache();
    noteUnlocked(true);
    return res;
  }
  const mnemonic = ethers.Mnemonic.fromPhrase(String(phrase).trim());
  const w = ethers.HDNodeWallet.fromMnemonic(mnemonic);
  return commitBrowser('mnemonic', mnemonic.phrase, w.address, password);
};

/** Get an EIP-1193 provider backed by the active embedded wallet. */
export const getEmbeddedProvider = () => (desktop() ? desktopProvider() : browserProvider());

/**
 * Encrypt a recovery phrase into a standard Ethereum keystore (V3) JSON string
 * for an encrypted backup file readable by any wallet.
 * @param {string} mnemonic
 * @param {string} password
 * @returns {Promise<string>} keystore JSON
 */
export const encryptMnemonicToKeystore = async (mnemonic, password) => {
  const wallet = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(String(mnemonic).trim()));
  return wallet.encrypt(password);
};

/**
 * Import a wallet from an encrypted keystore (V3) JSON file (decrypt with the
 * given password, re-seal under the same password locally).
 * @param {string} keystoreJson
 * @param {string} password
 * @returns {Promise<{id: string, address: string}>}
 */
export const importEmbeddedKeystore = async (keystoreJson, password) => {
  const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
  if (wallet.mnemonic && wallet.mnemonic.phrase) {
    return importEmbeddedMnemonic(wallet.mnemonic.phrase, password);
  }
  return importEmbeddedWallet(wallet.privateKey, password);
};
