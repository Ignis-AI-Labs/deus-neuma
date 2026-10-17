/**
 * wallet-browser-keystore — the BROWSER-backend vault of EmbeddedWallet: the
 * registry's localStorage primitives (non-secret: id + address only) and the
 * per-wallet encrypted keystore — PBKDF2-600k + AES-256-GCM, storing the
 * recovery phrase so it can be revealed — plus the unlocked signer that lives
 * in renderer memory only.
 *
 * Split out of EmbeddedWallet.js (SIZE-028) — every body byte-identical. This
 * module is a pure leaf (no imports from the wallet family) so the other
 * wallet modules build on it without an import cycle. Used by dev and the
 * Playwright e2e stack; on desktop the keys live in the main process instead.
 *
 * @module wallet-browser-keystore
 */

import { ethers } from 'ethers';

export const MAX_WALLETS = 5;

// --- Registry storage primitives (non-secret) ---

export const REGISTRY_KEY = 'neuma-wallets';

export const vaultKey = (id) => `neuma-wallet:${id}`;

export const genId = () => {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export const readReg = () => {
  try {
    const r = JSON.parse(localStorage.getItem(REGISTRY_KEY));
    if (r && Array.isArray(r.wallets)) return r;
  } catch {
    /* no registry yet */
  }
  return { activeId: null, wallets: [] };
};

export const writeReg = (reg) => localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg));

// --- Vault crypto ---

export const PBKDF2_ITERATIONS = 600_000; // OWASP floor; legacy blobs read at 100k
const LEGACY_ITERATIONS = 100_000;
const BROWSER_V = 1;

let _wallet = null; // the unlocked ACTIVE wallet — renderer memory only

/** @returns {object|null} the unlocked in-memory browser signer (never persisted). */
export const getBrowserWallet = () => _wallet;

/** Set (or clear, with null) the unlocked in-memory browser signer. */
export const setBrowserWallet = (w) => {
  _wallet = w;
};

const deriveKey = async (password, salt, iterations) => {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

export const encrypt = async (plaintext, password) => {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    salt: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv)),
  };
};

export const decrypt = async (ciphertextB64, saltB64, ivB64, password, iterations) => {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ciphertextB64), (c) => c.charCodeAt(0));
  const key = await deriveKey(password, salt, iterations);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plainBuf);
};

const browserWalletFrom = (type, secret) =>
  type === 'mnemonic' ? ethers.HDNodeWallet.fromPhrase(secret) : new ethers.Wallet(secret);

const browserSeal = async (id, type, secret, address, password) => {
  const { ciphertext, salt, iv } = await encrypt(secret, password);
  localStorage.setItem(
    vaultKey(id),
    JSON.stringify({ v: BROWSER_V, address, type, encryptedKey: ciphertext, salt, iv, iters: PBKDF2_ITERATIONS })
  );
};

const browserOpen = async (stored, password) => {
  const iters = stored.iters || (stored.v ? PBKDF2_ITERATIONS : LEGACY_ITERATIONS);
  if (!Number.isInteger(iters) || iters < LEGACY_ITERATIONS || iters > 2_000_000) {
    throw new Error('Invalid wallet KDF parameters');
  }
  const secret = await decrypt(stored.encryptedKey, stored.salt, stored.iv, password, iters);
  return { type: stored.type || 'privateKey', secret };
};

export const commitBrowser = async (type, secret, address, password) => {
  const reg = readReg();
  if (reg.wallets.length >= MAX_WALLETS) throw new Error(`Wallet limit reached (${MAX_WALLETS}).`);
  const id = genId();
  await browserSeal(id, type, secret, address, password);
  reg.wallets.push({ id, address });
  reg.activeId = id;
  writeReg(reg);
  _wallet = browserWalletFrom(type, secret);
  return { id, address };
};

export const createBrowser = async (password) => {
  const mnemonic = ethers.Mnemonic.fromEntropy(ethers.randomBytes(32)); // 24-word
  const w = ethers.HDNodeWallet.fromMnemonic(mnemonic);
  const { id, address } = await commitBrowser('mnemonic', mnemonic.phrase, w.address, password);
  return { id, address, mnemonic: mnemonic.phrase };
};

export const unlockBrowser = async (id, password) => {
  const reg = readReg();
  const targetId = id || reg.activeId;
  const raw = localStorage.getItem(vaultKey(targetId));
  if (!raw) throw new Error('No embedded wallet found');
  const stored = JSON.parse(raw);
  const { type, secret } = await browserOpen(stored, password);
  const w = browserWalletFrom(type, secret);
  if (w.address.toLowerCase() !== String(stored.address).toLowerCase()) {
    _wallet = null;
    throw new Error('Decryption produced wrong address');
  }
  if (!stored.v || (stored.iters || LEGACY_ITERATIONS) < PBKDF2_ITERATIONS) {
    await browserSeal(targetId, type, secret, w.address, password); // transparent upgrade
  }
  _wallet = w;
  if (reg.activeId !== targetId) {
    reg.activeId = targetId;
    writeReg(reg);
  }
  return true;
};

