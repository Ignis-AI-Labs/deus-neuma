/**
 * wallet-session — the wallet family's shared ground: the non-secret registry
 * VIEW (browser localStorage or the desktop mirror of main's registry) and the
 * lock-state of the active wallet, with the unlock/lock/remembered calls that
 * change it.
 *
 * Split out of EmbeddedWallet.js (CQ-036, #395): confirm-modal and providers
 * both reached back into EmbeddedWallet for exactly these reads, which made
 * the trio a three-way import cycle — the init-order-bug class. This module
 * imports only the keystore, so every edge now points one way:
 * EmbeddedWallet → providers → confirm-modal → session → keystore.
 * EmbeddedWallet re-exports the public names, so importers see zero change.
 *
 * @module wallet-session
 */

import {
  REGISTRY_KEY,
  vaultKey,
  genId,
  readReg,
  writeReg,
  unlockBrowser,
  getBrowserWallet,
  setBrowserWallet,
} from './wallet-browser-keystore.js';

/** DESKTOP (Electron main holds the keys) vs BROWSER (renderer keystore). */
export const desktop = () => typeof window !== 'undefined' && !!(window.neuma && window.neuma.wallet);

// ===================== Registry view (non-secret) =====================

const LEGACY_KEY = 'kenorie-wallet';

let _desktopCache = { activeId: null, wallets: [] }; // desktop mirror of main's registry
let _unlocked = false; // advisory: is the ACTIVE wallet unlocked?

// Optional migration must not block cleanup imports when storage is denied.
const migrateLegacyBrowser = () => {
  try {
    if (localStorage.getItem(REGISTRY_KEY)) return;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    const stored = JSON.parse(legacy);
    const id = genId();
    localStorage.setItem(vaultKey(id), legacy);
    writeReg({ activeId: id, wallets: [{ id, address: stored.address }] });
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* leave the legacy blob in place */
  }
};
if (typeof window !== 'undefined' && !desktop()) migrateLegacyBrowser();

/** Refresh the desktop mirror from main's registry (keeps the last cache on error). */
export const refreshDesktopCache = async () => {
  try {
    const s = await window.neuma.wallet.status();
    _desktopCache = { activeId: s.activeId, wallets: s.wallets || [] };
    _unlocked = !!s.unlocked;
  } catch {
    /* keep the last cache */
  }
};
if (desktop()) {
  refreshDesktopCache();
  window.neuma.wallet.onLocked(() => {
    _unlocked = false;
  });
}

/** Record a lifecycle outcome (create/import/select/delete) in the lock state. */
export const noteUnlocked = (v) => {
  _unlocked = !!v;
};

/** Sync registry view + active address (browser localStorage, or desktop cache). */
export const regView = () => (desktop() ? _desktopCache : readReg());
const activeAddress = () => {
  const r = regView();
  const active = r.wallets.find((w) => w.id === r.activeId);
  return active ? active.address : r.wallets[0] ? r.wallets[0].address : null;
};

// --- Auto-lock the browser wallet on tab close ---
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    setBrowserWallet(null);
  });
}

// ===================== Session queries + transitions =====================

/** @returns {Promise<Array<{id: string, address: string}>>} the witness's wallets */
export const listWallets = async () => {
  if (desktop()) {
    const l = await window.neuma.wallet.list();
    _desktopCache.wallets = l;
    return l;
  }
  return readReg().wallets.map((w) => ({ id: w.id, address: w.address }));
};

/**
 * Unlock a wallet by id (defaults to the active one) and make it active.
 * @param {string|null} id
 * @param {string} password
 * @param {{remember?: boolean}} [opts]
 * @returns {Promise<boolean>}
 */
export const unlockEmbeddedWallet = async (id, password, { remember = false } = {}) => {
  if (desktop()) {
    await window.neuma.wallet.unlock(id, password, remember);
    await refreshDesktopCache();
    _unlocked = true;
    return true;
  }
  return unlockBrowser(id, password);
};

/** Desktop only: unlock from the OS-sealed remember blob. False if none. */
export const tryRememberedUnlock = async () => {
  if (!desktop() || typeof window.neuma.wallet.tryRemembered !== 'function') return false;
  const s = await window.neuma.wallet.tryRemembered();
  if (!s?.unlocked) return false;
  await refreshDesktopCache();
  _unlocked = true;
  return true;
};

/** Lock the active wallet — clears the in-memory key (renderer or main). */
export const lockEmbeddedWallet = () => {
  if (desktop()) {
    _unlocked = false;
    window.neuma.wallet.lock().catch(() => {});
    return;
  }
  setBrowserWallet(null);
};

/** @returns {boolean} whether any wallet exists (sync). */
export const isWalletStored = () => regView().wallets.length > 0;

/** @returns {boolean} whether the active wallet is unlocked (sync, advisory on desktop). */
export const isWalletUnlocked = () => (desktop() ? _unlocked : getBrowserWallet() !== null);

/** @returns {string|null} the active wallet's address (sync). */
export const getStoredAddress = () => activeAddress();

/** @returns {string|null} the active wallet id (sync). */
export const getActiveWalletId = () => regView().activeId;
