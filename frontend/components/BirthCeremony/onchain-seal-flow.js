// onchain-seal-flow.js — the ceremony's hand on the desk wallet for the
// Natalis seal step. Three capabilities, all through the preload bridge
// (window.neuma.wallet): make sure the wallet points at the ceremony's
// network, personal_sign the seal's inner payload, and broadcast the
// relay-safe seal transaction. Every signature and broadcast passes the
// wallet's own trusted confirm window — nothing here can approve itself.
//
// impure throughout (IPC to the Electron main process).

import { ensureUnlocked } from '../../services/EmbeddedWallet.js';

/**
 * The desk wallet bridge, or null when the ceremony runs somewhere without
 * one (plain browser dev) — the seal step then offers only "seal later".
 */
export const deskWallet = () => window.neuma?.wallet || null;

/**
 * Does this error mean the wallet vault is locked (main-process custody,
 * idle auto-lock or never unlocked this session)? Matches both lock shapes
 * the wallet service throws, through the IPC wrapper's prefix. Pure.
 */
export const isWalletLockedError = (message) =>
  /wallet is locked|wallet locked during confirmation/i.test(String(message || ''));

// impure — a wallet request that answers a locked vault with the witness's
// own unlock door instead of a raw IPC error ([…] reached a witness mid-seal,
// 2026-07-19 — never again). Unlock then retry once; a cancelled unlock
// (or any other failure) propagates honestly.
const requestUnlockAware = async (req) => {
  const wallet = deskWallet();
  try {
    return await wallet.request(req);
  } catch (err) {
    if (!isWalletLockedError(err?.message)) throw err;
    await ensureUnlocked({ force: true }); // throws on cancel — clean rejection
    return wallet.request(req);
  }
};

/**
 * Point the wallet at the ceremony's network, asking the witness through the
 * wallet's gated dialog when a switch is needed. Returns { ok } or
 * { ok: false, error } when the witness declines or the key is unknown.
 */
export const ensureWalletNetwork = async (networkKey) => {
  const wallet = deskWallet();
  const status = await wallet.network.status();
  if (status?.network?.key === networkKey) return { ok: true };
  const res = await wallet.network.set(networkKey);
  return res?.ok ? { ok: true } : { ok: false, error: res?.error || 'Network switch declined' };
};

/**
 * personal_sign the seal's inner payload (32-byte hex). The wallet EIP-191
 * wraps it — exactly the digest Natalis verifies (sealDigest path 1).
 * Resolves to the 65-byte signature hex.
 */
export const signSealPayload = (innerPayload, witnessAddress) =>
  requestUnlockAware({ method: 'personal_sign', params: [innerPayload, witnessAddress] });

/**
 * Broadcast the encoded seal transaction from the witness's wallet (she pays
 * the gas; the contract records only the signed parties). Resolves to the
 * transaction hash once broadcast.
 */
export const broadcastSealTx = ({ to, data }) =>
  requestUnlockAware({ method: 'eth_sendTransaction', params: [{ to, data }] });
