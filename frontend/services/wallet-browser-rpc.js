// Browser custom-RPC store. The desktop app keeps the RPC in the OS keychain
// (electron/wallet/rpc-store.cjs); in the browser (npm run dev) there is no
// keychain, so we persist it in wallet-scoped localStorage and say so plainly in
// the UI. The desktop validator's SSRF rigor isn't needed here — the browser
// calls the RPC directly from the user's own machine, it is not a server-side
// proxy — so we only require a valid http(s) URL.
//
// impure — localStorage.

const KEY = 'base-rpc';

// Scope to the connected wallet so one browser can hold several witnesses'
// endpoints without collision (mirrors frontend/utils/companion-data.js).
const scopedKey = () => {
  try {
    const w = localStorage.getItem('walletAddress');
    return w ? `${w.toLowerCase()}:${KEY}` : KEY;
  } catch {
    return KEY;
  }
};

/** Keep scheme + host, hide the path (which may carry an API key). */
const maskRpcUrl = (url) => {
  try {
    const u = new URL(url);
    const hasPath = u.pathname && u.pathname !== '/';
    return `${u.protocol}//${u.host}${hasPath ? '/…' : ''}`;
  } catch {
    return 'custom RPC';
  }
};

const isValidHttpUrl = (url) => {
  try {
    const u = new URL(String(url).trim());
    if (u.protocol === 'https:') return true;
    // http: only for a local node — a remote http URL would put the API key on the wire in cleartext.
    const host = u.hostname.toLowerCase();
    return u.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1' || host === '::1');
  } catch {
    return false;
  }
};

/** @returns {string|null} the raw custom RPC URL for this wallet, or null. */
export const getBrowserRpc = () => {
  try {
    return localStorage.getItem(scopedKey()) || null;
  } catch {
    return null;
  }
};

export const browserRpcStatus = () => {
  const url = getBrowserRpc();
  return url
    ? { custom: true, label: maskRpcUrl(url), browser: true }
    : { custom: false, browser: true };
};

export const setBrowserRpc = (url) => {
  const v = String(url || '').trim();
  if (!isValidHttpUrl(v)) return { ok: false, error: 'Enter a valid http(s) RPC URL.' };
  try {
    localStorage.setItem(scopedKey(), v);
    return { ok: true, status: { custom: true, label: maskRpcUrl(v), browser: true } };
  } catch {
    return { ok: false, error: 'Could not save the RPC in this browser.' };
  }
};

export const clearBrowserRpc = () => {
  try {
    localStorage.removeItem(scopedKey());
  } catch {
    return { ok: false, error: 'Could not clear the RPC in this browser.' };
  }
  return { ok: true, status: { custom: false, browser: true } };
};
