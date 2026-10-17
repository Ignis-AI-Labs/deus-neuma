// Custom RPC endpoint store — the witness's private RPC URL is a SECRET. It can
// carry an API key and is the user's MEV-protection path (their private mempool
// / own node), so it gets the SAME protection as the wallet vault: an
// OS-keychain-wrapped, 0600 file, held only in the main process and never
// returned to the renderer in the clear.
//
// The outer seal is INJECTED (like vault-store) so this is unit-testable without
// Electron. Unlike the wallet vault there is no password layer here, so the OS
// keychain is MANDATORY: if none is available we refuse to store rather than
// drop a secret onto disk in cleartext.

const path = require('node:path');
const { writeVault, readVault, vaultExists, deleteVault } = require('./vault-store.cjs');
const { validateRpcUrl } = require('./rpc-url.cjs');

const rpcFile = (walletDir) => path.join(walletDir, 'rpc.json');

/** Display label: keep scheme + host, hide the path (which may carry an API key). */
const maskRpcUrl = (url) => {
  try {
    const u = new URL(url);
    const hasPath = u.pathname && u.pathname !== '/';
    return `${u.protocol}//${u.host}${hasPath ? '/…' : ''}`;
  } catch {
    return 'custom RPC';
  }
};

/**
 * @param {{walletDir:string, outerSeal:{available:boolean,encrypt:Function,decrypt:Function}}} deps
 */
const createRpcStore = ({ walletDir, outerSeal }) => {
  const file = rpcFile(walletDir);
  let cache;          // undefined = unloaded, null = none set, string = the URL
  let unreadable = false; // a stored RPC exists on disk but could not be decrypted

  // impure — the RAW url. MAIN-PROCESS ONLY; never send this over IPC.
  const get = () => {
    if (cache !== undefined) return cache;
    if (!vaultExists(file)) { unreadable = false; cache = null; return cache; }
    try {
      const env = readVault(file, outerSeal);
      unreadable = false;
      cache = env && typeof env.url === 'string' ? env.url : null;
      return cache;
    } catch {
      // Present but unreadable (keychain locked / corrupt). Don't cache — retry
      // next call in case the keychain unlocks — and flag it so status() can
      // surface that we've silently fallen back to the public RPC.
      unreadable = true;
      return null;
    }
  };

  // Safe to hand the renderer: whether a custom RPC is set + a masked label, or
  // a degraded marker when a stored secret can't be read (Rule 3 — no silent
  // fallback). Never the raw URL.
  const status = () => {
    const url = get();
    if (url) return { custom: true, label: maskRpcUrl(url) };
    return unreadable ? { custom: false, degraded: 'unreadable' } : { custom: false };
  };

  const set = (url) => {
    if (!(outerSeal && outerSeal.available)) {
      return { ok: false, error: 'Secure storage (OS keychain) is unavailable on this machine — a private RPC cannot be stored safely here.' };
    }
    const v = validateRpcUrl(url);
    if (!v.ok) return { ok: false, error: v.error };
    writeVault(file, { url: v.url }, outerSeal);
    cache = v.url;
    unreadable = false;
    return { ok: true, status: { custom: true, label: maskRpcUrl(v.url) } };
  };

  const clear = () => {
    deleteVault(file);
    cache = null;
    unreadable = false;
    return { ok: true, status: { custom: false } };
  };

  return Object.freeze({ get, status, set, clear });
};

module.exports = { createRpcStore, maskRpcUrl };
